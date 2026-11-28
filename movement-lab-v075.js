(()=>{
'use strict';
const $=id=>document.getElementById(id),M=RiftMovement,v=$('video'),tracker=new M.Tracker();
const canvas=document.createElement('canvas');canvas.width=M.W;canvas.height=M.H;const g=canvas.getContext('2d',{willReadFrequently:true});
let stream=null,opening=false,epoch=0,lastStamp=null,geometry=null,lastFrame=null,trace=[],eventLines=[],lastPhase='',lastLog=0,samples=0,totalMs=0;
const status=t=>$('state').textContent=t;
function log(event,data={}){trace.push({ms:Math.round(performance.now()),event,...data});if(trace.length>500)trace.shift();}
function controls(){const live=!!stream&&!opening;$('start').disabled=opening;$('stop').disabled=!stream&&!opening;$('arm').disabled=!live||!lastFrame;$('reset').disabled=!live;}
function reset(reason){tracker.reset();lastFrame=null;lastStamp=null;lastPhase='';samples=0;totalMs=0;eventLines=[];$('events').textContent='';$('stats').textContent='0 replacement candidates';$('diag').textContent='No tracking data.';log('reset',{reason});draw(null);controls();}
function stop(){epoch++;stream?.getTracks().forEach(t=>t.stop());stream=null;v.srcObject=null;opening=false;geometry=null;reset('camera stopped');status('Camera stopped.');}
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
 for(const [name,suffix] of [['art','Art'],['id','Id']]){
  const z=M.zones[name],fixed=$('fixed'+suffix),moving=$('moving'+suffix),match=r?.[name];
  for(const node of [fixed,moving]){node.setAttribute('width',z.w);node.setAttribute('height',z.h);}
  fixed.setAttribute('x',z.x);fixed.setAttribute('y',z.y);
  const good=match?match.error<M.cfg.loss:!!tracker.anchor;
  moving.setAttribute('x',z.x+(good&&match?match.dx:0));moving.setAttribute('y',z.y+(good&&match?match.dy:0));
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
  if(token!==epoch)return;layout();status('Align one card, then mark reference. '+t.label+' · '+v.videoWidth+'×'+v.videoHeight);log('camera opened',{label:t.label,resolution:[v.videoWidth,v.videoHeight]});
 }catch(e){if(token===epoch){stop();status('Camera error: '+e.message);}}
 finally{if(token===epoch){opening=false;controls();}}
}
function sample(){
 if(!stream||opening||document.hidden||v.readyState<2)return;
 const key=v.currentTime+':'+(v.getVideoPlaybackQuality?.().totalVideoFrames||0);if(key===lastStamp)return;
 lastStamp=key;const now=performance.now(),r=region();if(!r)return;
 if(!geometry||r.vw!==geometry.vw||r.vh!==geometry.vh)layout();
 g.drawImage(v,r.x,r.y,r.w,r.h,0,0,M.W,M.H);
 const data=g.getImageData(0,0,M.W,M.H).data,p=new Uint8Array(M.W*M.H);
 for(let i=0;i<p.length;i++)p[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];
 lastFrame={w:M.W,h:M.H,p};const result=tracker.step(lastFrame,now,key);if(!result){controls();return;}
 samples++;totalMs+=performance.now()-now;draw(result.event?null:result);
 const fmt=n=>Number.isFinite(n)?Number(n.toFixed(2)):null;
 if(result.art){
  const detail={phase:result.phase,art:{dx:result.art.dx,dy:result.art.dy,error:fmt(result.art.error)},id:{dx:result.id.dx,dy:result.id.dy,error:fmt(result.id.error)},coherent:result.coherent,away:result.away,bothLost:result.bothLost,different:result.different,still:result.still,textured:result.textured,moved:result.moved,lost:result.lost,snap:result.snap,stable:result.stable,fixedArt:fmt(result.fixedArt),fixedId:fmt(result.fixedId),newCenter:result.newCenter,farAway:result.farAway,singleOut:result.singleOut};
  $('diag').textContent='Artwork Δ '+detail.art.dx+', '+detail.art.dy+' · error '+(detail.art.error??'lost')+' | ID Δ '+detail.id.dx+', '+detail.id.dy+' · error '+(detail.id.error??'lost')+' | coherent '+(detail.coherent?'yes':'no')+' · settled '+detail.stable+'/3'+' · center differences A / ID '+(detail.fixedArt??'lost')+' / '+(detail.fixedId??'lost');
  if(lastPhase!==result.phase||now-lastLog>=500||result.event){log('sample',detail);lastPhase=result.phase;lastLog=now;}
  status(result.event?'REPLACEMENT CANDIDATE #'+result.event.index+' · '+result.event.type:result.phase.toUpperCase());
 }else status('Align card and mark reference');
 if(result.event){log('replacement candidate',result.event);eventLines.unshift('#'+result.event.index+' · '+result.event.type+' · '+Math.round(now)+'ms');eventLines=eventLines.slice(0,100);$('events').textContent=eventLines.join('\n');try{navigator.vibrate?.(60);}catch(_){}}
 $('stats').textContent=tracker.events+' replacement candidates · '+samples+' samples · '+(totalMs/samples).toFixed(1)+'ms average tracker work';
 controls();
}
$('start').onclick=start;$('stop').onclick=stop;
$('arm').onclick=()=>{if(!lastFrame)return;if(tracker.arm(lastFrame)){status('HELD · Reference marked. Move or cover the card.');log('reference marked');draw(null);}else status('Reference too low contrast. Align card and improve light.');};
$('reset').onclick=()=>{reset('manual reset');status('Align one card and mark reference again.');};
function showZone(){const name=$('zoneSelect').value,z=M.zones[name];$('zoneInfo').textContent=name.toUpperCase()+' · X '+z.x+' · Y '+z.y+' · Width '+z.w+' · Height '+z.h;}
function zoneChanged(){reset('tracking regions adjusted');log('zones',{zones:JSON.parse(JSON.stringify(M.zones))});showZone();status('Regions adjusted. Mark the card again when aligned.');}
$('zoneSelect').onchange=showZone;
for(const button of document.querySelectorAll('[data-adjust]'))button.onclick=()=>{const name=$('zoneSelect').value,[key,delta]=button.dataset.adjust.split(':'),z={...M.zones[name]};z[key]+=Number(delta);if(M.setZone(name,z))zoneChanged();else status('Region cannot extend beyond tracking area or become too small.');};
$('zoneDefaults').onclick=()=>{for(const name of Object.keys(M.defaults))M.setZone(name,M.defaults[name]);zoneChanged();};
showZone();
$('export').onclick=()=>{const payload={version:'0.7.5.1',zones:JSON.parse(JSON.stringify(M.zones)),camera:stream?.getVideoTracks()[0]?.label||null,resolution:[v.videoWidth,v.videoHeight],candidates:tracker.events,samples,averageMs:samples?totalMs/samples:null,trace};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='riftscan-movement-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
v.addEventListener('resize',layout);window.addEventListener('resize',layout);window.addEventListener('pagehide',stop);
setInterval(()=>{try{sample();}catch(e){status('Tracking error: '+e.message);log('error',{message:e.message});}},100);draw(null);controls();
})();
