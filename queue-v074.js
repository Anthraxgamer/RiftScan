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
function presence(base,sample,previous){
 const art=meanDiff(base?.art,sample.art),id=meanDiff(base?.id,sample.id);
 const stable=!!previous&&meanDiff(previous.art,sample.art)<9&&meanDiff(previous.id,sample.id)<12;
 return {present:art>15&&id>10,empty:art<9&&id<7,stable,art,id};
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
function claim(db){return transaction(db,'readwrite',(s,set)=>{const r=s.getAll();r.onsuccess=()=>{const j=r.result.filter(j=>j.state==='queued').sort((a,b)=>a.created-b.created)[0];if(!j){set(null);return;}const next={...j,state:'processing'};s.put(next);set(next);};});}
function finish(db,id,expected,patch){
 return transaction(db,'readwrite',(s,set)=>{
  const r=s.get(id);r.onsuccess=()=>{const j=r.result;if(!j||j.state!==expected){set(false);return;}
   const next={...j,...patch,id:j.id,created:j.created};s.put(next);set(true);
  };
 });
}
const api={LIMIT,MAX_RECORDS,admission,vote,recover,counts,meanDiff,presence,open,list,enqueue,restore,claim,finish};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RiftQueue=api;
})(typeof globalThis!=='undefined'?globalThis:this);
