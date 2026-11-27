/* RiftScan V0.7: independent two-region translation tracker and conservative replacement gate. */
(function(root){'use strict';
const W=96,H=128,M=.18;
const limits={art:6,id:11,search:14,loss:.78,stable:.30,departure:2,arrival:3};
function patch(frame,z,dx=0,dy=0){
 const a=[];let sum=0,sq=0;for(let y=0;y<z.h;y+=2)for(let x=0;x<z.w;x+=2){const xx=z.x+x+dx,yy=z.y+y+dy;if(xx<0||yy<0||xx>=frame.w||yy>=frame.h)return null;const v=frame.p[yy*frame.w+xx];a.push(v);sum+=v;sq+=v*v;}const mean=sum/a.length,sd=Math.sqrt(Math.max(0,sq/a.length-mean*mean));return {a,mean,sd};
}
function compare(a,b){if(!a||!b||a.a.length!==b.a.length||Math.min(a.sd,b.sd)<3)return 2;let d=0;for(let i=0;i<a.a.length;i++)d+=Math.abs((a.a[i]-a.mean)/a.sd-(b.a[i]-b.mean)/b.sd);return d/a.a.length;}
function match(anchor,frame,z,range=limits.search){
 let best={error:Infinity,dx:0,dy:0};for(let dy=-range;dy<=range;dy+=2)for(let dx=-range;dx<=range;dx+=2){const b=patch(frame,z,dx,dy),error=compare(anchor,b);if(error<best.error-1e-8||Math.abs(error-best.error)<1e-8&&Math.hypot(dx,dy)<Math.hypot(best.dx,best.dy))best={error,dx,dy};}return best;
}
function describe(frame,zones){return {art:patch(frame,zones.art),id:patch(frame,zones.id)};}
function textured(d){return !!d.art&&!!d.id&&d.art.sd>=6&&d.id.sd>=5;}
function still(a,b){return !!a&&!!b&&compare(a.art,b.art)<limits.stable&&compare(a.id,b.id)<limits.stable;}
function classify(anchor,frame,zones,d){
 const art=match(anchor.art,frame,zones.art),id=match(anchor.id,frame,zones.id);
 const artLost=art.error>limits.loss,idLost=id.error>limits.loss;
 const artAway=Math.hypot(art.dx,art.dy)>limits.art,idAway=Math.hypot(id.dx,id.dy)>limits.id;
 const coherent=!artLost&&!idLost&&artAway&&idAway&&Math.hypot(art.dx-id.dx,art.dy-id.dy)<=5;
 const blank=!!d.art&&!!d.id&&d.art.sd<Math.max(7,anchor.art.sd*.48)&&d.id.sd<Math.max(7,anchor.id.sd*.48);
 return {art,id,artLost,idLost,coherent,blank,bothLost:artLost&&idLost};
}
class Tracker{
 constructor(){this.reset();}
 reset(){this.phase='seeking';this.anchor=null;this.prev=null;this.stable=0;this.depart=0;this.sawExit=false;this.epoch=(this.epoch||0)+1;this.probeAt=-Infinity;this.matches=null;}
 save(d){if(!d)return;this.anchor=d;this.phase='held';this.prev=d;this.stable=0;this.depart=0;this.sawExit=false;this.epoch++;}
 step(frame,zones,now){const d=describe(frame,zones);const stable=still(this.prev,d)&&textured(d);this.stable=stable?this.stable+1:0;this.prev=d;let rearm=false;
  if(!this.anchor){this.phase=this.stable>=2?'ready':'seeking';return {d,rearm};}
  const m=classify(this.anchor,frame,zones,d);this.matches=m;
  if(this.phase==='departed'){if(this.stable>=limits.arrival-1&&textured(d)&&!m.blank&&!m.coherent){this.reset();this.prev=d;this.stable=2;this.phase='ready';rearm=true;}return {d,rearm};}
  // Coherent travel alone cannot rearm. Require both regions to disappear, or low texture in both.
  if(m.coherent)this.sawExit=true;
  if(m.blank||(m.bothLost&&this.sawExit)){this.depart++;this.phase='removing';if(this.depart>=limits.departure){this.phase='departed';this.stable=0;this.epoch++;}return {d,rearm};}
  this.depart=0;
  if(!m.artLost&&!m.idLost&&!m.coherent&&Math.hypot(m.art.dx,m.art.dy)<=limits.art&&Math.hypot(m.id.dx,m.id.dy)<=limits.id){this.sawExit=false;this.phase='held';return {d,rearm};}
  // Different artwork may deserve OCR even if no visible gap occurred; never release the same-ID lock here.
  if((m.artLost||m.idLost)&&this.stable>=3){this.phase='probe';}else this.phase='held';return {d,rearm};
 }
 canRead(now,confirming=false){return this.phase==='ready'||this.phase==='probe'&&(confirming||now-this.probeAt>=900);}
 begin(now,confirming=false){if(!this.canRead(now,confirming))return null;if(this.phase==='probe')this.probeAt=now;return {epoch:this.epoch,d:this.prev,phase:this.phase};}
 valid(t){return !!t&&t.epoch===this.epoch&&!!this.prev&&still(t.d,this.prev)&&(this.phase==='ready'||this.phase==='probe');}
}
if(typeof module!=='undefined'&&module.exports){module.exports={Tracker,patch,describe,compare,match,classify,still,textured,limits};return;}
const el=id=>document.getElementById(id),enabled=el('trackerEnabledV07'),info=el('trackerInfoV07'),stats=el('trackerStatsV07'),overlay=el('trackerOverlayV07');
if(!enabled||!info||!stats||!overlay)return;
if(typeof getRect!=='function'||typeof locked==='undefined'||typeof candidate==='undefined'||typeof cameraEpoch==='undefined'||typeof history==='undefined'||typeof run==='undefined'||typeof stream==='undefined'||typeof paused==='undefined'||typeof adjusting==='undefined'||typeof video==='undefined'){enabled.checked=false;enabled.disabled=true;info.textContent='Tracker unavailable with this scanner interface. Use Ready for next card.';return;}
const tr=new Tracker(),c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d',{willReadFrequently:true});
let session=null,sessionRun=null,seenLock=null,lastStamp=null,lastD=null,lastRect=null,skips=0,rearms=0,samples=0,errors=0,wasActive=false,lastEpoch=null,anchorInvalid=false;
const active=()=>enabled.checked&&el('bestFrameEnabled')?.checked&&!!stream&&!paused&&!adjusting&&!document.hidden;
function say(s){if(info.textContent!==s)info.textContent=s;}
function reset(){tr.reset();seenLock=null;lastD=null;lastStamp=null;lastRect=null;anchorInvalid=false;}
function zones(g,t){const [x,y,w,h]=g;const conv=(a,b,ww,hh)=>({x:Math.round((a+M)/(1+2*M)*W),y:Math.round((b+M)/(1+2*M)*H),w:Math.max(2,Math.round(ww/(1+2*M)*W)),h:Math.max(2,Math.round(hh/(1+2*M)*H))});const a=root.RiftZonesV071?.art()||{x:.14,y:.12,w:.72,h:.49};return {art:conv(a.x,a.y,a.w,a.h),id:conv((t[0]-x)/w+.02,(t[1]-y)/h+.01,Math.max(.1,t[2]/w-.04),Math.max(.04,t[3]/h-.02))};}
function draw(z){for(const name of ['art','id']){const p=z[name],m=tr.matches?.[name];for(const kind of ['fixed','moving']){const n=el(`v07-${name}-${kind}`);const dx=kind==='moving'&&m&&m.error<=limits.loss?m.dx:0,dy=kind==='moving'&&m&&m.error<=limits.loss?m.dy:0;n.style.left=`${((p.x+dx)/W*(1+2*M)-M)*100}%`;n.style.top=`${((p.y+dy)/H*(1+2*M)-M)*100}%`;n.style.width=`${p.w/W*(1+2*M)*100}%`;n.style.height=`${p.h/H*(1+2*M)*100}%`;n.dataset.lost=String(kind==='moving'&&!!m&&m.error>limits.loss);}}}
function sample(force=false){
 if(stream!==session||run!==sessionRun){reset();session=stream;sessionRun=run;lastEpoch=cameraEpoch;}
 overlay.hidden=!active()||!el('trackerZonesV07')?.checked;
 if(!active()){if(wasActive){tr.epoch++;lastStamp=null;}wasActive=false;say(enabled.checked?'Tracker waiting · start/resume camera with best-frame enabled':'Auto replacement off · manual Next available');return false;}
 wasActive=true;
 if(lastEpoch!==cameraEpoch){tr.epoch++;lastEpoch=cameraEpoch;lastStamp=null;}
 if(video.readyState<2||!video.videoWidth)return false;
 // Sync actual saved-card lock, not OCR guesses. Keep separate lock across blank-frame resets.
 if(locked&&locked!==seenLock){seenLock=locked;if(lastD&&textured(lastD)){tr.save(lastD);anchorInvalid=false;}else {tr.phase='held';anchorInvalid=true;}}
 if(seenLock&&!locked)locked=seenLock;
 const stamp=video.currentTime;if(!force&&stamp===lastStamp)return true;
 const g=getRect(el('guide')),t=getRect(el('target'));if(!g.every(Number.isFinite)||!t.every(Number.isFinite)||g[2]<30||g[3]<30)return false;
 const signature=[...g,...t].map(v=>Math.round(v/4)).join(':')+':'+JSON.stringify(root.RiftZonesV071?.art()||null);if(lastRect&&signature!==lastRect){tr.epoch++;tr.prev=null;tr.stable=0;if(seenLock){tr.anchor=null;tr.phase='held';lastD=null;anchorInvalid=true;}else tr.reset();}lastRect=signature;
 const [x,y,w,h]=g;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);ctx.drawImage(video,x-w*M,y-h*M,w*(1+2*M),h*(1+2*M),0,0,W,H);
 const data=ctx.getImageData(0,0,W,H).data,p=new Uint8Array(W*H);for(let j=0,i=0;j<p.length;j++,i+=4)p[j]=(.299*data[i]+.587*data[i+1]+.114*data[i+2]);
 const z=zones(g,t),f={w:W,h:H,p};
 // Do not advance temporal counters twice for the same decoded frame.
 if(stamp!==lastStamp){lastStamp=stamp;samples++;if(seenLock&&anchorInvalid){lastD=describe(f,z);}else{const r=tr.step(f,z,performance.now());lastD=r.d;if(r.rearm){seenLock=null;locked=null;candidate=null;history=[];if(typeof absent!=='undefined')absent=0;cameraEpoch++;lastEpoch=cameraEpoch;el('guide').classList.remove('locked');if(typeof status==='function')status('Ready for next card · automatic replacement');document.dispatchEvent(new Event('riftscan:rearmed'));rearms++;}}}
 draw(z);overlay.dataset.phase=tr.phase;
 const labels={seeking:'Align card · waiting for stability',ready:'New card ready · reading',held:'Card saved · remove it fully',removing:'Removing card · keep going',departed:'Card removed · align next copy',probe:'Changed image · checking for a different ID'};say(anchorInvalid?'Saved lock retained · alignment changed, use Next after replacing':labels[tr.phase]||tr.phase);stats.textContent=`${samples} samples · ${rearms} auto rearms · ${skips} OCR batches avoided${errors?` · ${errors} tracker errors`:''}`;return true;
}
function safeSample(force=false){try{return sample(force);}catch(e){errors++;enabled.checked=false;overlay.hidden=true;say('Tracker stopped: '+e.message+' · manual Next available');console.warn(e);return false;}}
// Before a card is actually saved, the artwork tracker must not veto a readable ID.
function initialToken(lock,remembered,epoch){return !lock&&!remembered?{phase:'initial',epoch}:null;}
function initialValid(token,lock,remembered,epoch){return token?.phase==='initial'&&token.epoch===epoch&&!lock&&!remembered;}
root.RiftTrackerV07={
 begin(){
   if(!active())return {bypass:true};
   const sampled=safeSample();
   if(!active())return {bypass:true};
   const first=initialToken(locked,seenLock,cameraEpoch);
   if(first)return first;
   if(!sampled){skips++;return null;}
   const token=tr.begin(performance.now(),!!candidate?.n);if(!token)skips++;return token;
 },
 valid(token){
   if(token?.bypass)return true;
   if(!active())return false;
   // Frozen ID quality and post-OCR ID comparison remain in best-frame module.
   if(token?.phase==='initial')return initialValid(token,locked,seenLock,cameraEpoch);
   safeSample();return active()&&tr.valid(token);
 }
};
el('next')?.addEventListener('click',()=>{reset();cameraEpoch++;lastEpoch=cameraEpoch;},true);
for(const id of ['trackerEnabledV07','bestFrameEnabled'])el(id)?.addEventListener('change',()=>{reset();cameraEpoch++;candidate=null;lastEpoch=cameraEpoch;});
setInterval(()=>safeSample(),80);el('versionTag').textContent='V0.7.1 · zone calibration';
})(typeof globalThis!=='undefined'?globalThis:this);
