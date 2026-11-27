/* RiftScan V0.3: side-by-side camera controls and on-demand autofocus.
 * Loaded after the original V0.2 app.js; existing collection/OCR logic is unchanged.
 */
(() => {
  'use strict';
  const button = $('autofocus');
  const panel = $('cameraPanel');
  const toggle = $('toggleCameraPanel');
  const message = $('focusStatus');
  let focusing = false;
  let observedTrack = null;

  function sync() {
    const track=trackNow();
    button.disabled=!track||track.readyState==='ended'||focusing||adjusting||$('applyCamera').disabled;
    if(!focusing&&button.textContent!=='Auto focus')button.textContent='Auto focus';
    button.title='Request autofocus on the current rear camera';
    if(track!==observedTrack){
      observedTrack=track;
      message.textContent=(track&&cameraFocusReports.get(track))||(!track?'Start the camera to use Auto focus.':focusDescription(capabilities(track),track.getSettings?.().focusMode));
    }
  }
  button.addEventListener('click',async()=>{
    const track=trackNow();
    if(!track||track.readyState==='ended'||adjusting||focusing||$('applyCamera').disabled)return;
    focusing=true;adjusting=true;invalidate();
    button.textContent='Focusing…';message.textContent='Requesting autofocus. Hold the card steady.';sync();
    let reopen=false;
    try{
      const f=focusChoices(capabilities(track),track.getSettings?.().focusMode);
      let single=false,continuous=false;
      // Try a one-shot request when exposed or when the browser contradicts itself.
      if(f.single||f.inconsistent){
        try{single=await requestAutoMode(track,'single-shot');}catch(_){}
        if(track!==trackNow())return;
        if(single)await delay(650);
      }
      if(track!==trackNow())return;
      if(!single||f.continuous){
        try{continuous=await requestAutoMode(track,'continuous');}catch(_){}
        if(track!==trackNow())return;
        if(!continuous&&!single){
          try{single=await requestAutoMode(track,'single-shot');}catch(_){}
        }
      }
      if(track!==trackNow())return;
      if(single||continuous){
        await delay(650);
        if(track!==trackNow())return;
        message.textContent=single?'Auto focus requested. Check card text sharpness.':'Continuous autofocus reported. Lens may not refocus on command.';
      }else{
        reopen=true;message.textContent='Autofocus not confirmed; reopening camera once.';
      }
    }finally{
      if(track===trackNow()){
        try{await refreshCamera();}catch(_){}
        if(track===trackNow()){adjusting=false;cameraFocusReports.set(track,message.textContent);}
      }
      focusing=false;button.textContent='Auto focus';sync();
      if(reopen&&track===trackNow())$('applyCamera').click();
    }
  });

  toggle.addEventListener('click', () => {
    const closing = !panel.hidden;
    panel.hidden = closing;
    $('cameraWorkspace').classList.toggle('panelClosed', closing);
    toggle.textContent = closing ? 'Camera settings' : 'Hide settings';
    toggle.setAttribute('aria-expanded', String(!closing));
    if (trackNow()) invalidate(); // guide geometry changed; discard stale OCR result
  });

  // Resizing/rotating the phone also changes the live collector crop.
  if (typeof ResizeObserver !== 'undefined') {
    let lastWidth = -1, lastHeight = -1;
    new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width === lastWidth && rect.height === lastHeight) return;
      lastWidth = rect.width; lastHeight = rect.height;
      if (trackNow()) invalidate();
    }).observe($('view'));
  }
  setInterval(sync, 200);
  sync();
  $('versionTag').textContent = 'V0.3 · focus lab';
})();
