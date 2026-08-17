from pathlib import Path

# Worker integration
wp = Path('prototype/vanilla/worker.ts')
w = wp.read_text()
if not w.startswith("import { captureHistory"):
    w = "import { captureHistory, handleHistoryRequest, purgeHistory, type HistoryBindings } from './history';\n\n" + w

old = """export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
"""
new = """export default {
  async fetch(request: Request, env: Env & HistoryBindings): Promise<Response> {
    const url = new URL(request.url);
    const historyResponse = await handleHistoryRequest(request, url, env);
    if (historyResponse) return historyResponse;
"""
if old not in w:
    raise SystemExit('worker fetch signature not found')
w = w.replace(old, new, 1)

old = """    return env.ASSETS.fetch(request);
  },
};"""
new = """    return env.ASSETS.fetch(request);
  },
  async scheduled(controller: ScheduledController, env: Env & HistoryBindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        const cameras = await getArcGISCameras();
        await captureHistory(env, cameras, controller.scheduledTime);
        await purgeHistory(env, controller.scheduledTime);
      } catch (error) {
        console.error(JSON.stringify({ event: 'history_tick_error', message: error instanceof Error ? error.message : String(error) }));
      }
    })());
  },
};"""
if old not in w:
    raise SystemExit('worker export tail not found')
w = w.replace(old, new, 1)
wp.write_text(w)

# Browser Time Machine + citywide historical baseline seeding
jp = Path('prototype/vanilla/public/benchmark.js')
s = jp.read_text()
s = s.replace(
    "let anomalyUiTimer = null;\nconst ANOMALY_START_DELAY = 12000;",
    "let anomalyUiTimer = null;\nconst historicalSeedAttempted = new Set();\nlet focusHistory = null;\nlet timelapseTimer = null;\nconst ANOMALY_START_DELAY = 12000;",
    1,
)

anchor = """function analyzeImage(camera,img) {
  const current=fingerprintImage(img);
  if (!current) return;
  const record=anomalyHistory[camera.id] || {samples:[]};
"""
replacement = """async function seedHistoricalBaseline(camera) {
  const record=anomalyHistory[camera.id] || {samples:[]};
  const existing=Array.isArray(record.samples)?record.samples:[];
  if (existing.length>=ANOMALY_MIN_SAMPLES || historicalSeedAttempted.has(camera.id)) return;
  historicalSeedAttempted.add(camera.id);
  try {
    const response=await fetch(`/api/history?camera=${encodeURIComponent(camera.id)}&hours=6&limit=4`,{headers:{Accept:'application/json'}});
    if(!response.ok)return;
    const data=await response.json();
    const frames=Array.isArray(data.frames)?data.frames.slice(0,ANOMALY_MIN_SAMPLES):[];
    const seeded=[];
    for(const frame of frames){
      const img=new Image();
      img.decoding='async';
      const loaded=new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;});
      img.src=frame.imageUrl;
      try{await loaded;const fp=fingerprintImage(img);if(fp)seeded.push(fp);}catch{}
    }
    if(seeded.length){
      record.samples=[...seeded,...existing].slice(-ANOMALY_HISTORY_LIMIT);
      record.updatedAt=Date.now();
      anomalyHistory[camera.id]=record;
      saveAnomalyHistory();
    }
  }catch{}
}
function analyzeImage(camera,img) {
  const record=anomalyHistory[camera.id] || {samples:[]};
  if ((record.samples?.length||0)<ANOMALY_MIN_SAMPLES && !historicalSeedAttempted.has(camera.id)) {
    seedHistoricalBaseline(camera).finally(()=>analyzeImage(camera,img));
    return;
  }
  const current=fingerprintImage(img);
  if (!current) return;
"""
if anchor not in s:
    raise SystemExit('analyzeImage anchor not found')
s = s.replace(anchor, replacement, 1)

# Insert Time Machine helpers before openFocus
anchor = "\nfunction openFocus(id) {\n"
helpers = r'''
function stopTimelapse(){
  if(timelapseTimer){clearInterval(timelapseTimer);timelapseTimer=null;}
  const button=$('#history-timelapse');if(button)button.textContent='Timelapse';
}
function timeLabel(timestamp){
  const date=new Date(timestamp);
  return date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
}
function historyOverlay(){return $('#history-frame');}
function hideComparison(){
  $('#compare-stage')?.remove();
  $('#compare-scrubber')?.closest('.compare-control')?.remove();
}
function showCurrentFocus(camera){
  stopTimelapse();hideComparison();
  const overlay=historyOverlay();if(overlay)overlay.hidden=true;
  const label=$('#history-current-label');if(label)label.textContent='Now';
  if(camera.videoUrl)setupVideo(camera);
}
function showHistoryFrame(camera,index){
  if(!focusHistory||focusHistory.cameraId!==camera.id||!focusHistory.frames.length)return;
  stopTimelapse();hideComparison();destroyVideo();
  const frame=focusHistory.frames[Math.max(0,Math.min(index,focusHistory.frames.length-1))];
  focusHistory.index=focusHistory.frames.indexOf(frame);
  const overlay=historyOverlay();if(!overlay)return;
  overlay.src=frame.imageUrl;overlay.hidden=false;
  const scrub=$('#history-scrubber');if(scrub)scrub.value=String(focusHistory.index);
  const label=$('#history-current-label');if(label)label.textContent=timeLabel(frame.capturedAt);
}
function showComparison(camera){
  if(!focusHistory?.frames?.length)return;
  stopTimelapse();destroyVideo();
  const frame=focusHistory.frames[focusHistory.index]||focusHistory.frames.at(-1);
  const media=$('.focus-media');if(!media)return;
  const overlay=historyOverlay();if(overlay)overlay.hidden=true;
  hideComparison();
  media.insertAdjacentHTML('beforeend',`<div id="compare-stage" class="compare-stage"><img src="${imageUrl(camera,960,true)}" alt="${escapeHtml(camera.label)} now"><div class="compare-before"><img src="${frame.imageUrl}" alt="${escapeHtml(camera.label)} at ${timeLabel(frame.capturedAt)}"></div><span class="compare-label before">${timeLabel(frame.capturedAt)}</span><span class="compare-label now">Now</span><span class="compare-divider"></span></div>`);
  const tm=$('#time-machine');
  tm?.insertAdjacentHTML('beforeend','<label class="compare-control">Before / After <input id="compare-scrubber" type="range" min="5" max="95" value="50"></label>');
  const slider=$('#compare-scrubber');
  const apply=()=>{const value=Number(slider.value);const before=$('.compare-before');const divider=$('.compare-divider');if(before)before.style.width=`${value}%`;if(divider)divider.style.left=`${value}%`;};
  slider?.addEventListener('input',apply);apply();
}
function startTimelapse(camera){
  if(!focusHistory?.frames?.length)return;
  if(timelapseTimer){stopTimelapse();return;}
  hideComparison();destroyVideo();
  let index=0;
  const button=$('#history-timelapse');if(button)button.textContent='Stop timelapse';
  const advance=()=>{const overlay=historyOverlay();const frame=focusHistory.frames[index];if(!overlay||!frame){stopTimelapse();return;}overlay.src=frame.imageUrl;overlay.hidden=false;focusHistory.index=index;const scrub=$('#history-scrubber');if(scrub)scrub.value=String(index);const label=$('#history-current-label');if(label)label.textContent=timeLabel(frame.capturedAt);index+=1;if(index>=focusHistory.frames.length)stopTimelapse();};
  advance();timelapseTimer=setInterval(advance,260);
}
async function loadTimeMachine(camera){
  focusHistory={cameraId:camera.id,frames:[],index:0};
  const section=$('#time-machine');if(!section)return;
  try{
    const response=await fetch(`/api/history?camera=${encodeURIComponent(camera.id)}&hours=6&limit=96`,{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('history unavailable');
    const data=await response.json();const frames=Array.isArray(data.frames)?data.frames:[];
    if(focusedId!==camera.id)return;
    focusHistory={cameraId:camera.id,frames,index:Math.max(0,frames.length-1)};
    if(!frames.length){section.innerHTML='<div class="time-machine-empty"><strong>Traffic Time Machine</strong><span>History is warming up. New frames arrive about every five minutes.</span></div>';return;}
    const first=timeLabel(frames[0].capturedAt),last=timeLabel(frames.at(-1).capturedAt);
    section.innerHTML=`<div class="time-machine-head"><div><p class="eyebrow">Traffic Time Machine</p><strong id="history-current-label">Now</strong></div><span>${frames.length} captures · ${first}–${last}</span></div><input id="history-scrubber" class="history-scrubber" type="range" min="0" max="${frames.length-1}" value="${frames.length-1}" aria-label="Historical camera time"><div class="time-machine-actions"><button id="history-now" class="chip accent">Now</button><button id="history-compare" class="chip">Before / After</button><button id="history-timelapse" class="chip">Timelapse</button></div>`;
    $('#history-scrubber')?.addEventListener('input',(event)=>showHistoryFrame(camera,Number(event.target.value)));
    $('#history-now')?.addEventListener('click',()=>showCurrentFocus(camera));
    $('#history-compare')?.addEventListener('click',()=>showComparison(camera));
    $('#history-timelapse')?.addEventListener('click',()=>startTimelapse(camera));
  }catch{
    if(focusedId===camera.id)section.innerHTML='<div class="time-machine-empty"><strong>Traffic Time Machine</strong><span>Historical frames are temporarily unavailable.</span></div>';
  }
}
'''
if anchor not in s:
    raise SystemExit('openFocus anchor not found')
s = s.replace(anchor, helpers + anchor, 1)

old_markup = """modalBody.innerHTML=`<div class="focus-head"><p class="eyebrow">Camera focus</p><h2>${escapeHtml(camera.label)}</h2>${anomalyCopy}</div><div class="focus-media">${camera.videoUrl?`<video id="focus-video" controls playsinline poster="${imageUrl(camera,960,true)}"></video>`:`<img src="${imageUrl(camera,960,true)}" alt="${escapeHtml(camera.label)}" width="960" height="540">`}</div><div class="focus-actions"><button class="chip" data-focus="${escapeHtml(prev?.id||id)}">← Previous</button><button id="refresh-focus" class="chip">Refresh snapshot</button><button class="chip" data-focus="${escapeHtml(next?.id||id)}">Next →</button>${camera.webUrl?`<a class="chip" href="${escapeHtml(camera.webUrl)}" target="_blank" rel="noopener noreferrer">SDOT page</a>`:''}</div>${nearby?`<div class="nearby"><p>Nearby cameras</p>${nearby}</div>`:''}`;"""
new_markup = """modalBody.innerHTML=`<div class="focus-head"><p class="eyebrow">Camera focus</p><h2>${escapeHtml(camera.label)}</h2>${anomalyCopy}</div><div class="focus-media">${camera.videoUrl?`<video id="focus-video" controls playsinline poster="${imageUrl(camera,960,true)}"></video>`:`<img src="${imageUrl(camera,960,true)}" alt="${escapeHtml(camera.label)}" width="960" height="540">`}<img id="history-frame" class="history-frame" hidden alt="Historical frame for ${escapeHtml(camera.label)}"></div><section id="time-machine" class="time-machine" aria-live="polite"><div class="time-machine-empty"><strong>Traffic Time Machine</strong><span>Loading recent history…</span></div></section><div class="focus-actions"><button class="chip" data-focus="${escapeHtml(prev?.id||id)}">← Previous</button><button id="refresh-focus" class="chip">Refresh snapshot</button><button class="chip" data-focus="${escapeHtml(next?.id||id)}">Next →</button>${camera.webUrl?`<a class="chip" href="${escapeHtml(camera.webUrl)}" target="_blank" rel="noopener noreferrer">SDOT page</a>`:''}</div>${nearby?`<div class="nearby"><p>Nearby cameras</p>${nearby}</div>`:''}`;"""
if old_markup not in s:
    raise SystemExit('focus markup not found')
s = s.replace(old_markup, new_markup, 1)
s = s.replace("  if (camera.videoUrl) setupVideo(camera);\n}", "  if (camera.videoUrl) setupVideo(camera);\n  loadTimeMachine(camera);\n}\n", 1)
s = s.replace("function closeFocus() { destroyVideo();focusedId=null;updateUrl();modal.close(); }", "function closeFocus() { stopTimelapse();focusHistory=null;destroyVideo();focusedId=null;updateUrl();modal.close(); }", 1)
s = s.replace("modal.addEventListener('close',()=>{destroyVideo();focusedId=null;updateUrl();});", "modal.addEventListener('close',()=>{stopTimelapse();focusHistory=null;destroyVideo();focusedId=null;updateUrl();});", 1)
jp.write_text(s)

# CSS additions
cp = Path('prototype/vanilla/public/benchmark.css')
c = cp.read_text()
styles = r'''

/* Traffic Time Machine */
.focus-media{position:relative;overflow:hidden}
.history-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#020617;z-index:3}
.time-machine{margin-top:14px;padding:14px;border:1px solid rgba(148,163,184,.22);border-radius:14px;background:rgba(15,23,42,.58)}
.time-machine-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin-bottom:10px}
.time-machine-head strong{font-size:1.05rem;font-variant-numeric:tabular-nums}
.time-machine-head>span,.time-machine-empty span{font-size:.78rem;color:#94a3b8}
.time-machine-empty{display:flex;justify-content:space-between;gap:12px;align-items:center}
.history-scrubber,.compare-control input{width:100%;accent-color:#67e8f9}
.time-machine-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.compare-stage{position:absolute;inset:0;z-index:4;overflow:hidden;background:#020617}
.compare-stage>img,.compare-before img{width:100%;height:100%;object-fit:cover}
.compare-before{position:absolute;inset:0 auto 0 0;width:50%;overflow:hidden;border-right:2px solid #67e8f9}
.compare-before img{width:100vw;max-width:none}
.compare-divider{position:absolute;top:0;bottom:0;left:50%;width:2px;background:#67e8f9;transform:translateX(-1px);box-shadow:0 0 12px rgba(103,232,249,.7)}
.compare-label{position:absolute;top:10px;z-index:5;padding:5px 8px;border-radius:8px;background:rgba(2,6,23,.78);font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.compare-label.before{left:10px}.compare-label.now{right:10px}
.compare-control{display:grid;gap:5px;margin-top:10px;color:#cbd5e1;font-size:.75rem}
@media(max-width:640px){.time-machine-head,.time-machine-empty{align-items:flex-start;flex-direction:column;gap:4px}.time-machine-actions .chip{flex:1}.compare-before img{width:calc(100vw - 32px)}}
'''
if '/* Traffic Time Machine */' not in c:
    c += styles
cp.write_text(c)

# Production Wrangler config gets cron now. Bindings are inserted by provisioning workflow.
wpconf = Path('wrangler.jsonc')
conf = wpconf.read_text()
if '"triggers"' not in conf:
    conf = conf.replace('  "observability": {', '  "triggers": {\n    "crons": ["* * * * *"]\n  },\n  "observability": {', 1)
wpconf.write_text(conf)

# Strengthen deploy smoke with history status check once bindings are active.
dp = Path('.github/workflows/deploy-cloudflare.yml')
d = dp.read_text()
needle = '          echo "Core production smoke test passed: edge-rendered app, camera data, video route, and image transform are healthy"\n'
insert = needle + '''\n          history_status="$(curl --silent --show-error --max-time 10 -o /tmp/cams-history -w '%{http_code}' https://cams.hoxel.dev/api/history/status || true)"\n          test "$history_status" = "200" || { echo "Expected history status API to return 200, got ${history_status}"; cat /tmp/cams-history || true; exit 1; }\n          jq -e 'has("frames") and has("cameras")' /tmp/cams-history >/dev/null || { echo "History status payload invalid"; cat /tmp/cams-history; exit 1; }\n          echo "Traffic Time Machine API is healthy"\n'''
if 'Traffic Time Machine API is healthy' not in d:
    if needle not in d: raise SystemExit('deploy smoke anchor not found')
    d = d.replace(needle, insert, 1)
dp.write_text(d)
