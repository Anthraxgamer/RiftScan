/* RiftScan V0.7.3 — fullscreen lifecycle and overlay controls. No OCR changes. */
(function(){'use strict';
const $=id=>document.getElementById(id), sec=$('scannerSection'),start=$('start'),stop=$('stop'),settings=$('cameraPanel'),toggle=$('toggleCameraPanel'),bottom=$('scanBottom073'),home=$('homeLaunch073');
if(!sec||!start||!stop||!settings||!toggle||!bottom||!home)return;
let active=false,native=false,serial=0,closing=false;
const notice=document.createElement('p');notice.id='homeNotice073';notice.setAttribute('role','status');home.append(notice);
const refresh=()=>{window.RiftZonesV071?.refresh?.();};
function pauseIfRunning(){if(typeof stream!=='undefined'&&stream&&typeof paused!=='undefined'&&!paused&&!$('pauseScan').disabled)$('pauseScan').click();}
function closeSettings(){if(!settings.hidden)toggle.click();$('zoneSettingsV071').open=false;}
function setExpanded(on){if(on)pauseIfRunning();bottom.classList.toggle('expanded073',on);$('quickCollection073').textContent=on?'Collapse list':'Expand list';$('quickCollection073').setAttribute('aria-expanded',String(on));}
function leave(message=''){
 if(!active)return;active=false;serial++;closing=true;native=false;closeSettings();setExpanded(false);
 sec.classList.remove('immersive073');document.body.classList.remove('immersiveActive073');notice.textContent=message;
 if(document.fullscreenElement===sec&&document.exitFullscreen){try{Promise.resolve(document.exitFullscreen()).catch(()=>{}).finally(()=>{closing=false;});}catch(_){closing=false;}}else closing=false;
}
function enter(){
 if(active)return;active=true;const id=++serial;native=false;notice.textContent='';sec.classList.add('immersive073');document.body.classList.add('immersiveActive073');setExpanded(false);
 // Request during the original Start click; unsupported/denied browsers retain viewport mode.
 if(sec.requestFullscreen){try{Promise.resolve(sec.requestFullscreen()).then(()=>{if(id!==serial||!active){if(document.fullscreenElement===sec)document.exitFullscreen?.().catch(()=>{});return;}native=document.fullscreenElement===sec;refresh();}).catch(()=>{if(active&&id===serial)refresh();});}catch(_){/* viewport fallback */}}
 refresh();
}
start.addEventListener('click',enter,true);
// Do not replace the underlying camera start/stop handlers.
stop.addEventListener('click',()=>setTimeout(()=>leave()),true);
document.addEventListener('fullscreenchange',()=>{if(!active||closing)return;if(document.fullscreenElement===sec){native=true;refresh();}else if(native){stop.click();leave();}});
// Keep scanner state and overlay controls in sync; never resume implicitly.
document.addEventListener('click',e=>{if(e.target===toggle||toggle.contains(e.target))setTimeout(()=>{if(active&&!settings.hidden){pauseIfRunning();setExpanded(false);}refresh();});},true);
$('calibrateV071').addEventListener('click',()=>setTimeout(()=>{pauseIfRunning();setExpanded(false);refresh();}),true);
$('quickPause073').addEventListener('click',()=>{if(!settings.hidden)closeSettings();setExpanded(false);$('scanToggleV4').click();});
$('quickNext073').addEventListener('click',()=>$('next').click());
$('quickCollection073').addEventListener('click',()=>{if(!settings.hidden)closeSettings();setExpanded(!bottom.classList.contains('expanded073'));});
// A camera rejection or startup failure returns to home and preserves its diagnostic.
function tick(){
 if(!active)return;
 const p=$('scanToggleV4'),q=$('quickPause073'),n=$('quickNext073');q.disabled=p.disabled;n.disabled=$('next').disabled;
 q.textContent=typeof paused!=='undefined'&&paused?'Resume':'Pause';
 toggle.textContent=settings.hidden?'Settings':'Close';
 if(typeof stream!=='undefined'&&typeof busy!=='undefined'&&!stream&&!busy&&!start.disabled){const msg=$('status').textContent;if(/^Could not start|^Camera off|^Scan error/i.test(msg))leave(msg==='Camera off.'?'':msg);}
}
setInterval(tick,120);window.addEventListener('resize',refresh);window.visualViewport?.addEventListener('resize',refresh);
$('versionTag').textContent='V0.7.3 · immersive scanner';
})();
