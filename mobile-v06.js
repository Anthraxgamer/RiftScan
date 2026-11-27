/* RiftScan V0.6 mobile workspace. Load after V0.5.5 best-frame module. */
(function(){
'use strict';
const keyOf=c=>`${String(c.set).toUpperCase()} ${String(c.num).toLowerCase()}`;
function summarize(cards){
  const stacks=new Map();
  for(const c of cards){const k=keyOf(c);let g=stacks.get(k);if(!g){g={key:k,total:0,normal:0,foil:0,review:0};stacks.set(k,g);}g.total++;if(['normal','foil','review'].includes(c.finish))g[c.finish]++;}
  return stacks;
}
function findNewCard(cards,known,code){return [...cards].reverse().find(c=>!known.has(c.id)&&keyOf(c)===code)||null;}
if(typeof module!=='undefined'&&module.exports){module.exports={summarize,findNewCard,keyOf};return;}
const el=id=>document.getElementById(id), workspace=el('cameraWorkspace'), camera=el('cameraPanel'), collection=el('collectionPanel'), toggle=el('toggleCameraPanel'), list=el('list');
if(!workspace||!camera||!collection||!toggle||!list)return;
const warn=el('v06Compatibility');
const warning=message=>{warn.hidden=false;warn.textContent=message;};
const cards=()=>typeof items!=='undefined'&&Array.isArray(items)?items:[];
const haveItems=typeof items!=='undefined'&&Array.isArray(items);
let settingsOpen=false;
function setPanel(open){
  settingsOpen=open;camera.hidden=!open;collection.hidden=open;
  workspace.classList.remove('panelClosed');toggle.textContent=open?'Show collection':'Camera settings';toggle.setAttribute('aria-expanded',String(open));
}
// Supersede older hide-settings click behavior without changing the actual crop width.
toggle.addEventListener('click',e=>{e.stopImmediatePropagation();e.preventDefault();setPanel(!settingsOpen);},true);
setPanel(false);
const openKeys=new Set();let recentKey=null,recentId=null,receiptAt=0,forceNext=false;
function node(t,cls,text){const n=document.createElement(t);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
function groupRows(){
  const rows=[...list.children].filter(n=>n.classList.contains('item'));
  const summary=summarize(cards());
  if(haveItems)el('unique').textContent=String(summary.size);
  // Preserve original controls, click handlers, IDs and per-copy finish edits.
  if(!rows.length)return;
  const byKey=new Map();
  for(const row of rows){const k=row.querySelector('b')?.textContent.trim();if(!k||!summary.has(k)){warning('Collection grouping unavailable for this scanner version. Original entries remain editable.');return;}if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(row);}
  const order=[...byKey.keys()];if(recentKey&&order.includes(recentKey)){order.splice(order.indexOf(recentKey),1);order.unshift(recentKey);}
  const fragment=document.createDocumentFragment();
  for(const k of order){const g=summary.get(k),d=node('details','cardStack');d.dataset.key=k;d.open=openKeys.has(k);d.dataset.recent=String(k===recentKey);
    const s=node('summary'),title=node('span','stackTitle'),left=node('strong');left.append(node('span','stackCaret','›'),document.createTextNode(k));title.append(left,node('strong',null,`×${g.total}`));s.append(title);
    const counts=[g.normal&&`${g.normal} normal`,g.foil&&`${g.foil} foil`,g.review&&`${g.review} review`].filter(Boolean).join(' · ');s.append(node('span','stackBreakdown',counts));if(k===recentKey)s.append(node('span','stackAdded','+1 last scan'));d.append(s,...byKey.get(k));
    d.addEventListener('toggle',()=>{if(!d.isConnected)return;if(d.open)openKeys.add(k);else openKeys.delete(k);});fragment.append(d);
  }
  list.append(fragment);
}
function highlight(){
  for(const d of list.querySelectorAll('.cardStack')){const active=d.dataset.key===recentKey;d.dataset.recent=String(active);const s=d.querySelector('summary'),old=s?.querySelector('.stackAdded');if(active&&!old)s?.append(node('span','stackAdded','+1 last scan'));else if(!active&&old)old.remove();if(active&&d!==list.firstElementChild)list.prepend(d);}
  list.scrollTop=0;
}
const receipt=el('receiptV06'),title=el('receiptTitle'),detail=el('receiptDetail'),badge=el('scanBadge'),guide=el('guide');
let known=new Set(cards().map(c=>c.id)), pending=new Map();
let lastPerf=Number(el('perfSaved')?.textContent)||0,lastStatus='';
function receiptFor(c){
  recentId=c.id;recentKey=keyOf(c);receiptAt=performance.now();forceNext=false;
  const stack=summarize(cards()).get(recentKey);const persisted=typeof storageOK!=='undefined'?storageOK:! /unavailable/i.test(el('storage')?.textContent||'');
  receipt.dataset.saved=String(persisted);receipt.dataset.warning=String(!persisted);
  title.textContent=persisted?`✓ CARD SAVED · ${recentKey}`:`CARD ADDED · ${recentKey}`;
  detail.textContent=`+1 · Copy #${stack?.total||1} · ${cards().length} total${persisted?' · Ready for next card':' · Local storage unavailable'}`;
  receipt.classList.remove('flash');void receipt.offsetWidth;receipt.classList.add('flash');
  highlight();
  // Existing automatic-save beep remains in the scanner; receipt vibration is opt-in.
  if(el('hapticV06')?.checked)try{navigator.vibrate?.([65,40,100]);}catch(_){}
  phase(persisted?'saved':'warning',persisted?`✓ SAVED · ${recentKey}`:'ADDED · STORAGE WARNING');
}
function reconcile(){
  const current=cards(),ids=new Set(current.map(c=>c.id));
  for(const c of current)if(!known.has(c.id))pending.set(c.id,{card:c,at:performance.now()});
  known=ids;
  for(const [id,p] of pending)if(!ids.has(id)||performance.now()-p.at>3000)pending.delete(id);
  const count=Number(el('perfSaved')?.textContent)||0, code=el('lastScanCode')?.textContent.trim().replace(/^(\w+)\s+(\w+)$/,(_,a,b)=>a.toUpperCase()+' '+b.toLowerCase());
  // V0.5 reports an automatic save via its performance counter. Cross-check a new actual item.
  if(count>lastPerf){const c=findNewCard([...pending.values()].map(p=>p.card),new Set(),code);
    lastPerf=count; // consume counter increment once; never pair it with a later manual addition
    if(c){pending.delete(c.id);receiptFor(c);}
  }else if(count<lastPerf)lastPerf=count;
  if(recentId&&!ids.has(recentId)){
    recentId=null;recentKey=null;receiptAt=0;forceNext=true;receipt.dataset.saved='false';receipt.dataset.warning='false';title.textContent='Last scan removed';detail.textContent=`${current.length} cards in collection · Wait for next save.`;highlight();
  }
}
function phase(p,label){if(guide.dataset.phase!==p)guide.dataset.phase=p;if(badge.dataset.phase!==p)badge.dataset.phase=p;if(badge.textContent!==label)badge.textContent=label;}
function tick(){
  const status=el('status')?.textContent.trim()||'',ocr=el('ocrState')?.textContent.trim()||'',frame=el('bestFrameV055')?.textContent||'';
  const active=typeof stream!=='undefined'&&!!stream, isPaused=typeof paused!=='undefined'&&paused, isAdjusting=typeof adjusting!=='undefined'&&adjusting;
  const checking=status.match(/^Checking\s+([A-Z]{3}\s+\d{3,4}[a-z]?)/i), sameLock=typeof locked!=='undefined'&&locked===recentKey;
  if(checking&&checking[1]!==recentKey)forceNext=true;
  if(status!==lastStatus&&/^Ready|^Align a different/i.test(status))forceNext=true;
  lastStatus=status;
  if(!active){phase('waiting','CAMERA OFF');return;}
  if(isPaused){phase('waiting','PAUSED');return;}
  if(isAdjusting){phase('waiting','ADJUSTING CAMERA');return;}
  if(/^Scan error|^Could not start/i.test(status)){phase('warning','SCAN ERROR');return;}
  if(el('bestFrameEnabled')?.checked&&globalThis.RiftCapture0731?.phase==='retry'){phase('warning','RETRY CAPTURE');return;}
  if(recentId&&!forceNext&&(performance.now()-receiptAt<1500||sameLock&&!checking)){const saved=receipt.dataset.saved==='true';phase(saved?'saved':'warning',saved?`✓ SAVED · ${recentKey}`:'ADDED · STORAGE WARNING');return;}
  if(checking){phase('confirming',`CONFIRMING · ${checking[1]}`);return;}
  const capture=globalThis.RiftCapture0731;
  if(el('bestFrameEnabled')?.checked&&capture){
    if(capture.phase==='capturing'){phase('capturing','CAPTURING IMAGE');return;}
    if(capture.phase==='reading'){phase('reading','READING CARD');return;}
    if(capture.phase==='held'){
      const lock=typeof locked!=='undefined'?locked:null;
      const saved=lock&&cards().some(c=>keyOf(c)===lock);
      phase('waiting',saved?'WAITING FOR NEXT CARD':lock?'REPLACE CARD / NEXT':'ALIGN / HOLD STEADY');return;
    }
    if(capture.phase==='error'){phase('warning','OCR ERROR');return;}
    if(capture.phase==='waiting'){phase('waiting','ALIGN / HOLD STEADY');return;}
  }
  if(/^Reading/i.test(ocr)&&(!el('bestFrameEnabled')?.checked||!capture||capture.phase!=='complete')){phase('reading','READING CARD');return;}
  if(el('bestFrameEnabled')?.checked&&!capture&&/^(Collecting four|Waiting for steady)/i.test(frame)){phase('capturing','CAPTURING IMAGE');return;}
  phase('waiting','ALIGN CARD');
}
// Original render may be wrapped by V0.5 or invoked via event handlers; observe its output, not its implementation.
const listObserver=new MutationObserver(()=>{if(haveItems)groupRows();reconcile();});listObserver.observe(list,{childList:true});
const saveObserver=new MutationObserver(()=>{reconcile();tick();});
for(const id of ['perfSaved','lastScanCode','total']){const e=el(id);if(e)saveObserver.observe(e,{childList:true,characterData:true,subtree:true});}
el('next')?.addEventListener('click',()=>{forceNext=true;},true);
document.addEventListener('riftscan:rearmed',()=>{forceNext=true;tick();});
if(haveItems){groupRows();}else warning('Collection state unavailable: original list is preserved; enhanced save receipts and stacking are disabled.');
// Preserve original sound as fallback; use a distinctive rising two-tone on successful scanner beep.
if(typeof beep==='function'){
  const original=beep;
  try{beep=function(...args){
    if(!el('sound')?.checked)return;
    if(typeof audio==='undefined'||!audio||audio.state!=='running')return original.apply(this,args);
    try{const start=audio.currentTime;for(const [offset,freq] of [[0,720],[.09,1080]]){const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=freq;g.gain.setValueAtTime(.075,start+offset);g.gain.exponentialRampToValueAtTime(.001,start+offset+.12);o.connect(g);g.connect(audio.destination);o.start(start+offset);o.stop(start+offset+.13);}}catch(_){return original.apply(this,args);}
  };}catch(_){/* original beep remains */}
}
// Polling only lightweight state; no additional OCR, pixel capture or DOM rebuilding.
setInterval(tick,120);tick();
el('versionTag').textContent='V0.6 · mobile lab';
})();
