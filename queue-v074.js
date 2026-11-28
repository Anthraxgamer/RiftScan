/* V0.7.4 queue foundation. Separate database; never writes the legacy collection. */
(function(root){
'use strict';
const LIMIT=50, MAX_RECORDS=1000;
const pending=j=>j.state==='queued'||j.state==='processing'||j.state==='review';
function admission(jobs,id){
 if(jobs.some(j=>j.id===id))return 'duplicate';
 if(jobs.length>=MAX_RECORDS||jobs.filter(pending).length>=LIMIT)return 'full';
 return 'ok';
}
function vote(reads,needed=2){
 const good=reads.filter(r=>r.key&&r.confidence>=r.threshold);
 const keys=new Set(good.map(r=>r.key));
 const best=[...reads].sort((a,b)=>Number(!!b.key)-Number(!!a.key)||b.confidence-a.confidence)[0]||null;
 return {accepted:keys.size===1&&new Set(good.map(r=>r.frame)).size>=needed,conflict:keys.size>1,best,good};
}
function recover(jobs){return jobs.filter(j=>j.state==='processing').map(j=>({...j,state:'queued',note:'Recovered interrupted processing'}));}
function counts(jobs){const n={queued:0,processing:0,review:0,saved:0};for(const j of jobs)if(j.state in n)n[j.state]++;return n;}
function meanDiff(a,b){if(!a||!b||a.length!==b.length||!a.length)return Infinity;let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d/a.length;}
// Allow moderate uniform exposure changes, but not arbitrary changes of texture.
function exposureDiff(a,b){
 if(!a||!b||a.length!==b.length||!a.length)return {raw:Infinity,residual:Infinity,offset:Infinity};
 let sum=0;for(let i=0;i<a.length;i++)sum+=b[i]-a[i];
 const offset=sum/a.length;let residual=0;
 for(let i=0;i<a.length;i++)residual+=Math.abs(b[i]-a[i]-offset);
 return {raw:meanDiff(a,b),residual:residual/a.length,offset:Math.abs(offset)};
}
function presence(base,sample,previous){
 const a=exposureDiff(base?.art,sample.art),i=exposureDiff(base?.id,sample.id);
 const near=(d,raw,residual)=>d.raw<raw||(d.offset<=35&&d.residual<residual);
 const empty=near(a,12,9)&&near(i,10,8);
 const stable=!!previous&&meanDiff(previous.art,sample.art)<9&&meanDiff(previous.id,sample.id)<12;
 const present=!empty&&(a.residual>12||a.raw>22)&&(i.residual>9||i.raw>17);
 return {present,empty,stable,art:a.raw,id:i.raw,artResidual:a.residual,idResidual:i.residual};
}
function departure(anchor,sample){
 if(!anchor)return false;
 const a=exposureDiff(anchor.art,sample.art),i=exposureDiff(anchor.id,sample.id);
 return a.residual>12||i.residual>12||a.raw>40||i.raw>40;
}
// Require distinct fresh samples and a sustained empty gap. No OCR dependency.
function emptyProgress(old,p,departed,now,stamp){
 if(old&&old.stamp===stamp)return old;
 if(!p.empty||!departed)return {count:0,since:now,last:now,stamp,ready:false};
 const contiguous=old&&old.count>0&&now-old.last<=650;
 const count=contiguous?old.count+1:1,since=contiguous?old.since:now;
 return {count,since,last:now,stamp,ready:count>=3&&now-since>=200};
}
// Capture-cycle state is independent of OCR and persistent queue jobs.
function changedBoth(a,b){
 if(!a||!b)return false;
 const art=exposureDiff(a.art,b.art),id=exposureDiff(a.id,b.id);
 return Number.isFinite(art.raw)&&Number.isFinite(id.raw)&&
  (art.residual>14||art.raw>42)&&(id.residual>12||id.raw>42);
}
function gapEvidence(base,anchor,sample,previous){
 const p=presence(base,sample,previous);
 const departed=departure(anchor,sample);
 if(p.empty&&departed)return {kind:'calibrated',p};
 // Fallback when exposure/shadow changes prevent a background match.
 // Both zones must change, the collector strip must lose text-like edges,
 // and the new view must settle. A mere movement or blurry frame is not enough.
 if(!sample.text&&p.stable&&changedBoth(anchor,sample))return {kind:'changed-gap',p};
 return {kind:null,p};
}
function advanceGap(old,evidence,now,stamp){
 if(old&&old.stamp===stamp)return old;
 if(!evidence.kind)return {kind:null,count:0,since:now,last:now,stamp,ready:false};
 const contiguous=old&&old.kind===evidence.kind&&now-old.last<=650;
 const count=contiguous?old.count+1:1,since=contiguous?old.since:now;
 const fallback=evidence.kind==='changed-gap';
 return {kind:evidence.kind,count,since,last:now,stamp,ready:count>=(fallback?4:3)&&now-since>=(fallback?300:200)};
}
function arrivalEvidence(base,gap,sample,previous){
 const p=presence(base,sample,previous);
 if(!sample.text||!p.stable)return false;
 if(gap)return changedBoth(gap,sample);
 return p.present;
}
function open(){
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open('riftscan-queue-lab-v1',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('jobs',{keyPath:'id'});
  r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Close other queue-lab tabs.'));r.onsuccess=()=>resolve(r.result);
 });
}
function transaction(db,mode,work){
 return new Promise((resolve,reject)=>{
  let answer;const tx=db.transaction('jobs',mode),store=tx.objectStore('jobs');
  tx.oncomplete=()=>resolve(answer);tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));tx.onerror=()=>{};
  try{work(store,x=>{answer=x;},tx);}catch(e){try{tx.abort();}catch(_){}reject(e);}
 });
}
function list(db){return transaction(db,'readonly',(s,set)=>{const r=s.getAll();r.onsuccess=()=>set(r.result.sort((a,b)=>a.created-b.created));});}
function enqueue(db,job){
 return transaction(db,'readwrite',(s,set)=>{
  const r=s.getAll();r.onsuccess=()=>{const result=admission(r.result,job.id);set(result);if(result==='ok')s.add({...job,state:'queued'});};
 });
}
function restore(db){return transaction(db,'readwrite',(s,set)=>{const r=s.getAll();r.onsuccess=()=>{const jobs=recover(r.result);jobs.forEach(j=>s.put(j));set(jobs.length);};});}
// Only the Queue Lab object store is cleared; the production collection is separate.
function clearHistory(db){
 return transaction(db,'readwrite',(store,set)=>{
  const r=store.clear();r.onsuccess=()=>set(true);
 });
}
function claim(db){return transaction(db,'readwrite',(s,set)=>{const r=s.getAll();r.onsuccess=()=>{const j=r.result.filter(j=>j.state==='queued').sort((a,b)=>a.created-b.created)[0];if(!j){set(null);return;}const next={...j,state:'processing'};s.put(next);set(next);};});}
function finish(db,id,expected,patch){
 return transaction(db,'readwrite',(s,set)=>{
  const r=s.get(id);r.onsuccess=()=>{const j=r.result;if(!j||j.state!==expected){set(false);return;}
   const next={...j,...patch,id:j.id,created:j.created};s.put(next);set(true);
  };
 });
}
const api={LIMIT,MAX_RECORDS,admission,vote,recover,counts,meanDiff,exposureDiff,presence,departure,emptyProgress,changedBoth,gapEvidence,advanceGap,arrivalEvidence,open,list,enqueue,restore,claim,finish,clearHistory};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RiftQueue=api;
})(typeof globalThis!=='undefined'?globalThis:this);
