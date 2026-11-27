/* RiftScan V0.7.1 — persistent, bounded, responsive calibration. */
(function(root){'use strict';
const defaults={guideWidth:90,guideX:50,guideY:50,idLeft:5,idWidth:58,idHeight:15,artLeft:14,artTop:12,artWidth:72,artHeight:49};
const ranges={guideWidth:[55,96],guideX:[0,100],guideY:[0,100],idLeft:[0,85],idWidth:[15,95],idHeight:[5,30],artLeft:[0,85],artTop:[0,85],artWidth:[15,100],artHeight:[15,85]};
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function normalize(raw={}){const o={};for(const [k,[lo,hi]] of Object.entries(ranges)){const v=raw?.[k];o[k]=typeof v==='number'&&Number.isFinite(v)?clamp(v,lo,hi):defaults[k];}return o;}
function boundedRect(x,y,w,h){return {x:clamp(x,0,100-w)/100,y:clamp(y,0,100-h)/100,w:w/100,h:h/100};}
function art(s){return boundedRect(s.artLeft,s.artTop,s.artWidth,s.artHeight);}
function geometry(s,w,h){const width=Math.min(w*s.guideWidth/100,h*.67),height=width*88/63;return {width,height,x:clamp(w*s.guideX/100,width/2,w-width/2),y:clamp(h*s.guideY/100,height/2,h-height/2)};}
if(typeof module!=='undefined'&&module.exports){module.exports={normalize,art,geometry,boundedRect,defaults};return;}
const $=id=>document.getElementById(id),view=$('view'),guide=$('guide'),target=$('target'),artPreview=$('calArtV071'),panel=$('cameraPanel'),details=$('zoneSettingsV071'),note=$('zoneNoteV071'),offset=$('targetOffset');
if(!view||!guide||!target||!details)return;
const key='riftscan-zones-v071';let s=normalize(),editing=false,changed=false;
try{s=normalize(JSON.parse(localStorage.getItem(key)||'{}'));}catch(_){}
root.RiftZonesV071={art:()=>art(s)};
function tell(t){note.textContent=t;}
function persist(){try{localStorage.setItem(key,JSON.stringify(s));return true;}catch(_){return false;}}
function invalidate(){if(typeof cameraEpoch!=='undefined')cameraEpoch++;if(typeof candidate!=='undefined')candidate=null;if(typeof history!=='undefined')history=[];}
function apply(){const g=geometry(s,view.clientWidth,view.clientHeight);if(g.width>0){guide.style.width=g.width+'px';guide.style.left=g.x+'px';guide.style.top=g.y+'px';}target.style.left=clamp(s.idLeft,0,100-s.idWidth)+'%';target.style.width=s.idWidth+'%';target.style.height=s.idHeight+'%';const a=art(s);for(const [k,v] of Object.entries({left:a.x,top:a.y,width:a.w,height:a.h}))artPreview.style[k]=(v*100)+'%';for(const k of Object.keys(defaults)){$('zone-'+k).value=s[k];$('out-'+k).textContent=s[k]+'%';}}
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
if(typeof ResizeObserver!=='undefined')new ResizeObserver(apply).observe(view);else root.addEventListener('resize',apply);
apply();$('versionTag').textContent='V0.7.1 · zone calibration';
})(typeof globalThis!=='undefined'?globalThis:this);
