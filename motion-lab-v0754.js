(()=>{
'use strict';
const $=id=>document.getElementById(id),M=RiftMovement,v=$('video'),tracker=new RiftOcclusion.MotionTracker();
const canvas=document.createElement('canvas');canvas.width=M.W;canvas.height=M.H;const g=canvas.getContext('2d',{willReadFrequently:true});
let stream=null,opening=false,epoch=0,lastStamp=null,geometry=null,lastFrame=null,trace=[],eventLines=[],lastPhase='',lastLog=0,samples=0,totalMs=0,firstAt=0,lastHudAt=-Infinity,callback=null,callbackKind=null;
let lastGreen={},seenAmbiguous=0;
const status=(t,phase='neutral')=>{const node=$('state');if(node.textContent!==t)node.textContent=t;if(node.dataset.phase!==phase)node.dataset.phase=phase;};
function syncCount(){const count=String(tracker.events),amb=tracker.ambiguousReturns+' ambiguous';if($('candidateCount').textContent!==count)$('candidateCount').textContent=count;if($('ambiguousCount').textContent!==amb)$('ambiguousCount').textContent=amb;}
function candidateLabel(type){return ({'same-appearance-after-outward-motion':'Same appearance after outward motion','same-appearance-after-exit':'Same appearance after exit','changed-center-with-old-card-offset':'Changed center / offset old match','new-center-appearance':'New center appearance'})[type]||type;}
function phaseStyle(phase){return phase==='held'?'held':phase==='replacement'?'replacement':phase.includes('motion')?'moving':phase==='align'?'neutral':'uncertain';}
function log(event,data={}){trace.push({ms:Math.round(performance.now()),event,...data});if(trace.length>500)trace.shift();}
function controls(){const live=!!stream&&!opening;$('start').disabled=opening;$('stop').disabled=!stream&&!opening;$('arm').disabled=!live||!lastFrame;$('reset').disabled=!live;}
function reset(reason){tracker.reset();lastGreen={};seenAmbiguous=0;lastFrame=null;lastStamp=null;lastPhase='';samples=0;totalMs=0;firstAt=0;lastHudAt=-Infinity;eventLines=[];$('rateHud').textContent='0 samples/s · 0 detailed searches';$('trackHud').textContent='Green: old card · Blue: incoming hypothesis';$('events').textContent='';$('stats').textContent='0 replacement candidates';$('lastCandidate').textContent='Last replacement: none';$('lastCandidate').title='';syncCount();$('diag').textContent='No tracking data.';log('reset',{reason});draw(null);controls();}
function stop(){cancelSampling();epoch++;stream?.getTracks().forEach(t=>t.stop());stream=null;v.srcObject=null;opening=false;geometry=null;reset('camera stopped');status('Camera stopped.');}
function region(){
 const w=v.videoWidth,h=v.videoHeight;if(!w||!h)return null;
 const sw=Math.min(w*.96,h*.96*M.W/M.H),sh=sw*M.H/M.W;
 return {x:(w-sw)/2,y:(h-sh)/2,w:sw,h:sh,vw:w,vh:h};
}
function layout(){
 const r=region();if(!r)return;
 if(geometry&&(geometry.vw!==r.vw||geometry.vh!==r.vh)){reset('native camera dimensions changed');status('Camera dimensions changed. Align and mark reference again.');}
 geometry=r;const b=v.getBoundingClientRect(),k=Math.min(b.width/r.vw,b.height/r.vh);
 Object.assign($('overlay').style,{left:((b.width-r.vw*k)/2+r.x*k)+'px',top:((b.height-r.vh*k)/2+r.y*k)+'px',width:r.w*k+'px',height:r.h*k+'px'});
}
function draw(r){
 if(!r)lastGreen={};const box=r?.incoming?.box,blue=$('motionBox');
 if(box){for(const key of ['x','y','w','h'])blue.setAttribute(key==='w'?'width':key==='h'?'height':key,box[key]);blue.setAttribute('stroke-dasharray',r.incoming.misses?'3 2':'none');blue.setAttribute('visibility','visible');}else blue.setAttribute('visibility','hidden');
 $('motionTiles').setAttribute('d',(r?.motion?.tiles||[]).map(t=>`M${t.x} ${t.y}h8v8h-8z`).join(' '));
 for(const [name,suffix] of [['art','Art'],['id','Id']]){
  const z=M.zones[name],fixed=$('fixed'+suffix),moving=$('moving'+suffix),match=r?.[name];
  for(const node of [fixed,moving]){node.setAttribute('width',z.w);node.setAttribute('height',z.h);}
  fixed.setAttribute('x',z.x);fixed.setAttribute('y',z.y);
  const good=match?match.error<M.cfg.loss:!!tracker.anchor&&!r;
  if(good)lastGreen[name]=match?{dx:match.dx,dy:match.dy}:{dx:0,dy:0};
  const p=lastGreen[name]||{dx:0,dy:0};moving.setAttribute('x',z.x+p.dx);moving.setAttribute('y',z.y+p.dy);moving.setAttribute('stroke-dasharray',good?'none':'3 2');
  moving.setAttribute('stroke',good?'#53e5ae':'#ef7777');moving.setAttribute('visibility',tracker.anchor?'visible':'hidden');
 }
}
async function start(){
 const device=$('device').value,w=Number($('res').value);
 stop();const token=epoch;opening=true;controls();status('Opening camera…');
 try{
  const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(device?{deviceId:{exact:device}}:{facingMode:{ideal:'environment'}}),width:{ideal:w},height:{ideal:Math.round(w*9/16)},frameRate:{ideal:30}}});
  if(token!==epoch){next.getTracks().forEach(t=>t.stop());return;}
  stream=next;v.srcObject=next;await v.play();if(token!==epoch)return;
  const t=next.getVideoTracks()[0];const modes=t.getCapabilities?.().focusMode||[];
  if(modes.includes('continuous'))try{const c=t.getConstraints();await t.applyConstraints({...c,advanced:[...(c.advanced||[]),{focusMode:'continuous'}]});}catch(_){}
  if(token!==epoch)return;
  try{const ds=await navigator.mediaDevices.enumerateDevices();if(token!==epoch)return;$('device').replaceChildren(new Option('Automatic rear camera',''),...ds.filter(d=>d.kind==='videoinput').map((d,i)=>new Option(d.label||'Camera '+i,d.deviceId)));const actual=t.getSettings?.().deviceId;if([...$('device').options].some(o=>o.value===actual))$('device').value=actual;}catch(_){}
  if(token!==epoch)return;$('cameraSettings').open=false;layout();$('liveStage').scrollIntoView({block:'start',behavior:'auto'});status('Align one card, then mark reference. '+t.label+' · '+v.videoWidth+'×'+v.videoHeight);log('camera opened',{label:t.label,resolution:[v.videoWidth,v.videoHeight]});
 }catch(e){if(token===epoch){stop();status('Camera error: '+e.message);}}
 finally{if(token===epoch){opening=false;controls();if(stream)schedule();}}
}
function cancelSampling(){
 if(callback!==null){if(callbackKind==='video')v.cancelVideoFrameCallback?.(callback);else cancelAnimationFrame(callback);}
 callback=null;callbackKind=null;
}
function schedule(){
 if(callback!==null||!stream)return;
 if(typeof v.requestVideoFrameCallback==='function'){
  callbackKind='video';callback=v.requestVideoFrameCallback((now,meta)=>tick(now,meta));
 }else{callbackKind='animation';callback=requestAnimationFrame(now=>tick(now,null));}
}
function tick(now,meta){
 callback=null;callbackKind=null;
 try{sample(now,meta);}catch(e){status('Tracking error: '+e.message);log('error',{message:e.message});}
 finally{schedule();}
}
function sample(now,meta){
 if(!stream||opening||document.hidden||v.readyState<2)return;
 const key=meta?.presentedFrames!==undefined?'f'+meta.presentedFrames:'t'+v.currentTime;
 if(key===lastStamp)return;
 lastStamp=key;const began=performance.now(),r=region();if(!r)return;
 if(!geometry||r.vw!==geometry.vw||r.vh!==geometry.vh)layout();
 g.drawImage(v,r.x,r.y,r.w,r.h,0,0,M.W,M.H);
 const data=g.getImageData(0,0,M.W,M.H).data,p=new Uint8Array(M.W*M.H);
 for(let i=0;i<p.length;i++)p[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];
 lastFrame={w:M.W,h:M.H,p};const result=tracker.step(lastFrame,now,key);if(!result){controls();return;}
 if(!samples)firstAt=now;samples++;totalMs+=performance.now()-began;
 draw(result.event?null:result);
 const fmt=n=>Number.isFinite(n)?Number(n.toFixed(2)):null;
 const detail={phase:result.phase,outer:result.motion.outer,inner:result.motion.inner,depth:fmt(result.motion.depth),box:result.motion.box,outline:result.outline.score,artChange:fmt(result.change.art),idChange:fmt(result.change.id),still:result.still,aligned:result.aligned,episode:result.episode,incoming:result.incoming,ambiguousReturns:result.ambiguousReturns,art:result.art?{dx:result.art.dx,dy:result.art.dy,error:fmt(result.art.error)}:null,id:result.id?{dx:result.id.dx,dy:result.id.dy,error:fmt(result.id.error)}:null};
 if(lastPhase!==result.phase||now-lastLog>=300||result.event){log('sample',detail);lastPhase=result.phase;lastLog=now;}
 status(result.event?'REPLACEMENT #'+result.event.index:result.phase.toUpperCase(),phaseStyle(result.phase));
 if(result.ambiguousReturns>seenAmbiguous){seenAmbiguous=result.ambiguousReturns;const a=result.lastAmbiguous,label='Ambiguous #'+a.index+' · identical appearance / possible return';$('lastCandidate').textContent=label;$('lastCandidate').title=label;log('ambiguous return or reveal',a);eventLines.unshift(label);eventLines=eventLines.slice(0,100);$('events').textContent=eventLines.join('\n');}
 if(result.event){const label='Last #'+result.event.index+' · '+result.event.type+' · '+result.event.latencyMs+'ms';$('lastCandidate').textContent=label;$('lastCandidate').title=label;log('replacement candidate',result.event);eventLines.unshift(label+' · ambiguous');eventLines=eventLines.slice(0,100);$('events').textContent=eventLines.join('\n');try{navigator.vibrate?.(60);}catch(_){}}
 syncCount();
 if(now-lastHudAt>=150||result.event){
  lastHudAt=now;const t=result.incoming;$('trackHud').textContent=(result.episode?.oldMoved?'Green: outward evidence':'Green: '+(result.art&&result.id?'matched':'uncertain'))+' · Blue: '+(t?(t.misses?'temporarily lost':t.entered?'overlap '+Math.round(t.overlap*100)+'%':'tracking approach'):'none');const fps=samples>1?(samples-1)*1000/Math.max(1,now-firstAt):0;
  $('rateHud').textContent=fps.toFixed(1)+' samples/s · '+tracker.detailRuns+' detailed searches';
  $('stats').textContent=tracker.events+' replacement candidates · '+samples+' samples · '+(totalMs/samples).toFixed(1)+'ms average sample work';
  $('diag').textContent='Exterior / interior tiles '+detail.outer+' / '+detail.inner+' · outline '+detail.outline+'/4 · stable '+(detail.still||0)+'/2 · artwork / ID change '+detail.artChange+' / '+detail.idChange+' · old moved '+(detail.episode?.oldMoved?'yes':'no')+' · incoming overlap '+(detail.episode?.blueOverlap?'yes':'no')+' · ambiguous '+tracker.ambiguousReturns;
 }
 controls();
}
$('start').onclick=start;$('stop').onclick=stop;
$('arm').onclick=()=>{if(!lastFrame)return;if(tracker.arm(lastFrame)){status('HELD · Reference marked.','held');log('reference marked');draw(null);}else status('Reference too low contrast. Align card and improve light.');};
$('reset').onclick=()=>{reset('manual reset');status('Align one card and mark reference again.');};
function showZone(){const name=$('zoneSelect').value,z=M.zones[name];$('zoneInfo').textContent=name.toUpperCase()+' · X '+z.x+' · Y '+z.y+' · Width '+z.w+' · Height '+z.h;}
function zoneChanged(){reset('tracking regions adjusted');log('zones',{zones:JSON.parse(JSON.stringify(M.zones))});showZone();status('Regions adjusted. Mark the card again when aligned.');}
$('zoneSelect').onchange=showZone;
for(const button of document.querySelectorAll('[data-adjust]'))button.onclick=()=>{const name=$('zoneSelect').value,[key,delta]=button.dataset.adjust.split(':'),z={...M.zones[name]};z[key]+=Number(delta);if(M.setZone(name,z))zoneChanged();else status('Region cannot extend beyond tracking area or become too small.');};
$('zoneDefaults').onclick=()=>{for(const name of Object.keys(M.defaults))M.setZone(name,M.defaults[name]);zoneChanged();};
showZone();
$('export').onclick=()=>{const payload={version:'0.7.5.4',ambiguousReturns:tracker.ambiguousReturns,sampling:typeof v.requestVideoFrameCallback==='function'?'video-frame':'animation-fallback',detailRuns:tracker.detailRuns,motionHistory:tracker.history,zones:JSON.parse(JSON.stringify(M.zones)),camera:stream?.getVideoTracks()[0]?.label||null,resolution:[v.videoWidth,v.videoHeight],candidates:tracker.events,samples,averageMs:samples?totalMs/samples:null,trace};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='riftscan-motion-v0754-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
v.addEventListener('resize',layout);window.addEventListener('resize',layout);window.addEventListener('pagehide',stop);
draw(null);controls();
})();
