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
// Independent, short-lived incoming texture track. It is NOT the old template.
const size=16,center=r=>({x:r.x+r.w/2,y:r.y+r.h/2});
function overlap(a,b){return Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));}
function depth(r){const c=center(r);return Math.min(c.x-card.x,card.x+card.w-c.x,c.y-card.y,card.y+card.h-c.y);}
function seedIncoming(f,previous,m){
 if(!previous||!m.outer)return null;let best=null;
 for(const t of m.tiles){
  const x=Math.max(0,Math.min(f.w-size,t.x-4)),y=Math.max(0,Math.min(f.h-size,t.y-4)),r={x,y,w:size,h:size};
  if(overlap(r,card)>size*size*.4)continue;
  const p=M.patch(f,r),prior=M.patch(previous,r);if(!p||p.sd<10)continue;
  const change=finite(M.error(p,prior));if(change<.5)continue;
  const score=Math.min(change,2)*10+p.sd*.05+Math.max(-24,depth(r))*.25;
  if(!best||score>best.score)best={r,p,score};
 }
 return best?{box:best.r,template:best.p,startDepth:depth(best.r),maxDepth:depth(best.r),dx:0,dy:0,overlap:0,artOverlap:0,idOverlap:0,misses:0,travel:0,entered:false,quality:0}:null;
}
function advanceIncoming(t,f){
 const z=t.box;let best={error:Infinity,dx:0,dy:0};
 const test=(dx,dy)=>{const e=M.error(t.template,M.patch(f,z,dx,dy));if(e<best.error-1e-6||Math.abs(e-best.error)<1e-6&&Math.hypot(dx,dy)<Math.hypot(best.dx,best.dy))best={error:e,dx,dy};};
 test(0,0);for(let y=-24;y<=24;y+=4)for(let x=-24;x<=24;x+=4)test(x,y);
 const b={...best};for(let y=b.dy-3;y<=b.dy+3;y++)for(let x=b.dx-3;x<=b.dx+3;x++)test(x,y);
 if(best.error>.48){t.misses++;t.quality=finite(best.error);return t;}
 t.misses=0;t.quality=best.error;t.dx=best.dx;t.dy=best.dy;t.travel+=Math.hypot(best.dx,best.dy);
 t.box={...z,x:z.x+best.dx,y:z.y+best.dy};const dep=depth(t.box);t.maxDepth=Math.max(t.maxDepth,dep);
 t.overlap=overlap(t.box,card)/(size*size);t.artOverlap=overlap(t.box,M.zones.art)/(size*size);t.idOverlap=overlap(t.box,M.zones.id)/(size*size);
 t.entered||=t.maxDepth-t.startDepth>=7&&t.overlap>=.5&&t.travel>=7;
 return t;
}
function publicTrack(t){if(!t)return null;const {template,...rest}=t;return rest;}
class MotionTracker{
 constructor(){this.reset();}
 reset(){this.anchor=null;this.prev=null;this.prevDesc=null;this.lastStamp=null;this.lastTime=null;this.lastMatchAt=-Infinity;this.matches=null;this.events=0;this.phase='align';this.history=[];this.episode=null;this.still=0;this.detailRuns=0;this.frames=0;this.incoming=null;this.ambiguousReturns=0;this.lastAmbiguous=null;}
 arm(f){const d=M.describe(f);if(!texture(d))return false;this.anchor=d;this.prev=f;this.prevDesc=d;this.anchorOutline=outline(f);this.episode=null;this.incoming=null;this.still=0;this.matches=null;this.lastMatchAt=-Infinity;this.phase='held';return true;}
 step(f,now,stamp){
  if(this.lastStamp===stamp)return null;
  if(this.lastTime!==null&&now-this.lastTime>500){this.episode=null;this.incoming=null;this.prev=null;this.prevDesc=null;this.still=0;this.matches=null;}
  this.lastStamp=stamp;this.lastTime=now;this.frames++;
  const prior=this.prev,m=motion(prior,f),d=M.describe(f),change=diff(this.anchor,d),delta=diff(this.prevDesc,d),edge=outline(f);
  this.prev=f;this.prevDesc=d;
  this.history.push({t:now,outer:m.outer,inner:m.inner,depth:m.depth,box:m.box});if(this.history.length>24)this.history.shift();
  const base={motion:m,change,outline:edge,texture:texture(d),event:null};
  if(!this.anchor)return {...base,phase:'align'};
  const same=change.art<.32&&change.id<.32;
  const different=change.art>=.85||change.id>=.85||(change.art>=.62&&change.id>=.28)||(change.id>=.62&&change.art>=.28);
  const still=delta.art<.28&&delta.id<.28&&!m.active;
  this.still=still?this.still+1:0;
  if(m.active){
   if(!this.episode)this.episode={started:now,last:now,outer:false,inner:false,inward:false,outward:false,crossing:false,depth:null,peak:0,oldOffset:false,oldFar:false,oldMoved:false,oldLost:false,blueEntered:false,blueOverlap:false,hadChanged:false,box:null,observations:0};
   const e=this.episode;e.last=now;e.observations++;e.peak=Math.max(e.peak,m.total);e.box=m.box;
   if(e.outer&&m.inner>=3)e.inward=true;
   if(e.inner&&m.outer>=3)e.outward=true;
   if(e.depth!==null&&m.depth!==null){if(m.depth-e.depth>5)e.inward=true;if(e.depth-m.depth>5)e.outward=true;}
   e.outer||=m.outer>=3;e.inner||=m.inner>=3;e.crossing||=e.outer&&e.inner;e.depth=m.depth;e.hadChanged||=different;
  }
  let e=this.episode;if(e&&now-e.last>950){this.episode=null;this.incoming=null;e=null;}
  // Search only during a transition, more frequently at its beginning to
  // avoid missing a brief displacement. The old reference is never overwritten here.
  const interval=e&&!e.oldFar&&e.observations<=3?28:75;
  if(e&&!same&&(now-this.lastMatchAt>=interval||!this.matches||this.still===2)){
   this.matches=matching(this.anchor,f);this.lastMatchAt=now;this.detailRuns++;
   e.oldOffset=this.matches.dist>=8;e.oldMoved||=e.oldOffset;e.oldFar||=this.matches.dist>=18;e.oldLost||=e.oldMoved&&!this.matches.coherent;
  }else if(same){this.matches={art:{dx:0,dy:0,error:change.art},id:{dx:0,dy:0,error:change.id},dist:0};if(e)e.oldOffset=false;}
  // A green coherent displacement owns the motion. Blue is only an independent
  // incoming hypothesis when the original reference is not moving coherently.
  if(e){
   if(e.oldOffset){this.incoming=null;}
   else if(this.incoming){advanceIncoming(this.incoming,f);if(this.incoming.misses>2)this.incoming=null;}
   if(!this.incoming&&!e.oldMoved&&m.active)this.incoming=seedIncoming(f,prior,m);
   if(this.incoming){e.blueEntered||=this.incoming.entered;e.blueOverlap||=this.incoming.entered&&(this.incoming.artOverlap>.12||this.incoming.idOverlap>.12);}
  }else this.incoming=null;
  const incomingView=publicTrack(this.incoming);
  const aligned=edge.score>=Math.max(3,this.anchorOutline.score-1);
  const newCenter=!!e&&different&&e.inner&&aligned&&texture(d)&&!e.oldOffset;
  const identical=!!e&&same&&e.crossing&&e.oldFar&&aligned&&texture(d);
  // Same appearance after motion is not sufficient to distinguish a real identical
  // reveal from returning the same physical card. Report it separately, not as a count.
  let event=null;
  if(this.still>=2&&newCenter){
   const type=e.oldMoved?'outgoing / revealed':e.blueEntered&&e.blueOverlap?'incoming / covered':'direction uncertain';
   event={index:++this.events,type,ambiguous:true,latencyMs:Math.round(now-e.started),oldFar:e.oldFar,crossing:e.crossing,blueEntered:e.blueEntered,blueOverlap:e.blueOverlap};
   this.arm(f);this.phase='replacement';
  }else if(e&&this.still>=2&&identical){this.lastAmbiguous={index:++this.ambiguousReturns,type:'same appearance after outward motion',latencyMs:Math.round(now-e.started)};this.episode=null;this.incoming=null;this.phase='possible identical / return';}
  else if(e&&this.still>=3&&same){this.episode=null;this.incoming=null;this.phase='held';}
  else if(e&&this.still>=3&&!aligned)this.phase='waiting for aligned card';
  else if(e&&this.still>=3&&e.oldOffset)this.phase='original card offset';
  else if(e&&this.still>=2&&(different||same))this.phase='settling / uncertain';
  else if(e)this.phase=e.oldMoved?'outgoing motion':e.blueEntered?'incoming motion / overlap':this.incoming?'incoming motion / tracking':'motion observed';
  else this.phase=same?'held':'uncertain';
  const trusted=this.matches&&(same||this.matches.coherent);return {...base,phase:this.phase,event,art:trusted?this.matches.art:null,id:trusted?this.matches.id:null,incoming:incomingView,episode:e?{...e}:null,still:this.still,aligned,same,different,detailRuns:this.detailRuns,frames:this.frames,ambiguousReturns:this.ambiguousReturns,lastAmbiguous:this.lastAmbiguous};
 }
}
const api={MotionTracker,motion,outline,card,TILE,seedIncoming,advanceIncoming,overlap};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RiftOcclusion=api;
})(typeof globalThis!=='undefined'?globalThis:this);
