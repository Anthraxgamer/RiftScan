/* RiftScan V0.7.3.1 — bounded best-frame acquisition and explicit diagnostics. */
(function(root){
  'use strict';
  // Fixed-size grayscale analysis, independent of OCR input resolution.
  function metrics(rgba,w,h){
    const l=new Float32Array(w*h), hist=new Uint32Array(256);
    let clipped=0;
    for(let i=0,j=0;j<l.length;i+=4,j++){
      const v=Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]);
      l[j]=v;hist[v]++;if(v<=3||v>=252)clipped++;
    }
    const quantile=q=>{let n=0;for(let i=0;i<256;i++){n+=hist[i];if(n>=q*l.length)return i;}return 255;};
    let sharp=0,n=0;
    // Ignore crop borders; cap isolated edge responses to reduce noise bias.
    for(let y=Math.max(1,Math.floor(h*.12));y<Math.min(h-1,Math.ceil(h*.88));y++){
      for(let x=Math.max(1,Math.floor(w*.04));x<Math.min(w-1,Math.ceil(w*.96));x++){
        const i=y*w+x, lap=4*l[i]-l[i-1]-l[i+1]-l[i-w]-l[i+w];
        sharp+=Math.min(10000,lap*lap);n++;
      }
    }
    const contrast=quantile(.95)-quantile(.05), edge=Math.sqrt(sharp/Math.max(1,n));
    // Exposure penalty only for nearly completely clipped images: card text is often white on black.
    const score=edge*(.35+.65*Math.min(1,contrast/100))*(1-.8*Math.max(0,(clipped/l.length-.8)/.2));
    return {score,contrast,edge,luma:l,w,h};
  }
  function difference(a,b){
    if(a.w!==b.w||a.h!==b.h)return Infinity;
    let n=0,ma=0,mb=0;const w=a.w,h=a.h;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;ma+=a.luma[i];mb+=b.luma[i];n++;}
    if(!n)return Infinity; ma/=n;mb/=n;let d=0;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;d+=Math.abs((a.luma[i]-ma)-(b.luma[i]-mb));}
    return d/n;
  }
  function choose(frames,maxDifference=16){
    if(!frames.length)return null;
    const newest=frames[frames.length-1];
    // Use only the contiguous recent portion; do not select across an observed change.
    const eligible=[newest];
    for(let i=frames.length-2;i>=0;i--){
      if(difference(frames[i].quality,newest.quality)>maxDifference)break;
      eligible.push(frames[i]);
    }
    let best=newest;
    for(const f of eligible)if(f.quality.score>best.quality.score)best=f;
    return {best,eligible:eligible.length};
  }
  // Confirmation memory contains actual prior accepted readings only. A miss never increments it.
  function canRetain(memory,current,now,limits={maxAge:8000,maxMisses:2,maxDifference:12}){
    return !!memory&&!!current&&memory.session===current.session&&memory.lock===current.lock&&
      now-memory.at<=limits.maxAge&&memory.misses<=limits.maxMisses&&
      difference(memory.quality,current.quality)<=limits.maxDifference;
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={metrics,difference,choose,canRetain};return;}
  const existingInfo=document.getElementById('bestFrameV055');
  const existingToggle=document.getElementById('bestFrameEnabled');
  const version=document.getElementById('versionTag');
  if(typeof prepare!=='function'||typeof getWorker!=='function'||typeof getRect!=='function'||typeof video==='undefined'||typeof cameraEpoch==='undefined'||typeof recognizing==='undefined'||typeof run==='undefined'||typeof stream==='undefined'||typeof paused==='undefined'||typeof adjusting==='undefined'){
    if(existingInfo)existingInfo.textContent='Best-frame unavailable: incompatible scanner interface. Using existing scanner.';
    if(version)version.textContent='V0.5 · best-frame unavailable';
    console.warn('RiftScan V0.5.5: unsupported scanner interface; no changes installed.');return;
  }
  const priorPrepare=prepare,priorGetWorker=getWorker,wrapped=new WeakMap(),tokens=new WeakMap();
  const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  const analysis=canvas(240,64),actx=analysis.getContext('2d',{willReadFrequently:true});
  const target=document.getElementById('target'), panel=document.getElementById('ocrMethods')||document.getElementById('debug');
  if(!target||!panel)return;
  const info=existingInfo||document.createElement('p');info.className='foot';info.id='bestFrameV055';info.textContent='Best-frame experiment: ready';
  const enabled=existingToggle||document.createElement('input');enabled.type='checkbox';enabled.checked=true;enabled.disabled=false;enabled.style.width='auto';
  if(!existingToggle){const toggle=document.createElement('label');toggle.className='foot';toggle.append(enabled,document.createTextNode(' Best of 4 frames (V0.5.5)'));panel.before(toggle,info);}
  let batches=0,captures=0,submitted=0,skipped=0,generation=0;
  const ui=root.RiftCapture0731={phase:'idle',detail:'Waiting for camera',frames:0,submitted:0,skipped:0};
  function phase(name,detail){Object.assign(ui,{phase:name,detail,frames:captures,submitted,skipped});}
  let cropProblem='';
  const retain=document.getElementById('retainV06'),retainInfo=document.getElementById('retainInfoV06');
  const hasCandidate=typeof candidate!=='undefined'&&typeof locked!=='undefined'&&typeof C!=='undefined';
  let memory=null,lastAccepted=null;
  const clearMemory=()=>{memory=null;lastAccepted=null;};
  const retentionOn=()=>!!retain?.checked&&hasCandidate;
  if(retain&&!hasCandidate){retain.checked=false;retain.disabled=true;if(retainInfo)retainInfo.textContent='Retention unavailable: scanner interface not recognized.';}
  const session=t=>`${t.id}:${t.epoch}:${t.generation}`;
  const context=(t,quality)=>({session:session(t),lock:hasCandidate?locked:null,quality});
  const retentionNote=msg=>{if(retainInfo)retainInfo.textContent=msg;};
  for(const id of ['sets','threshold','reads','mode','retainV06'])document.getElementById(id)?.addEventListener('change',clearMemory);
  document.addEventListener?.('visibilitychange',clearMemory);
  document.getElementById('next')?.addEventListener('click',()=>{generation++;clearMemory();},true);
  enabled.addEventListener?.('change',()=>{generation++;clearMemory();note(enabled.checked?'Best-frame enabled':'Original recognition enabled');});
  const note=s=>{info.textContent=`${s} · ${captures} frames / ${submitted} OCR batches / ${skipped} skipped`;};
  const invalidReason=t=>{
    if(t.id!==run||!stream)return 'Camera session ended';
    if(t.epoch!==cameraEpoch)return 'Camera or crop geometry changed';
    if(t.generation!==generation)return 'Capture settings changed';
    if(paused||adjusting||document.hidden)return 'Scanning paused or camera adjusting';
    if(t.tracker&&!root.RiftTrackerV07?.valid(t.tracker))return 'Card moved or tracker state changed';
    return '';
  };
  const valid=t=>!invalidReason(t);
  const cancel=(t,stage)=>{clearMemory();phase('waiting',stage+' cancelled: '+(invalidReason(t)||'capture state changed'));return empty();};
  const empty=()=>({data:{text:'',confidence:0}});
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function snapshot(){
    const rect=getRect(target),[x,y,w,h]=rect;
    if(!rect.every(Number.isFinite)||w<12||h<6||x<-.5||y<-.5||x+w>video.videoWidth+.5||y+h>video.videoHeight+.5){cropProblem=`ID crop outside camera or too small (${rect.map(n=>Math.round(n)).join(', ')}; video ${video.videoWidth}×${video.videoHeight})`;return null;}
    cropProblem='';
    // Copy original crop before the video changes. Keep source pixel resolution, capped to avoid huge buffers.
    const width=Math.max(1,Math.min(1200,Math.round(w))),height=Math.max(1,Math.round(width*h/w));
    const c=canvas(width,height);c.getContext('2d').drawImage(video,x,y,w,h,0,0,width,height);
    const ah=Math.max(12,Math.min(96,Math.round(240*h/w)));if(analysis.height!==ah)analysis.height=ah;
    actx.drawImage(c,0,0,240,ah);
    return {image:c,quality:metrics(actx.getImageData(0,0,240,ah).data,240,ah)};
  }
  async function capture(t){
    const frames=[];let last=null;const started=performance.now();cropProblem='';
    while(frames.length<4&&performance.now()-started<700&&valid(t)){
      // Prefer presented/decoded-frame count where available; use media time otherwise.
      let count=0;try{count=video.getVideoPlaybackQuality?.().totalVideoFrames||0;}catch(_){}
      // Android can expose a positive but frozen playback counter on a live stream.
      // Accept either advancing media time or frame count, never timer ticks alone.
      const time=Number.isFinite(video.currentTime)?video.currentTime:null;
      const stamp=time!==null||count>0?`${time}:${count}`:null;
      if(video.readyState>=2&&stamp!==null&&stamp!==last){
        last=stamp;const f=snapshot();if(f){frames.push(f);captures++;phase('capturing',`${frames.length}/4 frames captured`);}
      }
      if(frames.length<4)await sleep(70);
    }
    return frames;
  }
  // Only the automatic loop calls prepare() without arguments while recognizing.
  // Explicit photo captures and other diagnostic calls use the existing path.
  prepare=function(...args){
    if(!enabled.checked||args.length||!recognizing||paused||adjusting||!stream){clearMemory();return priorPrepare.apply(this,args);}
    // V0.5 may preload or rewrap its worker asynchronously. Attach to its latest method.
    if(typeof worker!=='undefined'&&worker)wrap(worker);
    const token=canvas(1,1);tokens.set(token,{id:run,epoch:cameraEpoch,generation});return token;
  };
  function wrap(w){
    if(!w||typeof w.recognize!=='function'||wrapped.get(w)===w.recognize)return w;
    const read=w.recognize.bind(w);
    const wrappedRead=async function(input,...args){
      const t=tokens.get(input);if(!t)return read(input,...args);
      tokens.delete(input);if(!valid(t))return cancel(t,'Capture');
      if(root.RiftTrackerV07){t.tracker=root.RiftTrackerV07.begin();if(!t.tracker){clearMemory();const held=hasCandidate&&!!locked;phase(held?'held':'waiting',held?'Tracker waiting for card replacement or alignment':'Tracker aligning first card');return empty();}if(!valid(t))return cancel(t,'Capture');}
      // The base loop has already processed the previous result by the time this batch begins.
      // Capture its genuine candidate before an unreadable result clears it.
      if(retentionOn()&&lastAccepted&&candidate?.k===lastAccepted.key&&Number.isInteger(candidate.n)&&candidate.n>0&&candidate.k!==locked&&lastAccepted.session===session(t)&&lastAccepted.lock===locked){
        if(!memory||memory.key!==candidate.k||candidate.n>memory.candidate.n){memory={...lastAccepted,candidate:{...candidate},misses:0};}
      }else if(!retentionOn()||lastAccepted&&(lastAccepted.session!==session(t)||lastAccepted.lock!==locked||lastAccepted.key===locked))clearMemory();
      batches++;const started=performance.now();note('Collecting four frames…');phase('capturing','0/4 frames captured');
      const frames=await capture(t);if(!valid(t))return cancel(t,'Capture');
      const selection=choose(frames);
      // Prefer four frames; after the deadline, accept two or more agreeing distinct samples.
      if(!selection||selection.eligible<2||selection.best.quality.score<1.5){clearMemory();skipped++;
        const reason=cropProblem|| (frames.length<2?'Waiting for new camera frames':selection?.eligible<2?'ID crop moving or changing':'ID crop lacks detail');
        note(`${reason} (${frames.length}/4, ${selection?.eligible||0} stable)`);phase('waiting',reason);return empty();}
      const {best,eligible}=selection;
      const current=context(t,best.quality);
      // Require all four sampled frames to agree with the retained anchor. If the card
      // appears to have changed, never carry forward recognition evidence.
      if(memory&&(!canRetain(memory,current,performance.now())||eligible!==4||frames.some(f=>difference(memory.quality,f.quality)>12)))clearMemory();
      let prepared;try{prepared=priorPrepare(best.image,[0,0,best.image.width,best.image.height]);}catch(e){phase('error','Image preparation error: '+e.message);throw e;}
      submitted++;phase('reading',`OCR batch ${submitted} · ${eligible}/${frames.length} stable frames`);note(`Batch ${batches}: selected frame ${frames.indexOf(best)+1}/4 · quality ${best.quality.score.toFixed(1)} · ${eligible} stable · ${Math.round(performance.now()-started)}ms capture`);
      // Retain the existing OCR worker, preprocessing fallbacks, confidence and save/duplicate rules.
      let result;try{result=await read(prepared,...args);}catch(e){phase('error','OCR error: '+e.message);throw e;}
      if(!valid(t))return cancel(t,'OCR');
      // Initial reads are not gated by artwork. Still reject a stale ID crop, including
      // when confirmation memory is disabled. Compare against the frozen best frame.
      if(t.tracker?.phase==='initial'){const live=snapshot();if(!live||difference(best.quality,live.quality)>12){clearMemory();phase('waiting','ID crop changed during OCR');return empty();}}
      if(retentionOn()){
        const data=result?.data||{},sets=document.getElementById('sets').value.toUpperCase().split(/[,\s]+/).filter(Boolean),p=C.parse(data.text||'',sets),confidence=Number(data.confidence)||0;
        const k=p&&confidence>=Number(document.getElementById('threshold').value)?p.set+' '+p.num:null;
        // Check the live crop after OCR as well, only for evidence retention. An actual
        // save still follows the base scanner's rules. No synthetic OCR result is created.
        const live=snapshot();
        if(!live||difference(best.quality,live.quality)>12){clearMemory();if(t.tracker&&!t.tracker.bypass){phase('waiting','ID crop changed during OCR');return empty();}}
        else if(k){
          if(memory&&memory.key===k&&k!==locked&&memory.misses>0&&canRetain(memory,current,performance.now())&&(!candidate||candidate.k===k&&candidate.n<memory.candidate.n)){
            try{candidate={...memory.candidate};retentionNote(`Retained ${candidate.n} prior matching read(s) for ${k} across ${memory.misses} miss(es).`);}catch(_){clearMemory();}
          }else if(memory&&memory.key!==k)clearMemory();
          lastAccepted={...current,key:k,at:performance.now()};memory=null;
        }else if(memory){memory.misses++;if(!canRetain(memory,current,performance.now()))clearMemory();else retentionNote(`Holding ${memory.candidate.n} prior matching read(s) · ${memory.misses}/2 misses · ${memory.key}.`);}
        else lastAccepted=null;
      }else clearMemory();
      phase('complete',`OCR returned · confidence ${Math.round(Number(result?.data?.confidence)||0)}%`);return result;
    };w.recognize=wrappedRead;wrapped.set(w,wrappedRead);return w;
  }
  getWorker=async function(...args){return wrap(await priorGetWorker.apply(this,args));};
  // Install before camera use; also handle a worker already preloaded by V0.5.
  if(typeof worker!=='undefined'&&worker)wrap(worker);
  if(version)version.textContent='V0.6 · best frame';
})(typeof globalThis!=='undefined'?globalThis:this);
