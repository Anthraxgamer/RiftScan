/* RiftScan V0.7.2 — persistent, bounded, responsive calibration. */
(function(root){'use strict';
const defaults={guideWidth:94,guideX:50,guideY:50,idLeft:5,idWidth:58,idHeight:9,artLeft:12,artTop:8,artWidth:76,artHeight:31};
const ranges={guideWidth:[40,99],guideX:[0,100],guideY:[0,100],idLeft:[0,85],idWidth:[15,95],idHeight:[5,30],artLeft:[0,85],artTop:[0,85],artWidth:[15,100],artHeight:[15,85]};
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function normalize(raw={}){const o={};for(const [k,[lo,hi]] of Object.entries(ranges)){const v=raw?.[k];o[k]=typeof v==='number'&&Number.isFinite(v)?clamp(v,lo,hi):defaults[k];}return o;}
function boundedRect(x,y,w,h){return {x:clamp(x,0,100-w)/100,y:clamp(y,0,100-h)/100,w:w/100,h:h/100};}
function art(s){return boundedRect(s.artLeft,s.artTop,s.artWidth,s.artHeight);}
function geometry(s,w,h){const width=Math.min(w*s.guideWidth/100,h*63/88*.97),height=width*88/63;return {width,height,x:clamp(w*s.guideX/100,width/2,w-width/2),y:clamp(h*s.guideY/100,height/2,h-height/2)};}
// CSS object-fit: contain displays the entire video frame, including on narrow phones.
function contentRect(vw,vh,sw,sh,fit="contain"){if(!(vw>0&&vh>0&&sw>0&&sh>0))return {x:0,y:0,w:vw,h:vh,scale:1};const scale=(fit==="cover"?Math.max:Math.min)(vw/sw,vh/sh),w=sw*scale,h=sh*scale;return {x:(vw-w)/2,y:(vh-h)/2,w,h,scale};}
function sourceRect(view,region,sw,sh,fit="contain"){const q=contentRect(view.width,view.height,sw,sh,fit);return [(region.left-view.left-q.x)/q.scale,(region.top-view.top-q.y)/q.scale,region.width/q.scale,region.height/q.scale];}
// Fit the card inside the visible image, away from fixed toolbar/drawer footprints.
function usableRect(w,h,top=0,bottom=0,side=0){const pad=8;const x=pad,y=clamp(top+pad,0,h);return {x,y,w:Math.max(0,w-side-2*pad),h:Math.max(0,h-y-bottom-pad)};}
if(typeof module!=='undefined'&&module.exports){module.exports={normalize,art,geometry,boundedRect,defaults,contentRect,sourceRect,usableRect};return;}
const $=id=>document.getElementById(id),view=$('view'),guide=$('guide'),target=$('target'),artPreview=$('calArtV071'),panel=$('cameraPanel'),details=$('zoneSettingsV071'),note=$('zoneNoteV071'),offset=$('targetOffset');
if(!view||!guide||!target||!details)return;
const key='riftscan-zones-v072';let s=normalize(),editing=false,changed=false;
try{s=normalize(JSON.parse(localStorage.getItem(key)||'{}'));}catch(_){}
root.RiftZonesV071={art:()=>art(s),refresh:()=>apply()};
const v= $('video');
// The old scanner assumes object-fit: cover. Replace that mapping for *all* crop consumers.
const immersive=()=>!!$('scannerSection')?.classList.contains('immersive073');
const fit=()=>immersive()?'cover':'contain';
if(typeof getRect==='function')getRect=function(element){return sourceRect(v.getBoundingClientRect(),element.getBoundingClientRect(),v.videoWidth,v.videoHeight,fit());};
function tell(t){note.textContent=t;}
function persist(){try{localStorage.setItem(key,JSON.stringify(s));return true;}catch(_){return false;}}
function invalidate(){if(typeof cameraEpoch!=='undefined')cameraEpoch++;if(typeof candidate!=='undefined')candidate=null;if(typeof history!=='undefined')history=[];}
let lastGeometry=null;
function apply(){
 const vw=view.clientWidth,vh=view.clientHeight;if(!vw||!vh)return;
 let q=contentRect(vw,vh,v.videoWidth,v.videoHeight,fit());
 if(immersive()){
   const top=$('scanTop073'),bottom=$('scanBottom073'),r=view.getBoundingClientRect();
   const land=vw>=600&&vw>vh;
   // Keep geometry independent of the expanded drawer and settings panel.
   const reservedTop=top?Math.max(0,top.getBoundingClientRect().bottom-r.top):84;
   const reservedBottom=land?0:Math.max(180,Math.min(230,vh*.27))+Math.max(8,bottom? r.bottom-bottom.getBoundingClientRect().bottom:8);
   const reservedSide=land?Math.max(230,Math.min(350,vw*.28))+Math.max(8,bottom?r.right-bottom.getBoundingClientRect().right:8):0;
   q=usableRect(vw,vh,reservedTop,reservedBottom,reservedSide);
 }
 const g=geometry(s,q.w,q.h);if(g.width>0){guide.style.width=g.width+'px';guide.style.left=(q.x+g.x)+'px';guide.style.top=(q.y+g.y)+'px';}
 target.style.left=clamp(s.idLeft,0,100-s.idWidth)+'%';target.style.width=s.idWidth+'%';target.style.height=s.idHeight+'%';
 const a=art(s);for(const [k,val] of Object.entries({left:a.x,top:a.y,width:a.w,height:a.h}))artPreview.style[k]=(val*100)+'%';
 for(const k of Object.keys(defaults)){$('zone-'+k).value=s[k];$('out-'+k).textContent=s[k]+'%';}
 if(v.videoWidth&&g.width>0){const signature=[...getRect(guide),...getRect(target),v.videoWidth,v.videoHeight].map(n=>Math.round(n*2)/2).join(':');if(lastGeometry!==null&&lastGeometry!==signature)invalidate();lastGeometry=signature;}
}
function running(){return typeof stream!=='undefined'&&!!stream;}
function pause(){if(running()&&typeof paused!=='undefined'&&!paused){$('pauseScan').click();}return !running()||typeof paused!=='undefined'&&paused;}
function show(on){editing=on;view.dataset.calibrating=String(on);artPreview.hidden=!on;if(on&&$('trackerOverlayV07'))$('trackerOverlayV07').hidden=true;}
function begin(){if(!pause()){tell('Pause scanning before adjusting zones.');return false;}show(true);return true;}
function change(){changed=true;invalidate();apply();tell(persist()?'Zones saved. Resume scanning when aligned.':'Zones changed for this session; storage unavailable.');}
for(const k of Object.keys(defaults))$('zone-'+k).addEventListener('input',e=>{if(!begin()){apply();return;}s=normalize({...s,[k]:Number(e.target.value)});change();});
offset.addEventListener('input',()=>{if(begin()){changed=true;invalidate();tell('Collector vertical position adjusted. Resume when aligned.');}});
$('calibrateV071').addEventListener('click',()=>{if(panel.hidden)$('toggleCameraPanel').click();details.open=true;begin();panel.scrollTop+=details.getBoundingClientRect().top-panel.getBoundingClientRect().top-8;});
$('resetZonesV071').addEventListener('click',()=>{if(!begin())return;s=normalize();offset.value=3;offset.dispatchEvent(new Event('input',{bubbles:true}));change();});
$('doneZonesV071').addEventListener('click',()=>{show(false);details.open=false;if(!panel.hidden)$('toggleCameraPanel').click();if(running()&&changed&&typeof locked!=='undefined'&&locked)tell('Existing card remains locked. Replace it before using Ready for next card.');changed=false;});
details.addEventListener('toggle',()=>{if(details.open&&!panel.hidden)begin();else if(!details.open)show(false);});
setInterval(()=>{if(editing&&(panel.hidden||running()&&typeof paused!=='undefined'&&!paused))show(false);},100);
if(typeof ResizeObserver!=='undefined'){const ro=new ResizeObserver(apply);ro.observe(view);if($('scanTop073'))ro.observe($('scanTop073'));}else root.addEventListener('resize',apply);
v.addEventListener('loadedmetadata',()=>{invalidate();apply();});v.addEventListener('resize',()=>{invalidate();apply();});apply();$('versionTag').textContent='V0.7.2 · zone calibration';
})(typeof globalThis!=='undefined'?globalThis:this);
