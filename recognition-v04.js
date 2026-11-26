/* V0.4 test branch: active-stream reconfiguration and multi-pass OCR.
   Keeps app.js/core.js and collection validation intact. */
(() => {
  'use strict';
  $('versionTag').textContent = 'V0.4 · recognition lab';
  let queued = false, processing = false, timer = null, attempts = 0;
  const button = $('applyCamera');
  const message = $('cameraMessage');
  const log = t => { message.textContent = t; };
  const sameSession = id => id === run && !!stream;
  const baseStop = $('stop').onclick;
  $('stop').onclick = () => { queued = false; clearTimeout(timer); baseStop(); };
  function queueRestart(immediate = false) {
    saveCamera();
    if (!stream) { log('Settings saved. Start camera to apply.'); return; }
    queued = true;
    invalidate();
    clearTimeout(timer);
    log('Camera settings queued…');
    timer = setTimeout(reconfigure, immediate ? 0 : 250);
  }
  async function reconfigure() {
    if (processing || !queued || !stream) return;
    if (adjusting) { timer = setTimeout(reconfigure, 120); return; }
    processing = true; adjusting = true; queued = false; invalidate();
    const id = run, requestedDevice = desiredSource, request = cameraRequest();
    const old = stream;
    button.disabled = true;
    log('Reopening camera with selected settings…');
    try {
      old.getTracks().forEach(t => t.stop());
      video.srcObject = null;
      const next = await navigator.mediaDevices.getUserMedia(request);
      if (!sameSession(id)) { next.getTracks().forEach(t => t.stop()); return; }
      stream = next; openedSource = requestedDevice; video.srcObject = next;
      await video.play();
      if (!sameSession(id)) return;
      const t = trackNow(), caps = capabilities(t);
      if (caps.focusMode?.includes('continuous')) {
        try { const previous = t.getConstraints?.() || request.video;
          await t.applyConstraints({...previous, advanced:[...(previous.advanced || []),{focusMode:'continuous'}]});
        } catch (_) { /* focus remains a best-effort request */ }
      }
      if (!sameSession(id)) return;
      torchOn = false; $('torch').textContent = 'Light'; $('torch').disabled = !caps.torch;
      await refreshCamera();
      if (!sameSession(id)) return;
      const s = t.getSettings?.() || {};
      const deviceOK = !requestedDevice || s.deviceId === requestedDevice;
      const requestedWidth = Number($('resolution').value);
      const actualWidth = Math.max(video.videoWidth || 0,video.videoHeight || 0,s.width || 0,s.height || 0);
      const resolutionOK = !requestedWidth || requestedWidth === actualWidth;
      const fpsOK = s.frameRate != null && Math.abs(s.frameRate-Number($('fps').value)) < 1;
      log(`${deviceOK?'Camera active':'Selected camera not verified'} · ${resolutionOK?'resolution matched':'resolution differs from request'} · ${fpsOK?'FPS matched':'FPS differs or unavailable'}.`);
    } catch (e) {
      if (sameSession(id)) { stop(); log('Camera restart failed: '+e.message+'. Select a different camera and press Start.'); }
    } finally {
      processing = false; button.disabled = false;
      if (sameSession(id)) adjusting = false;
      if (queued && stream) timer = setTimeout(reconfigure,100);
    }
  }
  for (const k of ['profile','cameraSource','resolution','fps']) {
    const el = $(k), prior = el.onchange;
    el.onchange = e => { prior?.call(el,e); queueRestart(); };
  }
  button.onclick = () => queueRestart(true);
  $('scanToggleV4').onclick = () => $('pauseScan').click();

  // Preserve the original geometric crop, but use independent preprocessing variants.
  const originalPrepare = prepare, originalGetWorker = getWorker;
  const inputs = new WeakMap(), wrapped = new WeakSet();
  function canvas(w,h) { const c = document.createElement('canvas'); c.width=w; c.height=h; return c; }
  function grayVariant(raw, top, bottom, invert, enhance) {
    const y=Math.floor(raw.height*top), h=Math.max(1,Math.ceil(raw.height*bottom)-y);
    const inner=canvas(raw.width,h), g=inner.getContext('2d',{willReadFrequently:true});
    g.drawImage(raw,0,y,raw.width,h,0,0,raw.width,h);
    const im=g.getImageData(0,0,inner.width,inner.height), histogram=new Uint32Array(256);
    const lum=new Uint8Array(im.data.length/4);
    for(let i=0,j=0;i<im.data.length;i+=4,j++) {const v=Math.round(.299*im.data[i]+.587*im.data[i+1]+.114*im.data[i+2]); lum[j]=v; histogram[v]++;}
    const quantile = q => {let sum=0;for(let n=0;n<256;n++){sum+=histogram[n];if(sum>=lum.length*q)return n;}return 255;};
    const lo=quantile(.03), hi=quantile(.97), span=Math.max(30,hi-lo);
    for(let i=0,j=0;i<im.data.length;i+=4,j++){let v=lum[j];if(enhance)v=Math.max(0,Math.min(255,(v-lo)*255/span));if(invert)v=255-v;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255;}
    g.putImageData(im,0,0);
    const pad=24, out=canvas(inner.width+pad*2,inner.height+pad*2), o=out.getContext('2d');
    o.fillStyle='#fff';o.fillRect(0,0,out.width,out.height);o.drawImage(inner,pad,pad);return out;
  }
  function show(input) {const p=$('cropPreview');p.width=input.width;p.height=input.height;p.getContext('2d').drawImage(input,0,0);}
  prepare = function(source=video, rect=getRect($('target'))) {
    const base=originalPrepare(source,rect);
    const [x,y,w,h]=rect;
    if(!(w>0&&h>0))return base;
    const raw=canvas(Math.min(1500,Math.max(750,Math.round(w*2))),Math.max(1,Math.round(Math.min(1500,Math.max(750,Math.round(w*2)))*h/w)));
    raw.getContext('2d').drawImage(source,x,y,w,h,0,0,raw.width,raw.height);
    const variants=[
      {name:'Tight inverted · line',psm:7, image:grayVariant(raw,.20,.75,true,true)},
      {name:'Full inverted · sparse',psm:11,image:grayVariant(raw,0,1,true,false)},
      {name:'Tight natural · raw line',psm:13,image:grayVariant(raw,.12,.85,false,true)},
      {name:'Original · line',psm:7,image:base}
    ];
    inputs.set(base,variants);return base;
  };
  getWorker=async function(){
    const w=await originalGetWorker();if(wrapped.has(w))return w;
    wrapped.add(w);const recognize=w.recognize.bind(w);
    w.recognize=async function(input,...args){
      const variants=inputs.get(input);if(!variants)return recognize(input,...args);
      const epoch=cameraEpoch, id=run;
      const sets=$('sets').value.toUpperCase().split(/[,\s]+/).filter(Boolean);
      const threshold=Number($('threshold').value);
      let best=null, bestScore=-Infinity, errors=[], traces=[];
      for(const v of variants){
        if(epoch!==cameraEpoch||id!==run)break;
        attempts++;$('ocrCount').textContent=attempts+' attempts';$('ocrState').textContent='Reading · '+v.name;$('guide').dataset.scan='reading';show(v.image);
        try{
          await w.setParameters({tessedit_pageseg_mode:String(v.psm)});
          const result=await recognize(v.image,...args), d=result.data;
          const p=C.parse(d.text,sets), conf=Number(d.confidence)||0;
          const score=(p?1000:0)+conf+(d.text?.trim()?1:0);
          traces.push(v.name+': '+JSON.stringify(d.text.trim())+' ('+Math.round(conf)+'%)');
          if(score>bestScore){bestScore=score;best={result,image:v.image,valid:!!p&&conf>=threshold};}
          if(p&&conf>=threshold)break;
        }catch(e){errors.push(e.message);traces.push(v.name+': error '+e.message);}
      }
      $('ocrMethods').textContent=traces.join(' | ');
      if(epoch!==cameraEpoch||id!==run)return {data:{text:'',confidence:0}};
      if(!best)throw Error(errors[0]||'No OCR attempt completed.');
      show(best.image);$('ocrState').textContent=best.valid?'Valid reading · checking consistency':'No accepted collector number';$('guide').dataset.scan=best.valid?'reading':'uncertain';
      return best.result;
    };return w;
  };
  setInterval(()=>{
    const t=trackNow(), state=$('status').textContent;
    $('scanToggleV4').disabled=!t||adjusting;
    $('scanToggleV4').textContent=paused?'Resume scanning':'Pause scanning';
    if(!t){$('ocrState').textContent='Scanner off';$('guide').dataset.scan='idle';}
    else if(adjusting){$('ocrState').textContent='Adjusting camera';$('guide').dataset.scan='idle';}
    else if(paused&&!recognizing){$('ocrState').textContent='Scanner paused';$('guide').dataset.scan='idle';}
    else if(!recognizing&&/^Saved |^Photo saved/.test(state)){$('ocrState').textContent='Card saved';$('guide').dataset.scan='saved';}
    else if(/^Scan error:|^Could not start:/.test(state)){$('ocrState').textContent=state;$('guide').dataset.scan='uncertain';}
    else if(!worker){$('ocrState').textContent='Loading OCR engine';$('guide').dataset.scan='idle';}
  },150);
})();
