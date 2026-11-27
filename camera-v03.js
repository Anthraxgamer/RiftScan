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

  function supportedModes(track) {
    const modes = capabilities(track).focusMode;
    return Array.isArray(modes) ? modes : [];
  }

  function sync() {
    const track = trackNow();
    const modes = supportedModes(track);
    const available = modes.includes('single-shot') || modes.includes('continuous');
    button.disabled = !track || !available || focusing || adjusting;
    if (track !== observedTrack) {
      observedTrack = track;
      message.textContent = (track&&cameraFocusReports.get(track)) || (!track ? 'Start the camera to check autofocus support.' : available
        ? 'Autofocus available. Hold the card steady and tap Auto focus.'
        : 'This camera/browser does not expose autofocus control. Try another rear camera or browser.');
    }
  }

  // Keep the negotiated video mode and other controls when changing focus.
  function focusConstraints(track, mode) {
    const next=mergedCameraConstraints(track,{focusMode:mode});
    next.advanced=(next.advanced||[]).map(entry=>{const copy={...entry};delete copy.focusMode;return copy;}).filter(entry=>Object.keys(entry).length);
    if(!next.advanced.length)delete next.advanced;
    next.focusMode={exact:mode};
    return next;
  }

  async function requestMode(track, mode) {
    const next = focusConstraints(track, mode);
    // Some camera implementations expose focus only through advanced constraints.
    try {
      await track.applyConstraints(next);
    } catch (error) {
      if (!['OverconstrainedError', 'NotSupportedError', 'TypeError'].includes(error.name)) throw error;
      if (track !== trackNow()) throw error;
      delete next.focusMode;
      next.advanced = [...(next.advanced || []), {focusMode: mode}];
      await track.applyConstraints(next);
    }
    if (track !== trackNow()) return false;
    const reported = track.getSettings?.().focusMode;
    // A fulfilled request is not proof that the mode was applied or the image is sharp.
    if (reported && reported !== mode) {
      const fallback = focusConstraints(track, mode);
      delete fallback.focusMode;
      fallback.advanced = [...(fallback.advanced || []), {focusMode: mode}];
      await track.applyConstraints(fallback);
    }
    return track === trackNow() && track.getSettings?.().focusMode === mode;
  }

  button.addEventListener('click', async () => {
    const track = trackNow();
    const modes = supportedModes(track);
    if (!track || adjusting || focusing || !modes.some(m => m === 'single-shot' || m === 'continuous')) return;
    focusing = true;
    adjusting = true;
    invalidate(); // discard in-flight OCR, keep the existing duplicate-card lock
    button.textContent = 'Focusing…';
    message.textContent = 'Requesting autofocus. Hold the card steady.';
    sync();
    try {
      if (modes.includes('single-shot')) {
        let confirmed=false;
        try { confirmed=await requestMode(track,'single-shot'); } catch(error) { if(!modes.includes('continuous'))throw error; }
        await delay(850); // allow the lens to settle; not a focus-lock signal
        if (track !== trackNow()) return;
        if (modes.includes('continuous')) {
          const continuous = await requestMode(track, 'continuous');
          if (track !== trackNow()) return;
          message.textContent = continuous
            ? (confirmed ? 'Refocus requested; continuous autofocus restored. Check text sharpness.' : 'Continuous autofocus active; one-shot focus not confirmed. Check sharpness.')
            : 'Refocus requested; continuous mode not confirmed. Check text sharpness.';
        } else {
          message.textContent = confirmed ? 'Single-shot autofocus requested. Check text sharpness.' : 'Autofocus requested, but the browser did not confirm the focus mode.';
        }
      } else {
        // Some devices expose a disabled mode. Cycling through it can restart continuous AF.
        if(modes.includes('none')&&track.getSettings?.().focusMode==='continuous'){
          try{await requestMode(track,'none');await delay(120);}catch(_){}
        }
        if(track!==trackNow())return;
        const confirmed = await requestMode(track, 'continuous');
        await delay(850);
        if (track !== trackNow()) return;
        message.textContent = confirmed ? 'Continuous autofocus requested. Lens response depends on browser; check sharpness.' : 'Autofocus requested, but the browser did not confirm the focus mode.';
      }
    } catch (error) {
      if (track === trackNow()) message.textContent = 'Autofocus unavailable: ' + error.message;
    } finally {
      if (track === trackNow()) {
        try { await refreshCamera(); } catch (_) { /* diagnostics are best effort */ }
        if (track === trackNow()) { adjusting = false; cameraFocusReports.set(track,message.textContent); }
      }
      focusing = false;
      button.textContent = 'Auto focus';
      sync();
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
