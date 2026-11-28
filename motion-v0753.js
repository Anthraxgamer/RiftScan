/* Experimental frame-rate motion / occlusion lab. Candidate events only. */
(function(root){'use strict';
const M=root.RiftMovement||(typeof require==='function'?require('./movement-v075.js'):null);
const card={x:27,y:22,w:90,h:132}, TILE=8;
const finite=x=>Number.isFinite(x)?x:9;
const inside=(x,y,r)=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h;
function motion(a,b){
 if(!a||!b)return {active:false,outer:0,inner:0,total:0,box:null,depth:null,tiles:[]};
 let offset=0,n=0;for(let i=0;i<b.p.length;i+=4){offset+=b.p[i]-a.p[i];n++;}offset/=n;
 let outer=0,inner=0,total=0,x0=b.w,y0=b.h,x1=0,y1=0,sx=0,sy=0;const tiles=[];
 for(let y=0;y<b.h;y+=TILE)for(let x=0;x<b.w;x+=TILE){
  let d=0,k=0;for(let j=y;j<Math.min(y+TILE,b.h);j+=2)for(let i=x;i<Math.min(x+TILE,b.w);i+=2){d+=Math.abs(b.p[j*b.w+i]-a.p[j*b.w+i]-offset);k++;}
  if(d/k<15)continue;
  const cx=x+TILE/2,cy=y+TILE/2;
  if(inside(cx,cy,card))inner++;else outer++;
  total++;sx+=cx;sy+=cy;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+TILE);y1=Math.max(y1,y+TILE);tiles.push({x,y});
 }
 const depth=total?Math.min(sx/total-card.x,card.x+card.w-sx/total,sy/total-card.y,card.y+card.h-sy/total):null;
 return {active:total>=3,outer,inner,total,box:total?{x:x0,y:y0,w:Math.min(b.w,x1)-x0,h:Math.min(b.h,y1)-y0}:null,depth,tiles};
}
function outline(f){
 const at=(x,y)=>f.p[y*f.w+x];
 function side(vertical,pos,lo,hi){
  let best=0;
  for(let shift=-4;shift<=4;shift+=2){
   let hits=0,n=0;const p=pos+shift;
   for(let q=lo+8;q<hi-8;q+=4){const a=vertical?at(p-2,q):at(q,p-2),b=vertical?at(p+2,q):at(q,p+2);if(Math.abs(a-b)>=13)hits++;n++;}
   best=Math.max(best,hits/Math.max(1,n));
  }return best;
 }
 const edges=[side(true,card.x,card.y,card.y+card.h),side(true,card.x+card.w,card.y,card.y+card.h),side(false,card.y,card.x,card.x+card.w),side(false,card.y+card.h,card.x,card.x+card.w)];
 return {edges,score:edges.filter(x=>x>=.36).length};
}
function diff(a,b){return {art:finite(M.error(a?.art,b?.art)),id:finite(M.error(a?.id,b?.id))};}
function texture(d){return d.art?.sd>=7&&d.id?.sd>=5;}
function matching(anchor,f){const art=M.match(anchor.art,f,M.zones.art),id=M.match(anchor.id,f,M.zones.id);const coherent=art.error<.45&&id.error<.45&&Math.hypot(art.dx-id.dx,art.dy-id.dy)<=6;return {art,id,coherent,dist:coherent?Math.min(Math.hypot(art.dx,art.dy),Math.hypot(id.dx,id.dy)):0};}
class MotionTracker{
 constructor(){this.reset();}
 reset(){this.anchor=null;this.prev=null;this.prevDesc=null;this.lastStamp=null;this.lastTime=null;this.lastMatchAt=-Infinity;this.matches=null;this.events=0;this.phase='align';this.history=[];this.episode=null;this.still=0;this.detailRuns=0;this.frames=0;}
 arm(f){const d=M.describe(f);if(!texture(d))return false;this.anchor=d;this.prev=f;this.prevDesc=d;this.anchorOutline=outline(f);this.episode=null;this.still=0;this.matches=null;this.lastMatchAt=-Infinity;this.phase='held';return true;}
 step(f,now,stamp){
  if(this.lastStamp===stamp)return null;
  if(this.lastTime!==null&&now-this.lastTime>500){this.episode=null;this.prev=null;this.prevDesc=null;this.still=0;this.matches=null;}
  this.lastStamp=stamp;this.lastTime=now;this.frames++;
  const m=motion(this.prev,f),d=M.describe(f),change=diff(this.anchor,d),delta=diff(this.prevDesc,d),edge=outline(f);
  this.prev=f;this.prevDesc=d;
  this.history.push({t:now,outer:m.outer,inner:m.inner,depth:m.depth,box:m.box});if(this.history.length>24)this.history.shift();
  const base={motion:m,change,outline:edge,texture:texture(d),event:null};
  if(!this.anchor)return {...base,phase:'align'};
  const same=change.art<.32&&change.id<.32;
  const different=change.art>=.85||change.id>=.85||(change.art>=.62&&change.id>=.28)||(change.id>=.62&&change.art>=.28);
  const still=delta.art<.28&&delta.id<.28&&!m.active;
  this.still=still?this.still+1:0;
  if(m.active){
   if(!this.episode)this.episode={started:now,last:now,outer:false,inner:false,inward:false,outward:false,crossing:false,depth:null,peak:0,oldOffset:false,oldFar:false,hadChanged:false,box:null,observations:0};
   const e=this.episode;e.last=now;e.observations++;e.peak=Math.max(e.peak,m.total);e.box=m.box;
   if(e.outer&&m.inner>=3)e.inward=true;
   if(e.inner&&m.outer>=3)e.outward=true;
   if(e.depth!==null&&m.depth!==null){if(m.depth-e.depth>5)e.inward=true;if(e.depth-m.depth>5)e.outward=true;}
   e.outer||=m.outer>=3;e.inner||=m.inner>=3;e.crossing||=e.outer&&e.inner;e.depth=m.depth;e.hadChanged||=different;
  }
  let e=this.episode;if(e&&now-e.last>950){this.episode=null;e=null;}
  // Search only during a transition, more frequently at its beginning to
  // avoid missing a brief displacement. The old reference is never overwritten here.
  const interval=e&&!e.oldFar&&e.observations<=3?28:75;
  if(e&&!same&&(now-this.lastMatchAt>=interval||!this.matches)){
   this.matches=matching(this.anchor,f);this.lastMatchAt=now;this.detailRuns++;
   e.oldOffset=this.matches.dist>=8;e.oldFar||=this.matches.dist>=18;
  }else if(same){this.matches={art:{dx:0,dy:0,error:change.art},id:{dx:0,dy:0,error:change.id},dist:0};if(e)e.oldOffset=false;}
  const aligned=edge.score>=Math.max(3,this.anchorOutline.score-1);
  const newCenter=!!e&&different&&e.inner&&aligned&&texture(d)&&!e.oldOffset;
  const identical=!!e&&same&&e.crossing&&e.oldFar&&aligned&&texture(d);
  let event=null;
  if(this.still>=2&&(newCenter||identical)){
   const type=identical?'ambiguous identical reveal':e.oldFar||e.outward&&!e.inward?'outgoing / revealed':e.inward&&!e.outward?'incoming / covered':'direction uncertain';
   event={index:++this.events,type,ambiguous:true,latencyMs:Math.round(now-e.started),oldFar:e.oldFar,crossing:e.crossing};
   this.arm(f);this.phase='replacement';
  }else if(e&&this.still>=3&&same&&!identical){this.episode=null;this.phase='held';}
  else if(e&&this.still>=3&&!aligned)this.phase='waiting for aligned card';
  else if(e&&this.still>=3&&e.oldOffset)this.phase='original card offset';
  else if(e&&this.still>=2&&(different||same))this.phase='settling / uncertain';
  else if(e)this.phase=e.oldFar?'outgoing motion':e.inward&&!e.outward?'incoming motion':e.outward&&!e.inward?'outgoing motion':'motion observed';
  else this.phase=same?'held':'uncertain';
  return {...base,phase:this.phase,event,art:this.matches?.art,id:this.matches?.id,episode:e?{...e}:null,still:this.still,aligned,same,different,detailRuns:this.detailRuns,frames:this.frames};
 }
}
const api={MotionTracker,motion,outline,card,TILE};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RiftOcclusion=api;
})(typeof globalThis!=='undefined'?globalThis:this);
