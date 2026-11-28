/* Isolated stack movement experiment. No OCR or collection access. */
(function(root){'use strict';
const W=144,H=192;
const zones={art:{x:51,y:47,w:42,h:36},id:{x:35,y:143,w:42,h:12}};
const cfg={artMove:5,idMove:8,range:30,loss:.78,stable:.25};
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
 for(let y=-range;y<=range;y+=3)for(let x=-range;x<=range;x+=3)test(x,y);
 const b={...best};for(let y=b.dy-2;y<=b.dy+2;y++)for(let x=b.dx-2;x<=b.dx+2;x++)if(Math.abs(x)<=range&&Math.abs(y)<=range)test(x,y);
 return best;
}
function textured(d){return d.art?.sd>=7&&d.id?.sd>=5;}
class Tracker{
 constructor(){this.reset();}
 reset(){this.anchor=null;this.prev=null;this.lastStamp=null;this.lastTime=null;this.moved=false;this.lost=false;this.changed=false;this.stable=0;this.events=0;this.phase='align';}
 arm(f){const d=describe(f);if(!textured(d))return false;this.anchor=d;this.prev=d;this.moved=this.lost=this.changed=false;this.stable=0;this.phase='held';return true;}
 step(f,now,stamp){
  if(stamp===this.lastStamp)return null;
  if(this.lastTime!==null&&now-this.lastTime>500){this.stable=0;this.moved=this.lost=this.changed=false;this.prev=null;}
  this.lastTime=now;this.lastStamp=stamp;
  const d=describe(f),prev=this.prev;this.prev=d;
  const still=!!prev&&error(prev.art,d.art)<cfg.stable&&error(prev.id,d.id)<cfg.stable;
  if(!this.anchor)return {phase:'align',still,textured:textured(d),event:null};
  const art=match(this.anchor.art,f,zones.art),id=match(this.anchor.id,f,zones.id);
  const artOK=art.error<cfg.loss,idOK=id.error<cfg.loss;
  const da=Math.hypot(art.dx,art.dy),di=Math.hypot(id.dx,id.dy);
  const coherent=artOK&&idOK&&Math.hypot(art.dx-id.dx,art.dy-id.dy)<=6;
  const away=coherent&&da>=cfg.artMove&&di>=cfg.idMove;
  const centered=artOK&&idOK&&da<cfg.artMove&&di<cfg.idMove;
  const fixedArt=error(this.anchor.art,d.art),fixedId=error(this.anchor.id,d.id);
  const different=fixedArt>=cfg.loss&&fixedId>=cfg.loss;
  const bothLost=!artOK&&!idOK;
  if(away)this.moved=true;
  if(bothLost&&this.moved)this.lost=true;
  // A new card covering the old one may have no trackable translation.
  if(bothLost&&different)this.changed=true;
  const onNew=different&&bothLost;
  const possibleSame=this.moved&&this.lost&&centered;
  const candidate=textured(d)&&still&&(onNew&&this.changed||possibleSame);
  this.stable=candidate?this.stable+1:0;
  let event=null;
  if(this.stable>=3){
   event={type:possibleSame?'same-appearance-after-exit':'new-appearance',ambiguous:true,index:++this.events};
   this.arm(f);this.phase='replacement';
  }else if(centered&&!this.lost){this.moved=this.changed=false;this.phase='held';}
  else this.phase=away?'moving':bothLost?'occluded / lost':candidate?'settling':'uncertain';
  return {phase:this.phase,art,id,da,di,coherent,away,centered,bothLost,different,still,textured:textured(d),moved:this.moved,lost:this.lost,stable:this.stable,event};
 }
}
const api={W,H,zones,cfg,patch,error,match,describe,Tracker};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RiftMovement=api;
})(typeof globalThis!=='undefined'?globalThis:this);
