/* Queue Lab: acquisition and OCR never share a live-frame dependency. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),Q=RiftQueue,C=RiftCore,v=$('video');
let db=null,stream=null,epoch=0,opening=false,capturing=false,storing=false,held=false,base=null,previous=null,stable=0,presentSince=0,detectBusy=false;
let heldAnchor=null,baseGeometry=null,emptyRun=null,lastDetectStamp=null,lastDetectAt=0,rearms=0;
let jobs=[],storageError='',pendingStore=null,worker=null,processing=false,workerPaused=false,active=true,reviewId=null,reviewURL=null,releaseLock=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),state=s=>$('state').textContent=s,work=s=>$('workerState').textContent=s;
const track=()=>stream?.getVideoTracks()[0];
function controls(){
 const camera=!!track()&&!opening,full=Q.admission(jobs,'new-id')==='full';
 $('start').disabled=!db||opening||capturing||!!pendingStore;$('stop').disabled=!stream&&!opening;
 $('focus').disabled=!camera||capturing;$('capture').disabled=!db||!camera||capturing||held||full||!!pendingStore||!!storageError;
 $('arm').disabled=!camera||capturing||!!pendingStore||!held;
 $('calibrate').disabled=!camera||capturing||!!pendingStore;
 $('auto').disabled=!base||!camera||!!pendingStore;$('retryStore').disabled=!pendingStore||capturing||storing;
 $('resume').disabled=!db||processing;$('export').disabled=!db||!jobs.length;
}
function resetSamples(){previous=null;stable=0;presentSince=0;emptyRun=null;lastDetectStamp=null;lastDetectAt=0;}
function clearDetection(reason='Not calibrated'){base=null;baseGeometry=null;resetSamples();$('auto').checked=false;$('detect').textContent=reason;$('rearmStatus').textContent='Manual mode · '+reason;}
function stop(){epoch++;stream?.getTracks().forEach(t=>t.stop());stream=null;v.srcObject=null;opening=false;clearDetection();state('Camera stopped. Stored jobs can continue processing.');controls();}
function layout(){
 const b=$('view').getBoundingClientRect();if(!v.videoWidth||!b.width||!b.height)return;
 const k=Math.min(b.width/v.videoWidth,b.height/v.videoHeight),w=v.videoWidth*k,h=v.videoHeight*k;
 const gw=Math.min(w*.86,h*.86*63/88),gh=gw*88/63;
 Object.assign($('guide').style,{width:gw+'px',height:gh+'px',left:(b.width-gw)/2+'px',top:(b.height-gh)/2+'px'});
}
function rect(id){
 const b=v.getBoundingClientRect(),r=$(id).getBoundingClientRect(),k=Math.min(b.width/v.videoWidth,b.height/v.videoHeight);
 const x=(r.left-b.left-(b.width-v.videoWidth*k)/2)/k,y=(r.top-b.top-(b.height-v.videoHeight*k)/2)/k,w=r.width/k,h=r.height/k;
 if(![x,y,w,h].every(Number.isFinite)||w<12||h<6||x<-.5||y<-.5||x+w>v.videoWidth+.5||y+h>v.videoHeight+.5)throw Error('Crop outside camera frame');
 return [Math.max(0,x),Math.max(0,y),Math.min(w,v.videoWidth-Math.max(0,x)),Math.min(h,v.videoHeight-Math.max(0,y))];
}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function crop(id,width){const [x,y,w,h]=rect(id),c=canvas(width,Math.max(1,Math.round(width*h/w)));c.getContext('2d').drawImage(v,x,y,w,h,0,0,c.width,c.height);return c;}
function gray(c){const d=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height).data,a=new Uint8Array(d.length/4);for(let i=0;i<a.length;i++)a[i]=.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2];return a;}
function score(c){
 const a=gray(c),w=c.width,h=c.height;let edge=0,n=0,lo=255,hi=0;
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;lo=Math.min(lo,a[i]);hi=Math.max(hi,a[i]);edge+=Math.min(100,Math.abs(4*a[i]-a[i-1]-a[i+1]-a[i-w]-a[i+w]));n++;}
 return {sharp:edge/Math.max(1,n),contrast:hi-lo};
}
// Diagnostic text-likeness only, never a hard veto on a plausible card.
function textHint(c){
 const a=gray(c),w=c.width,h=c.height;let best=0;
 for(let y=Math.floor(h*.2);y<Math.ceil(h*.85);y++){let crossings=0;for(let x=1;x<w;x++)if(Math.abs(a[y*w+x]-a[y*w+x-1])>35)crossings++;best=Math.max(best,crossings);}
 return best>=8;
}
function detectorCrop(zone,w,h){const r=rect(zone),c=canvas(w,h);c.getContext('2d').drawImage(v,...r,0,0,w,h);return c;}
function sample(){const id=detectorCrop('idZone',240,64),art=detectorCrop('artZone',96,64);return {id:gray(id),art:gray(art),text:textHint(id)};}
function geometrySignature(){return {w:v.videoWidth,h:v.videoHeight,zones:['idZone','artZone'].flatMap(zone=>rect(zone).map((n,i)=>n/(i%2?v.videoHeight:v.videoWidth)))};}
function geometryMatches(a,b){return !!a&&a.w===b.w&&a.h===b.h&&a.zones.every((n,i)=>Math.abs(n-b.zones[i])<.025);}
function showRearm(label){$('rearmStatus').textContent=label+' · Auto rearms: '+rearms;}
function blob(c,type='image/png',quality){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('Image encoding failed')),type,quality));}
async function start(){
 stop();const token=epoch;opening=true;controls();state('Opening camera…');
 try{
  const device=$('device').value,w=Number($('res').value);
  const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(device?{deviceId:{exact:device}}:{facingMode:{ideal:'environment'}}),width:{ideal:w},height:{ideal:Math.round(w*9/16)},frameRate:{ideal:30}}});
  if(token!==epoch){next.getTracks().forEach(t=>t.stop());return;}
  stream=next;v.srcObject=next;await v.play();if(token!==epoch)return;layout();
  const t=track(),caps=t.getCapabilities?.()||{};
  if(caps.focusMode?.includes('continuous'))try{await t.applyConstraints({...t.getConstraints(),advanced:[...(t.getConstraints().advanced||[]),{focusMode:'continuous'}]});}catch(_){}
  if(token!==epoch)return;
  try{const ds=await navigator.mediaDevices.enumerateDevices();if(token!==epoch)return;$('device').replaceChildren(new Option('Automatic rear camera',''),...ds.filter(d=>d.kind==='videoinput').map((d,i)=>new Option(d.label||'Camera '+i,d.deviceId)));const actual=t.getSettings?.().deviceId;if(actual&&[...$('device').options].some(o=>o.value===actual))$('device').value=actual;}catch(_){}
  if(token!==epoch)return;
  state('Active: '+t.label+' · '+v.videoWidth+'×'+v.videoHeight+' · '+(t.getSettings?.().focusMode||'focus not reported')+(held?' · Replace card and rearm':' · Align card and tap Capture'));
 }catch(e){if(token===epoch){stop();state('Camera error: '+e.message);}}
 finally{if(token===epoch){opening=false;controls();}}
}
async function focus(){
 const t=track();if(!t||capturing)return;const token=epoch;opening=true;controls();
 try{const modes=t.getCapabilities?.().focusMode||[],old=t.getConstraints?.()||{};const advanced=(old.advanced||[]).map(a=>{const b={...a};delete b.focusMode;delete b.focusDistance;return b;}).filter(a=>Object.keys(a).length);const next={...old,advanced};delete next.focusMode;delete next.focusDistance;
 if(modes.includes('single-shot')){await t.applyConstraints({...next,advanced:[...advanced,{focusMode:'single-shot'}]});await sleep(500);}
 if(token!==epoch)return;
 if(modes.includes('continuous'))await t.applyConstraints({...next,advanced:[...advanced,{focusMode:'continuous'}]});
 state('Autofocus requested; check image sharpness.');resetSamples();if(base&&!geometryMatches(baseGeometry,geometrySignature()))clearDetection('Camera crop changed. Remove card and recalibrate.');
 }catch(e){if(token===epoch)state('Focus request failed: '+e.message);}
 finally{if(token===epoch){opening=false;controls();}}
}
function stamp(){let n=0;try{n=v.getVideoPlaybackQuality?.().totalVideoFrames||0;}catch(_){}return v.currentTime+':'+n;}
async function capture(){
 if($('capture').disabled)return;
 capturing=true;controls();const token=epoch;let frames=[],last=null,anchor=null;
 const settings={sets:$('sets').value.toUpperCase().split(/[,\s]+/).filter(Boolean),threshold:Math.min(90,Math.max(40,Number($('threshold').value)||50))};
 try{
  const start=performance.now(),geometry=()=>rect('idZone').map(n=>Math.round(n*2)/2).join(':')+':'+v.videoWidth+':'+v.videoHeight,initialGeometry=geometry();
  while(frames.length<4&&performance.now()-start<700&&token===epoch){
   if(geometry()!==initialGeometry)throw Error('Crop geometry changed; align and capture again');
   const key=stamp();
   if(v.readyState>=2&&key!==last){last=key;if(!anchor)anchor=sample();const native=rect('idZone');const id=crop('idZone',Math.max(1,Math.min(1200,Math.round(native[2])))),art=crop('artZone',128);const quality=score(id);frames.push({id,art,quality,stamp:key,thumb:frames.length?null:crop('guide',180)});state('Capturing '+frames.length+'/4');}
   if(frames.length<4)await sleep(70);
  }
  if(token!==epoch||geometry()!==initialGeometry)throw Error('Camera changed before capture finished; nothing queued');
  if(!frames.length)throw Error('No usable camera frame');
  // Keep two highest-quality distinct ID images, plus all available artwork samples.
  const thumb=frames[0].thumb;
  const ranked=[...frames].sort((a,b)=>b.quality.sharp-a.quality.sharp);
  const images=await Promise.all(ranked.slice(0,2).map(f=>blob(f.id)));
  const art=await Promise.all(frames.map(f=>blob(f.art,'image/jpeg',.8)));
  const thumbnail=await blob(thumb,'image/jpeg',.8);
  const job={id:crypto.randomUUID(),created:Date.now(),images,art,thumbnail,settings,frameCount:frames.length,note:'Captured',finish:'review'};
  pendingStore=job;held=true;heldAnchor=anchor;await storePending();
 }catch(e){state(e.message);}
 finally{capturing=false;controls();}
}
async function storePending(){
 if(!pendingStore||storing)return;
 storing=true;controls();
 try{
  const job=pendingStore,result=await Q.enqueue(db,job);
  if(result!=='ok'&&result!=='duplicate'){state('Queue full. Image held in memory; retry storage after resolving jobs.');return;}
  pendingStore=null;held=true;resetSamples();storageError='';showRearm($('auto').checked?'CAPTURE LOCKED · Remove card completely':'CAPTURE LOCKED · Manual next card');
  $('receipt').textContent='IMAGE CAPTURED ✓ · '+job.id.slice(0,8)+' · Replace card';
  try{navigator.vibrate?.(70);}catch(_){}
  state('Capture stored. You can replace the card now.');
  try{await refresh();void pump();}catch(e){storageError=e.message;state('Capture is stored, but the queue view failed. Reload to recover: '+e.message);}
 }catch(e){storageError=e.message;state('Storage error: '+e.message+' · Capture not confirmed; retry storage before leaving.');}
 finally{storing=false;controls();}
}
async function detect(){
 if(detectBusy||!base||!stream||opening||capturing||pendingStore||document.hidden)return;
 detectBusy=true;
 try{
  if(!geometryMatches(baseGeometry,geometrySignature())){clearDetection('Camera crop changed. Remove card and recalibrate.');controls();return;}
  const now=performance.now(),fresh=stamp();
  if(fresh===lastDetectStamp)return;
  if(lastDetectAt&&now-lastDetectAt>650)resetSamples();
  lastDetectStamp=fresh;lastDetectAt=now;
  const s=sample(),p=Q.presence(base,s,previous);previous=s;
  stable=p.present&&p.stable?stable+1:0;
  if(p.present){if(!presentSince)presentSince=now;}else presentSince=0;
  const departed=held&&Q.departure(heldAnchor,s);
  emptyRun=held?Q.emptyProgress(emptyRun,p,departed,now,fresh):null;
  $('detect').textContent=(p.present?'Possible card':p.empty?'Empty surface':'Uncertain')+' · '+(s.text?'text-like edges':'text uncertain')+' · artwork / ID differences '+p.art.toFixed(1)+' / '+p.id.toFixed(1)+' · residual '+p.artResidual.toFixed(1)+' / '+p.idResidual.toFixed(1)+' · departure '+(departed?'yes':'no')+' · empty '+(emptyRun?.count||0)+'/3';
  if(!$('auto').checked){showRearm(held?'CAPTURE LOCKED · Automatic capture off':'READY · Automatic capture off');return;}
  if(held){
   if(emptyRun?.ready){held=false;heldAnchor=null;rearms++;stable=0;presentSince=0;emptyRun=null;state('READY FOR NEXT CARD · Empty surface observed');showRearm('READY FOR NEXT CARD');controls();return;}
   showRearm('CAPTURE LOCKED · '+(p.empty?'Checking empty gap '+(emptyRun?.count||0)+'/3':'Remove card completely'));return;
  }
  showRearm(p.present?'CARD DETECTED · Checking stability':p.empty?'READY FOR NEXT CARD':'Searching · Uncertain surface');
  if(stable>=2&&(s.text||now-presentSince>=600)&&!$('capture').disabled)await capture();
 }catch(e){$('detect').textContent='Detection unavailable: '+e.message;showRearm('Detection error · '+e.message);}
 finally{detectBusy=false;}
}
function makeVariant(raw,invert,enhance){
 const w=Math.min(1200,Math.max(750,raw.width*2)),h=Math.max(1,Math.round(w*raw.height/raw.width));
 const c=canvas(w+48,h+48),g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(raw,24,24,w,h);
 const im=g.getImageData(24,24,w,h);for(let i=0;i<im.data.length;i+=4){let x=.299*im.data[i]+.587*im.data[i+1]+.114*im.data[i+2];if(enhance)x=Math.max(0,Math.min(255,(x-128)*1.45+128));if(invert)x=255-x;im.data[i]=im.data[i+1]=im.data[i+2]=x;}g.putImageData(im,24,24);return c;
}
async function getWorker(){
 if(worker)return worker;
 if(!window.Tesseract)throw Error('OCR library unavailable');
 const w=await Tesseract.createWorker('eng',1);
 try{await w.setParameters({tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/\\ .·•-'});worker=w;return w;}catch(e){await w.terminate();throw e;}
}
function bounded(promise,ms,label){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms);})]).finally(()=>clearTimeout(timer));}
async function recognize(job,w){
 const reads=[];
 for(const [i,image] of job.images.entries()){
  const raw=await createImageBitmap(image);
  try{
   for(const mode of [{invert:true,enhance:false,psm:'11'},{invert:true,enhance:true,psm:'7'}]){
    await w.setParameters({tessedit_pageseg_mode:mode.psm});
    const r=await w.recognize(makeVariant(raw,mode.invert,mode.enhance)),d=r.data,p=C.parse(d.text,job.settings.sets),confidence=Number(d.confidence)||0;
    reads.push({frame:i,key:p?p.set+' '+p.num+'/'+p.den:null,parsed:p,text:d.text,confidence,threshold:job.settings.threshold,method:mode.psm});
    if(p&&confidence>=job.settings.threshold)break;
   }
  }finally{raw.close();}
 }
 const verdict=Q.vote(reads,2);
 return {state:verdict.accepted?'saved':'review',result:verdict.accepted?verdict.good[0].parsed:verdict.best?.parsed||null,reads,finish:'review',note:verdict.accepted?'ID confirmed · finish uncertain':verdict.conflict?'Conflicting IDs · review required':'Not enough matching accepted reads'};
}
async function pump(){
 if(!db||processing||workerPaused||!active)return;processing=true;controls();
 try{
  while(active&&!workerPaused){
   if(!jobs.some(j=>j.state==='queued'))break;
   work('Loading / preparing OCR worker…');const w=await getWorker();if(!active)break;
   const job=await Q.claim(db);if(!job)break;await refresh();work('Processing '+job.id.slice(0,8)+' · camera remains independent');
   try{const result=await bounded(recognize(job,w),30000,'OCR job');if(!active)return;if(!await Q.finish(db,job.id,'processing',result))throw Error('Job state changed');}
   catch(e){if(!active)return;await Q.finish(db,job.id,'processing',{state:'queued',note:'Processing interrupted: '+e.message});throw e;}
   await refresh();
  }
  if(!workerPaused)work('Queue drained or waiting for captures');
 }catch(e){workerPaused=true;work('Processing paused: '+e.message+' · Jobs retained. Tap Resume processing.');try{await worker?.terminate();}catch(_){}worker=null;try{await refresh();}catch(_){}}
 finally{processing=false;controls();}
}
function button(label,action){const b=document.createElement('button');b.textContent=label;b.onclick=action;return b;}
async function refresh(){
 jobs=await Q.list(db);const n=Q.counts(jobs);$('stats').textContent=jobs.length+' captured · '+n.queued+' queued · '+n.processing+' processing · '+n.saved+' IDs saved · '+n.review+' ID review · '+jobs.filter(j=>j.state==='discarded').length+' discarded';
 const list=$('jobs');list.replaceChildren();
 for(const j of [...jobs].reverse()){
  const a=document.createElement('article'),p=document.createElement('p');p.textContent='#'+j.id.slice(0,8)+' · '+j.state.toUpperCase()+(j.result?' · '+j.result.set+' '+j.result.num:'')+' · '+(j.note||'');a.append(p);
  if(j.state==='review'||j.state==='saved')a.append(button('View / review',()=>openReview(j.id)));if(j.state==='review')a.append(button('Discard false capture',async()=>{if(!confirm('Mark this capture as not a card? It will remain in the audit log.'))return;try{await Q.finish(db,j.id,'review',{state:'discarded',note:'User marked false capture'});await refresh();void pump();}catch(e){state(e.message);}}));list.append(a);
 }
 controls();
}
function openReview(id){
 const j=jobs.find(x=>x.id===id);if(!j)return;reviewId=id;
 if(reviewURL)URL.revokeObjectURL(reviewURL);reviewURL=URL.createObjectURL(j.images[0]);$('reviewImg').src=reviewURL;
 $('reviewSet').value=j.result?.set||'';$('reviewNum').value=j.result?.num||'';$('reviewFinish').value=j.finish||'review';
 $('reviewNote').textContent=j.note+' · '+(j.reads||[]).map(r=>r.confidence+'% '+(r.key||'unreadable')).join(' / ');
 $('reviewStatus').textContent='';$('review').hidden=false;$('review').scrollIntoView({block:'nearest'});
}
function closeReview(){reviewId=null;$('review').hidden=true;if(reviewURL)URL.revokeObjectURL(reviewURL);reviewURL=null;$('reviewImg').removeAttribute('src');}
$('confirmReview').onclick=async()=>{
 const j=jobs.find(x=>x.id===reviewId);if(!j)return;const set=$('reviewSet').value.trim().toUpperCase(),num=$('reviewNum').value.trim().toLowerCase(),finish=$('reviewFinish').value;
 if(!C.validate(set,num)){ $('reviewStatus').textContent='Enter a 3-letter set and a valid collector number.';return;}
 $('confirmReview').disabled=true;
 try{if(!await Q.finish(db,j.id,j.state,{state:'saved',result:{set,num,den:j.result?.set===set&&j.result?.num===num?j.result.den:null},finish,note:'Manually verified'}))throw Error('Job changed; reopen review');closeReview();await refresh();void pump();}
 catch(e){$('reviewStatus').textContent=e.message;}finally{$('confirmReview').disabled=false;}
};
$('closeReview').onclick=closeReview;
$('export').onclick=()=>{const data=jobs.map(({images,art,thumbnail,...j})=>j),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='riftscan-queue-lab.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('start').onclick=start;$('stop').onclick=stop;$('focus').onclick=focus;$('capture').onclick=capture;$('retryStore').onclick=storePending;
$('arm').onclick=()=>{held=false;heldAnchor=null;resetSamples();state('Manually rearmed. Only use after physically replacing the card.');showRearm('READY FOR NEXT CARD · Manual rearm');controls();};
$('calibrate').onclick=()=>{if(held&&!confirm('Is the previously captured card completely removed? Calibrating the empty surface will rearm the camera.'))return;try{const next=sample(),g=geometrySignature();base=next;baseGeometry=g;held=false;heldAnchor=null;resetSamples();$('detect').textContent='Empty surface calibrated';state('Empty surface calibrated. Enable Automatic capture.');showRearm('READY · Empty surface calibrated');controls();}catch(e){state(e.message);}};
$('auto').onchange=()=>{resetSamples();showRearm($('auto').checked?(held?'CAPTURE LOCKED · Remove card completely':'READY FOR NEXT CARD'):'Manual capture enabled');};
$('resume').onclick=()=>{workerPaused=false;void pump();};v.addEventListener('resize',layout);window.addEventListener('resize',layout);
window.addEventListener('beforeunload',e=>{if(pendingStore||capturing){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{active=false;stop();closeReview();releaseLock?.();});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
setInterval(detect,100);controls();
async function init(){
 if(!navigator.locks){state('Queue Lab requires browser tab locking. Try Chrome.');return;}
 try{await navigator.locks.request('riftscan-queue-lab-v1',{ifAvailable:true},async lock=>{
  if(!lock){state('Queue Lab is open in another tab. Close it and reload.');return;}
  db=await Q.open();const recovered=await Q.restore(db);await refresh();state('Local queue ready. '+recovered+' interrupted jobs restored.');controls();void pump();
  if(!active){db.close();return;}await new Promise(resolve=>{releaseLock=resolve;});db.close();
 });}catch(e){state('Queue storage unavailable: '+e.message);db=null;controls();}
}
void init();
})();
