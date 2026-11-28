/* Isolated stack movement experiment. No OCR or collection access. */
(function(root){'use strict';
const W=144,H=192;
const defaults={art:{x:42,y:29,w:60,h:26},id:{x:32,y:140,w:48,h:12}};
const zones=JSON.parse(JSON.stringify(defaults));
function setZone(name,z){if(!Object.hasOwn(defaults,name))return false;const a={x:Math.round(z.x),y:Math.round(z.y),w:Math.round(z.w),h:Math.round(z.h)};if(!Object.values(a).every(Number.isFinite)||a.w<12||a.h<6||a.x<0||a.y<0||a.x+a.w>W||a.y+a.h>H)return false;Object.assign(zones[name],a);return true;}
const cfg={artMove:5,idMove:8,range:30,loss:.62,stable:.28};
function patch(f,z,dx=0,dy=0){
 const x=z.x+dx,y=z.y+dy;if(!f||x<0||y<0||x+z.w>f.w||y+z.h>f.h)return null;
 const a=new Float32Array(Math.ceil(z.w/2)*Math.ceil(z.h/2));let n=0,sum=0,sq=0;
 for(let j=0;j<z.h;j+=2)for(let i=0;i<z.w;i+=2){const v=f.p[(y+j)*f.w+x+i];a[n++]=v;sum+=v;sq+=v*v;}
 const mean=sum/n,sd=Math.sqrt(Math.max(0,sq/n-mean*mean));
 if(sd>=3)for(let i=0;i<n;i++)a[i]=(a[i]-mean)/sd;
 return {a,mean,sd};
}
function error(a,b){if(!a||!b||a.a.length!==b.a.length||Math.min(a.sd,b.sd)<3)return Infinity;let d=0;for(let i=0;i<a.a.length;i++)d+=Math.abs(a.a[i]-b.a[i]);return d/a.a.length;}
function describe(f){return {art:patch(f,zones.art),id:patch(f,zones.id)};}
function match(a,f,z,range=cfg.range){
 let best={error:Infinity,dx:0,dy:0};
 const test=(dx,dy)=>{const e=error(a,patch(f,z,dx,dy));if(e<best.error-1e-7||(Math.abs(e-best.error)<1e-7&&Math.hypot(dx,dy)<Math.hypot(best.dx,best.dy)))best={error:e,dx,dy};};
 test(0,0);for(let y=-range;y<=range;y+=3)for(let x=-range;x<=range;x+=3)test(x,y);
 const b={...best};for(let y=b.dy-2;y<=b.dy+2;y++)for(let x=b.dx-2;x<=b.dx+2;x++)if(Math.abs(x)<=range&&Math.abs(y)<=range)test(x,y);
 return best;
}
function textured(d){return d.art?.sd>=7&&d.id?.sd>=5;}
class Tracker{
 constructor(){this.reset();}
 reset(){this.anchor=null;this.prev=null;this.lastStamp=null;this.lastTime=null;this.moved=false;this.lost=false;this.snap=false;this.lastAway=0;this.stable=0;this.events=0;this.phase='align';}
 arm(f){const d=describe(f);if(!textured(d))return false;this.anchor=d;this.prev=d;this.moved=this.lost=this.snap=false;this.lastAway=0;this.stable=0;this.phase='held';return true;}
 step(f,now,stamp){
  if(stamp===this.lastStamp)return null;
  if(this.lastTime!==null&&now-this.lastTime>500){this.stable=0;this.moved=this.lost=this.snap=false;this.lastAway=0;this.prev=null;}
  this.lastTime=now;this.lastStamp=stamp;
  const d=describe(f),prev=this.prev;this.prev=d;
  const still=!!prev&&error(prev.art,d.art)<cfg.stable&&error(prev.id,d.id)<cfg.stable;
  if(!this.anchor)return {phase:'align',still,textured:textured(d),event:null};
  const art=match(this.anchor.art,f,zones.art),id=match(this.anchor.id,f,zones.id);
  const artOK=art.error<cfg.loss,idOK=id.error<cfg.loss;
  const da=Math.hypot(art.dx,art.dy),di=Math.hypot(id.dx,id.dy);
  const coherent=artOK&&idOK&&Math.hypot(art.dx-id.dx,art.dy-id.dy)<=6;
  const away=coherent&&da>=cfg.artMove&&di>=cfg.idMove;
  const fixedArt=error(this.anchor.art,d.art),fixedId=error(this.anchor.id,d.id);
  const centered=fixedArt<.32&&fixedId<.32;
  const different=(fixedArt>=.62&&fixedId>=.28)||(fixedId>=.62&&fixedArt>=.28)||fixedArt>=.85||fixedId>=.85;
  const bothLost=!artOK&&!idOK;
  const farAway=away&&Math.min(da,di)>=18;
  // One confident outward match can survive partial occlusion of the other.
  const singleOut=!centered&&((art.error<.32&&da>=18&&(!idOK||fixedId<.32))||(id.error<.32&&di>=18&&(!artOK||fixedArt<.32)));
  if(this.lastAway>=18&&!away&&(centered||artOK&&idOK&&da<cfg.artMove&&di<cfg.idMove))this.snap=true;
  this.lastAway=away?Math.min(da,di):singleOut?Math.max(art.error<.32?da:0,id.error<.32?di:0):0;
  if(away||singleOut){this.moved=true;this.snap=false;}
  if(this.moved&&(bothLost||!coherent&&!centered))this.lost=true;
  // Fixed-center handoff does not require both old patterns to disappear.
  const newCenter=!centered&&different&&(!coherent||farAway);
  const possibleSame=this.moved&&(this.lost||this.snap)&&centered;
  const candidate=textured(d)&&still&&(newCenter||possibleSame);
  this.stable=candidate?this.stable+1:0;
  let event=null;
  const evidence={moved:this.moved,lost:this.lost,snap:this.snap,stable:this.stable};
  if(this.stable>=3){
   event={type:possibleSame?(this.snap?'same-appearance-after-outward-motion':'same-appearance-after-exit'):farAway?'changed-center-with-old-card-offset':'new-center-appearance',ambiguous:true,index:++this.events};
   this.arm(f);this.phase='replacement';
  }else if(candidate)this.phase='settling new center';
  else if(centered&&!this.lost&&!this.snap){this.moved=false;this.phase='held';}
  else if(away)this.phase=still?'old match offset · center uncertain':'moving';
  else this.phase=bothLost?'occluded / lost':still?'stable center · uncertain':'uncertain';
  return {phase:this.phase,art,id,da,di,coherent,away,centered,bothLost,different,still,textured:textured(d),fixedArt,fixedId,farAway,newCenter,singleOut,...evidence,event};
 }
}
const api={W,H,zones,defaults,setZone,cfg,patch,error,match,describe,Tracker};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RiftMovement=api;
})(typeof globalThis!=='undefined'?globalThis:this);
