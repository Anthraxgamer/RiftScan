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
    return {best,eligible:eligible.length,frames:eligible};
  }
  // Confirmation memory contains actual prior accepted readings only. A miss never increments it.
  function canRetain(memory,current,now,limits={maxAge:8000,maxMisses:2,maxDifference:12}){
    return !!memory&&!!current&&memory.session===current.session&&memory.lock===current.lock&&
      now-memory.at<=limits.maxAge&&memory.misses<=limits.maxMisses&&
      difference(memory.quality,current.quality)<=limits.maxDifference;
  }

  // Each vote comes from a distinct camera frame, never a repeated OCR variant.
  function decide(reads,needed){
    const valid=reads.filter(r=>r.key&&r.accepted);
    const keys=new Set(valid.map(r=>r.key));
    if(keys.size!==1||valid.length<needed)return {accepted:false,count:valid.length,conflict:keys.size>1};
    return {accepted:true,count:valid.length,key:valid[0].key,conflict:false};
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={metrics,difference,choose,canRetain,decide};return;}
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
  const retain=document.getElementById('retainV06');
  if(retain){retain.checked=false;retain.disabled=true;}
  const hasCandidate=typeof candidate!=='undefined'&&typeof locked!=='undefined'&&typeof C!=='undefined';
  let blocked=null;
  const session=t=>`${t.id}:${t.epoch}:${t.generation}`;
  function retry(){generation++;blocked=null;if(hasCandidate)candidate=null;phase('waiting','Ready for a fresh capture');}
  ui.retry=retry;
  for(const id of ['sets','threshold','reads','mode'])document.getElementById(id)?.addEventListener('change',retry);
  document.addEventListener?.('visibilitychange',retry);
  document.getElementById('next')?.addEventListener('click',retry,true);
  enabled.addEventListener?.('change',()=>{retry();note(enabled.checked?'Frozen capture enabled':'Original recognition enabled');});
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
  const cancel=(t,stage)=>{phase('waiting',stage+' cancelled: '+(invalidReason(t)||'capture state changed'));return empty();};
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
        last=stamp;const f=snapshot();if(f){f.foil=typeof frame==='function'?frame():null;frames.push(f);captures++;phase('capturing',`${frames.length}/4 frames captured`);}
      }
      if(frames.length<4)await sleep(70);
    }
    return frames;
  }
  // Only the automatic loop calls prepare() without arguments while recognizing.
  // Explicit photo captures and other diagnostic calls use the existing path.
  prepare=function(...args){
    if(!enabled.checked||args.length||!recognizing||paused||adjusting||!stream){return priorPrepare.apply(this,args);}
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
      // Keep the last unsuccessful batch visible. Only an explicit retry or a
      // sustained, meaningfully different crop opens another batch.
      if(blocked&&blocked.session===session(t)&&blocked.lock===locked){
        const now=performance.now();
        if(now-blocked.checkedAt>=300){
          blocked.checkedAt=now;const live=snapshot();
          if(live&&difference(blocked.quality,live.quality)>24){
            blocked.streak=blocked.previous&&difference(blocked.previous,live.quality)<=12?blocked.streak+1:1;
            blocked.previous=live.quality;
          }else{blocked.streak=0;blocked.previous=null;}
          if(blocked.streak>=3)blocked=null;
        }
        if(blocked){phase('retry',blocked.detail);return {data:{text:'',confidence:0,riftscanIdle:true}};}
      }else blocked=null;
      if(root.RiftTrackerV07){
        t.tracker=root.RiftTrackerV07.begin();
        if(!t.tracker){const held=hasCandidate&&!!locked;phase(held?'held':'waiting',held?'Tracker waiting for card replacement or alignment':'Tracker aligning first card');return {data:{text:'',confidence:0,riftscanIdle:true}};}
        if(!valid(t))return cancel(t,'Capture');
      }
      batches++;const started=performance.now();note('Collecting up to four frames once…');phase('capturing','0/4 frames captured');
      const frames=await capture(t);if(!valid(t))return cancel(t,'Capture');
      const selection=choose(frames);
      if(!selection||selection.best.quality.score<1.5){
        skipped++;const reason=cropProblem||(!frames.length?'Waiting for new camera frames':'ID crop lacks detail');
        note(reason);phase('waiting',reason);return empty();
      }
      // A single sharp image gets OCR too. Do not demand two stable frames to
      // start OCR; the configured number of genuine matching reads still applies.
      const pool=selection.frames.filter(f=>f.quality.score>=1.5).sort((a,b)=>b.quality.score-a.quality.score);
      const sets=document.getElementById('sets').value.toUpperCase().split(/[,\s]+/).filter(Boolean);
      const threshold=Number(document.getElementById('threshold').value);
      const needed=Math.max(1,Math.min(3,Number(document.getElementById('reads').value)||2));
      const reads=[];let best=null,bestScore=-Infinity,bestPreview=null,bestTrace='';
      submitted++;
      for(const [i,f] of pool.entries()){
        if(!valid(t))return cancel(t,'OCR');
        phase('reading',`OCR frozen image ${i+1}/${pool.length} · batch ${submitted}`);
        let result;
        try{
          const prepared=priorPrepare(f.image,[0,0,f.image.width,f.image.height]);
          result=await read(prepared,...args);
        }catch(e){if(!valid(t))return cancel(t,'OCR');phase('error','OCR error: '+e.message);throw e;}
        if(!valid(t))return cancel(t,'OCR');
        const data=result?.data||{}, p=C.parse(data.text||'',sets), conf=Number(data.confidence)||0;
        const vote={result,frame:f,key:p?p.set+' '+p.num+'/'+p.den:null,accepted:!!p&&conf>=threshold};
        reads.push(vote);
        const score=(vote.key?1000:0)+conf;
        if(score>bestScore){bestScore=score;best=vote;const pv=document.getElementById('cropPreview');if(pv?.width&&pv?.height){bestPreview=canvas(pv.width,pv.height);bestPreview.getContext('2d').drawImage(pv,0,0);}bestTrace=document.getElementById('ocrMethods')?.textContent||'';}
        const verdict=decide(reads,needed);if(verdict.accepted||verdict.conflict)break;
      }
      const verdict=decide(reads,needed);
      if(!valid(t))return cancel(t,'OCR');
      // Verify the physical card once, after processing the frozen images.
      const live=snapshot();
      const comparison=verdict.accepted?reads.filter(r=>r.accepted&&r.key===verdict.key).map(r=>r.frame):[selection.best];
      if(!live||!comparison.some(f=>difference(f.quality,live.quality)<=20)){phase('waiting','Card changed during OCR; align again');return empty();}
      if(bestPreview){const pv=document.getElementById('cropPreview');pv.width=bestPreview.width;pv.height=bestPreview.height;pv.getContext('2d').drawImage(bestPreview,0,0);}
      const methods=document.getElementById('ocrMethods');if(methods)methods.textContent=bestTrace;
      if(verdict.accepted){
        const winner=reads.filter(r=>r.accepted&&r.key===verdict.key).sort((a,b)=>Number(b.result.data.confidence)-Number(a.result.data.confidence))[0];
        if(typeof history!=='undefined')history=selection.frames.slice().reverse().filter(f=>f.foil).map(f=>f.foil);
        note(`Frozen batch confirmed · ${verdict.count}/${needed} matching images · ${Math.round(performance.now()-started)}ms`);
        phase('complete',`Confirmed ${verdict.count}/${needed} matching reads`);
        return {...winner.result,data:{...winner.result.data,riftscanVotes:verdict.count}};
      }
      const detail=verdict.conflict?'Conflicting collector IDs · retry capture':`Image retained · ${verdict.count}/${needed} matching reads · retry capture`;
      blocked={session:session(t),lock:locked,quality:selection.best.quality,detail,checkedAt:performance.now(),streak:0,previous:null};
      skipped++;note(detail);phase('retry',detail);
      return {data:{...(best?.result?.data||{text:'',confidence:0}),riftscanRejected:true}};
    };w.recognize=wrappedRead;wrapped.set(w,wrappedRead);return w;
  }
  getWorker=async function(...args){return wrap(await priorGetWorker.apply(this,args));};
  // Install before camera use; also handle a worker already preloaded by V0.5.
  if(typeof worker!=='undefined'&&worker)wrap(worker);
  if(version)version.textContent='V0.6 · best frame';
})(typeof globalThis!=='undefined'?globalThis:this);
