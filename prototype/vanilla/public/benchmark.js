const DEFAULT_ARCGIS = window.__DEFAULT_ARCGIS__;
let cameras = window.__CAMERAS__ || [];
let filtered = cameras;
let visible = matchMedia('(min-width:768px)').matches ? 16 : 6;
let source = 'arcgis';
let featureService = DEFAULT_ARCGIS;
let view = 'grid';
let collectionMode = 'all';
let activeCollections = [];
let focusedId = null;
let lastSync = Date.now();
const health = new Map();
let healthRenderTimer = null;
let map = null;
let mapMarkers = [];
let mapReadyPromise = null;
let hls = null;
let hlsScriptPromise = null;
let liveGridEnabled = false;
const gridPlayers = new Map();
const visibleCards = new Set();
const MAX_AUTO_LIVE = 4;
let focusHistory = null;
let timelapseTimer = null;
let pulse = null;
let pulseByCamera = new Map();
const PULSE_REFRESH_MS = 60000;

const $ = (selector) => document.querySelector(selector);
const grid = $('#grid');
const mapEl = $('#map');
const search = $('#search');
const sentinel = $('#sentinel');
const modal = $('#modal');
const modalBody = $('#modal-body');
const close = $('#close');
const empty = $('#empty');
const collectionsEl = $('#collections');
const diagnostics = $('#diagnostics');
const settings = $('#settings');
const statusLine = $('#status-line');
const visibleCount = $('#visible-count');
const sourceError = $('#source-error');
const pulseEl = $('#pulse');

const COLLECTIONS = [
  ['unusual','Visual changes','Current server-observed visual changes relative to recent historical baselines.'],
  ['live','Live streams','Cameras with a playable video stream.'],
  ['downtown','Downtown','Cameras canonically classified in the downtown core.'],
  ['bridges','Bridges','Bridge approaches and named bridge cameras.'],
  ['i5','I-5','Interstate 5 corridor cameras when present in the selected source.'],
  ['aurora','Aurora / 99','Aurora Avenue and SR-99 cameras.'],
  ['recent','Recently refreshed','Cameras refreshed successfully within the last minute.'],
  ['issues','Signal issues','Cameras with recent image or stream failures.'],
];
const TAXONOMY_COLLECTIONS = new Set(['downtown','bridges','i5','aurora']);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function imageUrl(camera, width = 480, fresh = false) {
  const bucket = fresh ? `&v=${Math.floor(Date.now()/30000)}` : '';
  return `/api/image?path=${encodeURIComponent(camera.imagePath)}&w=${width}${bucket}`;
}
function cameraById(id) { return cameras.find((camera) => camera.id === id); }
function getHealth(camera) { return health.get(camera.id) || {}; }
function pulseObservation(camera) { return pulseByCamera.get(camera.id) || null; }
function isUnusual(camera) { return Boolean(pulseObservation(camera)); }
function baselineLearnedCount() { return Number(pulse?.camerasAnalyzed || 0); }
function scheduleHealthRender() {
  if (healthRenderTimer) return;
  healthRenderTimer = setTimeout(() => {
    healthRenderTimer = null;
    renderCollections();
    updateCounts();
    if (!diagnostics.hidden) renderDiagnostics();
  }, 120);
}
function noteHealth(camera, kind) {
  const current = getHealth(camera);
  if (kind === 'refresh') health.set(camera.id, {...current,lastImageRefresh:Date.now(),lastImageError:undefined});
  if (kind === 'image-error') health.set(camera.id, {...current,lastImageError:Date.now()});
  if (kind === 'stream-error') health.set(camera.id, {...current,lastStreamError:Date.now()});
  scheduleHealthRender();
}

function matchesCollection(camera, id) {
  const h = getHealth(camera);
  if (id === 'unusual') return isUnusual(camera);
  if (id === 'live') return Boolean(camera.videoUrl);
  if (id === 'recent') return Boolean(h.lastImageRefresh && Date.now() - h.lastImageRefresh < 60000);
  if (id === 'issues') return Boolean(h.lastImageError || h.lastStreamError);
  return Array.isArray(camera.collections) && camera.collections.includes(id);
}
function matchesQuery(camera, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const searchable = [camera.label,camera.imagePath,camera.videoUrl,camera.webUrl,camera.lat,camera.lng,...(camera.collections || [])].filter(Boolean).join(' ').toLowerCase();
  return normalized.split(/\s+/).every((token) => searchable.includes(token));
}
function refilter() {
  const query = search.value;
  filtered = cameras.filter((camera) => {
    if (!matchesQuery(camera, query)) return false;
    if (!activeCollections.length) return true;
    const values = activeCollections.map((id) => matchesCollection(camera,id));
    return collectionMode === 'all' ? values.every(Boolean) : values.some(Boolean);
  });
  if (activeCollections.includes('unusual')) filtered.sort((a,b)=>(pulseObservation(b)?.score||0)-(pulseObservation(a)?.score||0));
  visible = matchMedia('(min-width:768px)').matches ? 16 : 6;
  stopAllGridVideo();
  renderGrid(true);
  renderCollections();
  updateCounts();
  updateUrl();
  if (view === 'map') renderMapMarkers();
  if (liveGridEnabled && view === 'grid') queueMicrotask(syncLiveGrid);
}
function observationMeta(camera) {
  const observation = pulseObservation(camera);
  if (!observation) return {text: camera.videoUrl ? 'Live' : 'Snapshot', title: ''};
  const headline = observation.display?.headline || observation.reason || 'Visual change';
  return {text:`Changed ${observation.score}`,title:headline};
}
function card(camera, index) {
  const liveControl = camera.videoUrl
    ? `<button class="grid-play" type="button" data-grid-play="${escapeHtml(camera.id)}" aria-label="Play live video for ${escapeHtml(camera.label)}"><span class="play-icon">▶</span><span class="play-label">Play live</span></button>`
    : '';
  const meta = observationMeta(camera);
  return `<article class="camera-card" data-camera-id="${escapeHtml(camera.id)}"><div class="image-shell"><button class="camera-image-open" type="button" data-camera="${escapeHtml(camera.id)}" aria-label="View ${escapeHtml(camera.label)}"><img src="${imageUrl(camera)}" alt="${escapeHtml(camera.label)}" width="480" height="270" ${index ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async"></button>${liveControl}<span class="live-badge" hidden>LIVE</span></div><button class="camera-open" type="button" data-camera="${escapeHtml(camera.id)}" aria-label="View ${escapeHtml(camera.label)}"><div class="card-copy"><h2>${escapeHtml(camera.label)}</h2><span${meta.title?` title="${escapeHtml(meta.title)}"`:''}>${escapeHtml(meta.text)}</span></div></button></article>`;
}
function updateObservationBadges() {
  grid.querySelectorAll('.camera-card').forEach((cardEl) => {
    const camera = cameraById(cardEl.dataset.cameraId);
    const metaEl = cardEl.querySelector('.card-copy span');
    if (!camera || !metaEl) return;
    const meta = observationMeta(camera);
    metaEl.textContent = meta.text;
    if (meta.title) metaEl.title = meta.title;
    else metaEl.removeAttribute('title');
  });
}
function bindImageHealth(root = grid) {
  root.querySelectorAll('.camera-card img').forEach((img) => {
    if (img.dataset.healthBound) return;
    img.dataset.healthBound = '1';
    const camera = cameraById(img.closest('.camera-card')?.dataset.cameraId);
    if (!camera) return;
    img.addEventListener('load', () => noteHealth(camera,'refresh'));
    img.addEventListener('error', () => noteHealth(camera,'image-error'));
  });
}
const cardObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const cardEl = entry.target;
    const id = cardEl.dataset.cameraId;
    if (!id) continue;
    if (entry.isIntersecting && entry.intersectionRatio >= 0.05) visibleCards.add(id);
    else {
      visibleCards.delete(id);
      const player = gridPlayers.get(id);
      if (player?.mode === 'manual') stopGridVideo(id);
    }
  }
  if (liveGridEnabled && view === 'grid') syncLiveGrid();
}, {threshold:[0,0.05,0.25,0.6],rootMargin:'480px 0px'});
function observeCards(root = grid) {
  root.querySelectorAll('.camera-card').forEach((cardEl) => {
    if (cardEl.dataset.liveObserved) return;
    cardEl.dataset.liveObserved = '1';
    cardObserver.observe(cardEl);
  });
}
function renderGrid(reset = false) {
  if (reset) {
    grid.querySelectorAll('.camera-card').forEach((cardEl)=>cardObserver.unobserve(cardEl));
    visibleCards.clear();
    grid.textContent = '';
  }
  const target = Math.min(visible, filtered.length);
  if (grid.children.length > target) {
    stopAllGridVideo();
    grid.textContent = '';
  }
  for (let i = grid.children.length; i < target; i++) grid.insertAdjacentHTML('beforeend', card(filtered[i],i));
  empty.hidden = filtered.length !== 0;
  sentinel.hidden = target >= filtered.length;
  bindImageHealth();
  observeCards();
}
function renderCollections() {
  const chips = COLLECTIONS.map(([id,label,description]) => {
    const count = cameras.filter((camera) => matchesCollection(camera,id)).length;
    const active = activeCollections.includes(id);
    if (!count && TAXONOMY_COLLECTIONS.has(id) && !active) return '';
    return `<button class="chip ${active?'active':''}" data-collection="${id}" title="${escapeHtml(description)}" aria-pressed="${active}">${escapeHtml(label)} <span>${count}</span></button>`;
  }).join('');
  collectionsEl.innerHTML = chips + (activeCollections.length ? '<button class="chip" data-clear-collections>Clear all</button>' : '') + `<button class="chip live-grid-toggle ${liveGridEnabled?'active':''}" data-live-grid aria-pressed="${liveGridEnabled}" title="Autoplay up to ${MAX_AUTO_LIVE} visible live cameras, muted">${liveGridEnabled?'● Live Grid on':'▶ Live Grid'}</button>`;
}
function issueCount() { return [...health.values()].filter((h) => h.lastImageError || h.lastStreamError).length; }
function unusualCount() { return pulseByCamera.size; }
function updateCounts() {
  visibleCount.textContent = `${filtered.length} visible / ${cameras.length} total`;
  const unusual = unusualCount();
  statusLine.textContent = `${cameras.length} cameras · ${source === 'arcgis' ? 'ArcGIS' : 'SDOT Socrata'} source · ${cameras.filter(c=>c.videoUrl).length} live${unusual?` · ${unusual} visual changes`:''}`;
  $('#diagnostics-toggle').textContent = `Diagnostics · ${issueCount()} issues`;
}
function renderDiagnostics() {
  diagnostics.innerHTML = `<div><span>Total cameras</span><strong>${cameras.length}</strong></div><div><span>Live streams</span><strong>${cameras.filter(c=>c.videoUrl).length}</strong></div><div><span>Visual changes</span><strong>${unusualCount()}</strong></div><div><span>Pulse analyzed</span><strong>${baselineLearnedCount()}</strong></div><div><span>Signal issues</span><strong>${issueCount()}</strong></div><div><span>Last feed sync</span><strong>${new Date(lastSync).toLocaleTimeString()}</strong></div><button id="refresh-feed" class="chip accent">Refresh feed</button><button id="refresh-pulse" class="chip">Refresh Pulse</button>`;
  $('#refresh-feed')?.addEventListener('click', () => loadCameras(true));
  $('#refresh-pulse')?.addEventListener('click', () => loadPulse(true));
}
function updateUrl() {
  const params = new URLSearchParams();
  if (search.value) params.set('q',search.value);
  if (activeCollections.length) params.set('collections',activeCollections.join(','));
  if (collectionMode === 'any') params.set('filterMode','any');
  if (focusedId) params.set('camera',focusedId);
  if (view === 'map') params.set('view','map');
  history.replaceState(null,'',`${location.pathname}${params.size ? `?${params}` : ''}`);
}
function hydrateUrl() {
  const params = new URLSearchParams(location.search);
  search.value = params.get('q') || '';
  activeCollections = (params.get('collections') || '').split(',').filter((id) => COLLECTIONS.some(([known])=>known===id));
  collectionMode = params.get('filterMode') === 'any' ? 'any' : 'all';
  focusedId = params.get('camera');
  view = params.get('view') === 'map' ? 'map' : 'grid';
}

async function loadCameras(force = false) {
  sourceError.textContent = '';
  const url = new URL('/api/cameras',location.origin);
  url.searchParams.set('source',source);
  if (source === 'arcgis' && featureService !== DEFAULT_ARCGIS) url.searchParams.set('arcgis',featureService);
  if (force) url.searchParams.set('_',Date.now());
  try {
    const response = await fetch(url,{headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const next = await response.json();
    if (!Array.isArray(next)) throw new Error('Unexpected camera payload');
    cameras = next;
    lastSync = Date.now();
    refilter();
    if (!diagnostics.hidden) renderDiagnostics();
  } catch (error) {
    sourceError.textContent = error instanceof Error ? error.message : 'Camera feed unavailable';
  }
}

function setView(next) {
  view = next;
  const isMap = view === 'map';
  if (isMap) stopAllGridVideo();
  grid.hidden = isMap;
  sentinel.hidden = isMap || visible >= filtered.length;
  mapEl.hidden = !isMap;
  empty.hidden = isMap || filtered.length !== 0;
  $('#grid-view').classList.toggle('active',!isMap); $('#grid-view').setAttribute('aria-pressed',String(!isMap));
  $('#map-view').classList.toggle('active',isMap); $('#map-view').setAttribute('aria-pressed',String(isMap));
  document.querySelectorAll('[data-mobile-view]').forEach((button)=>button.classList.toggle('active',button.dataset.mobileView===view));
  updateUrl();
  if (isMap) ensureMap();
  else if (liveGridEnabled) queueMicrotask(syncLiveGrid);
}
function loadScript(src) {
  return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);});
}
function loadStyle(href) {
  if ([...document.styleSheets].some((s)=>s.href===new URL(href,location.href).href)) return;
  const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);
}
function ensureHlsScript() {
  if (window.Hls) return Promise.resolve();
  if (!hlsScriptPromise) hlsScriptPromise = loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js').catch((error)=>{hlsScriptPromise=null;throw error;});
  return hlsScriptPromise;
}
async function ensureMap() {
  if (map) { renderMapMarkers(); return; }
  if (!mapReadyPromise) mapReadyPromise = (async()=>{
    mapEl.innerHTML='<div class="map-loading">Loading map…</div>';
    loadStyle('https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.css');
    await loadScript('https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.js');
    mapEl.innerHTML='<div id="map-canvas"></div><div class="map-hud"><strong id="map-count"></strong><button id="fit-map" class="chip">Fit cameras</button><button id="seattle-map" class="chip">Seattle</button></div>';
    map = new maplibregl.Map({container:'map-canvas',center:[-122.3321,47.6062],zoom:11,attributionControl:true,style:{version:8,sources:{dark:{type:'raster',tiles:['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png','https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png','https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],tileSize:512,attribution:'© OpenStreetMap contributors © CARTO'}},layers:[{id:'dark',type:'raster',source:'dark'}]}});
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    $('#fit-map').addEventListener('click',fitMap);
    $('#seattle-map').addEventListener('click',()=>map.flyTo({center:[-122.3321,47.6062],zoom:11}));
    map.on('load',renderMapMarkers);
  })().catch((error)=>{mapReadyPromise=null;mapEl.innerHTML=`<div class="empty">Map failed to load: ${escapeHtml(error.message||String(error))}</div>`;});
  return mapReadyPromise;
}
function renderMapMarkers() {
  if (!map) return;
  mapMarkers.forEach((marker)=>marker.remove()); mapMarkers=[];
  const mappable = filtered.filter((camera)=>Number.isFinite(camera.lat)&&Number.isFinite(camera.lng));
  $('#map-count').textContent = `${mappable.length} active cameras`;
  for (const camera of mappable) {
    const el=document.createElement('button');
    el.className=`camera-marker ${camera.videoUrl?'live':''} ${getHealth(camera).lastImageError?'issue':''} ${isUnusual(camera)?'changed':''}`;
    el.title=camera.label;
    el.setAttribute('aria-label',`View ${camera.label}`);
    el.addEventListener('click',(event)=>{event.stopPropagation();openFocus(camera.id);map.flyTo({center:[camera.lng,camera.lat],zoom:Math.max(map.getZoom(),13)});});
    mapMarkers.push(new maplibregl.Marker({element:el}).setLngLat([camera.lng,camera.lat]).addTo(map));
  }
}
function fitMap() {
  if (!map) return;
  const points=filtered.filter((camera)=>Number.isFinite(camera.lat)&&Number.isFinite(camera.lng)); if (!points.length) return;
  const bounds=new maplibregl.LngLatBounds();points.forEach((camera)=>bounds.extend([camera.lng,camera.lat]));map.fitBounds(bounds,{padding:72,maxZoom:14});
}

function nearest(camera, limit = 4) {
  if (!Number.isFinite(camera.lat)||!Number.isFinite(camera.lng)) return [];
  return cameras.filter((candidate)=>candidate.id!==camera.id&&Number.isFinite(candidate.lat)&&Number.isFinite(candidate.lng)).map((candidate)=>({candidate,d:Math.hypot(candidate.lat-camera.lat,candidate.lng-camera.lng)})).sort((a,b)=>a.d-b.d).slice(0,limit).map((item)=>item.candidate);
}
function preferredVideoUrl(camera) { return camera.directVideoUrl || camera.videoUrl; }
function withTimeout(promise, ms, message = 'Video connection timed out') {
  let timer;
  const timeout = new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}
async function attachHls(video, camera, onFatal) {
  const streamSource = preferredVideoUrl(camera);
  if (!streamSource) throw new Error('No video source');
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamSource;
    return null;
  }
  await ensureHlsScript();
  if (!window.Hls?.isSupported()) throw new Error('HLS playback is not supported');
  const instance = new Hls({enableWorker:true,lowLatencyMode:false});
  instance.loadSource(streamSource);
  instance.attachMedia(video);
  instance.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)onFatal?.(data);});
  return instance;
}
async function setupVideo(camera) {
  if (!camera.videoUrl) return;
  const video = $('#focus-video'); if (!video) return;
  try { hls = await attachHls(video,camera,()=>noteHealth(camera,'stream-error')); }
  catch { noteHealth(camera,'stream-error'); }
}
function destroyVideo() { if (hls){hls.destroy();hls=null;} }

function updateGridPlayerUi(id, playing) {
  const cardEl = grid.querySelector(`.camera-card[data-camera-id="${CSS.escape(id)}"]`);
  if (!cardEl) return;
  cardEl.classList.toggle('is-live',playing);
  const button = cardEl.querySelector('[data-grid-play]');
  const badge = cardEl.querySelector('.live-badge');
  if (button) {
    button.classList.remove('is-connecting');
    button.classList.toggle('is-playing',playing);
    button.setAttribute('aria-label',`${playing?'Stop':'Play'} live video for ${cameraById(id)?.label || 'camera'}`);
    button.querySelector('.play-icon').textContent = playing ? '■' : '▶';
    button.querySelector('.play-label').textContent = playing ? 'Stop live' : 'Play live';
  }
  if (badge) badge.hidden = !playing;
}
function stopGridVideo(id) {
  const player = gridPlayers.get(id);
  if (!player) return;
  player.hls?.destroy();
  try { player.video.pause(); } catch {}
  player.video.removeAttribute('src');
  player.video.load();
  player.video.remove();
  const cardEl = grid.querySelector(`.camera-card[data-camera-id="${CSS.escape(id)}"]`);
  const img = cardEl?.querySelector('.image-shell img');
  if (img) img.hidden = false;
  gridPlayers.delete(id);
  updateGridPlayerUi(id,false);
}
function stopAllGridVideo() { [...gridPlayers.keys()].forEach(stopGridVideo); }
async function startGridVideo(id, mode = 'manual') {
  if (gridPlayers.has(id)) return;
  const camera = cameraById(id);
  const cardEl = grid.querySelector(`.camera-card[data-camera-id="${CSS.escape(id)}"]`);
  if (!camera?.videoUrl || !cardEl) return;
  const shell = cardEl.querySelector('.image-shell');
  const img = shell?.querySelector('img');
  if (!shell || !img) return;
  const video = document.createElement('video');
  video.className = 'grid-video';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.preload = 'none';
  video.poster = imageUrl(camera,480,true);
  video.setAttribute('aria-label',`Live video for ${camera.label}`);
  shell.insertBefore(video,shell.firstChild);
  const player = {video,hls:null,mode};
  gridPlayers.set(id,player);
  const button = cardEl.querySelector('[data-grid-play]');
  if (button) {
    button.classList.add('is-connecting');
    button.querySelector('.play-icon').textContent = '…';
    button.querySelector('.play-label').textContent = 'Connecting';
    button.setAttribute('aria-label',`Connecting live video for ${camera.label}`);
  }
  try {
    player.hls = await attachHls(video,camera,()=>{noteHealth(camera,'stream-error');stopGridVideo(id);});
    await withTimeout(video.play(),8000);
    if (!gridPlayers.has(id)) return;
    img.hidden = true;
    if (button) button.classList.remove('is-connecting');
    updateGridPlayerUi(id,true);
  } catch {
    noteHealth(camera,'stream-error');
    stopGridVideo(id);
  }
}
function syncLiveGrid() {
  if (!liveGridEnabled || grid.hidden || document.hidden) return;
  const nearViewport = [...grid.querySelectorAll('.camera-card')]
    .map((cardEl) => {
      const rect = cardEl.getBoundingClientRect();
      return rect.bottom >= -120 && rect.top <= innerHeight + 720 ? cameraById(cardEl.dataset.cameraId) : null;
    })
    .filter((camera) => camera?.videoUrl);
  const candidates = [...visibleCards].map(cameraById).filter((camera)=>camera?.videoUrl).concat(nearViewport);
  const autoCandidates = [...new Map(candidates.map((camera)=>[camera.id,camera])).values()].slice(0,MAX_AUTO_LIVE);
  const target = new Set(autoCandidates.map((camera)=>camera.id));
  for (const [id,player] of gridPlayers) if (player.mode === 'auto' && !target.has(id)) stopGridVideo(id);
  for (const camera of autoCandidates) if (!gridPlayers.has(camera.id)) startGridVideo(camera.id,'auto');
}
function setLiveGrid(enabled) {
  liveGridEnabled = enabled;
  if (!enabled) {
    for (const [id,player] of [...gridPlayers]) {
      if (player.mode === 'auto') stopGridVideo(id);
    }
  } else if (!grid.hidden) {
    syncLiveGrid();
  }
  renderCollections();
}

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
  media.insertAdjacentHTML('beforeend',`<div id="compare-stage" class="compare-stage" style="--split:50%"><img class="compare-now-image" src="${imageUrl(camera,960,true)}" alt="${escapeHtml(camera.label)} now"><img class="compare-before-image" src="${frame.imageUrl}" alt="${escapeHtml(camera.label)} at ${timeLabel(frame.capturedAt)}"><span class="compare-label before">${timeLabel(frame.capturedAt)}</span><span class="compare-label now">Now</span><span class="compare-divider"></span></div>`);
  const tm=$('#time-machine');
  tm?.insertAdjacentHTML('beforeend','<label class="compare-control">Before / After <input id="compare-scrubber" type="range" min="5" max="95" value="50"></label>');
  const slider=$('#compare-scrubber');
  const stage=$('#compare-stage');
  const apply=()=>stage?.style.setProperty('--split',`${Number(slider.value)}%`);
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

function pulseCamera(item) { return cameraById(item.cameraId); }
function pulseTime(value) {
  const minutes=Math.max(0,Math.round((Date.now()-value)/60000));
  return minutes<1?'just now':minutes===1?'1 min ago':`${minutes} min ago`;
}
function confidenceLabel(value) {
  return value === 'high' ? 'high confidence' : value === 'moderate' ? 'moderate confidence' : '';
}
function renderPulse() {
  if (!pulseEl) return;
  if (!pulse) {
    pulseEl.innerHTML='<div class="pulse-loading"><div><p class="eyebrow">Seattle Pulse</p><strong>Reading the city…</strong></div><span>Ranking recent camera changes</span></div>';
    return;
  }
  const items=(pulse.items||[]).filter((item)=>pulseCamera(item)).slice(0,6);
  const events=(pulse.events||[]).slice(0,4).map((event)=>`<div class="phase2-event" data-severity="${escapeHtml(event.severity)}"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail)} · ${escapeHtml(event.confidence)} confidence</span></div>`).join('');
  const cards=items.map((item,index)=>{
    const camera=pulseCamera(item);
    const headline=item.display?.headline||item.reason||'Visual change';
    const detail=item.display?.detail||item.reason||'';
    const persistence=item.persistenceSamples>=2?` · ${item.persistenceSamples} captures`:'';
    const confidence=confidenceLabel(item.confidence);
    return `<button class="pulse-card" data-pulse-camera="${escapeHtml(item.cameraId)}" data-observation-state="${escapeHtml(item.state||'changing')}" data-observation-severity="${escapeHtml(item.severity||'low')}"><span class="pulse-rank">#${index+1}</span><span class="pulse-thumb"><img src="${imageUrl(camera,480,true)}" alt="" width="160" height="90" loading="lazy"></span><span class="pulse-copy"><strong>${escapeHtml(camera.label)}</strong><small title="${escapeHtml(detail)}">${escapeHtml(headline)} · ${pulseTime(item.capturedAt)}${escapeHtml(persistence)}${confidence?` <span class="phase2-confidence">${escapeHtml(confidence)}</span>`:''} · <span class="phase2-evidence">Open evidence →</span></small></span><span class="pulse-score" title="${escapeHtml(detail)}">${item.score}</span></button>`;
  }).join('');
  pulseEl.innerHTML=`<div class="pulse-head"><div><p class="eyebrow">Seattle Pulse</p><div class="pulse-title"><strong>${escapeHtml(pulse.state)}</strong><span>${pulse.pulseScore}/100</span></div></div><div class="pulse-meta"><span>${pulse.activeCameras} active cameras</span><span>${pulse.camerasAnalyzed} analyzed</span><button id="pulse-refresh" class="chip">Refresh</button></div></div>${events?`<div class="phase2-events" aria-label="Correlated areas">${events}</div>`:''}<div class="pulse-rail">${cards||'<div class="pulse-empty">History is still warming up.</div>'}</div><p class="pulse-method">Observed visual change only — Pulse does not infer crashes, congestion, weather, incidents, or causes.</p>`;
  pulseEl.querySelectorAll('[data-pulse-camera]').forEach((button)=>button.addEventListener('click',()=>openFocus(button.dataset.pulseCamera)));
  $('#pulse-refresh')?.addEventListener('click',()=>loadPulse(true));
}
async function loadPulse(force=false) {
  if (!pulseEl || document.hidden) return;
  const url=new URL('/api/pulse',location.origin);
  url.searchParams.set('window','60');url.searchParams.set('limit','24');if(force)url.searchParams.set('_',Date.now());
  try {
    const response=await fetch(url,{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`Pulse returned ${response.status}`);
    const next=await response.json();
    if(!Array.isArray(next.items))throw new Error('Unexpected Pulse payload');
    pulse=next;
    const observationIndex=Array.isArray(next.observationIndex)?next.observationIndex:next.items;
    pulseByCamera=new Map(observationIndex.map((item)=>[item.cameraId,item]));
    renderPulse();
    if (activeCollections.includes('unusual')) refilter();
    else {
      renderCollections();
      updateCounts();
      updateObservationBadges();
      if (view === 'map') renderMapMarkers();
    }
    if (!diagnostics.hidden) renderDiagnostics();
  } catch {
    if(!pulse)pulseEl.innerHTML='<div class="pulse-loading pulse-error"><div><p class="eyebrow">Seattle Pulse</p><strong>Pulse temporarily unavailable</strong></div><button id="pulse-retry" class="chip">Retry</button></div>';
    $('#pulse-retry')?.addEventListener('click',()=>loadPulse(true));
  }
}

function openFocus(id) {
  const camera=cameraById(id); if (!camera) return;
  destroyVideo(); focusedId=id; updateUrl();
  const set=filtered.length?filtered:cameras;const index=set.findIndex((candidate)=>candidate.id===id);const prev=set[(index-1+set.length)%set.length];const next=set[(index+1)%set.length];
  const nearby=nearest(camera).map((candidate)=>`<button class="nearby-camera" data-focus="${escapeHtml(candidate.id)}">${escapeHtml(candidate.label)}</button>`).join('');
  const observation=pulseObservation(camera);
  const observationCopy=observation?`<p class="sub">Visual change ${observation.score}/100 · ${escapeHtml(observation.display?.headline||observation.reason||'Observed change')} · ${escapeHtml(confidenceLabel(observation.confidence)||'qualified observation')}</p>`:'';
  modalBody.innerHTML=`<div class="focus-head"><p class="eyebrow">Camera focus</p><h2>${escapeHtml(camera.label)}</h2>${observationCopy}</div><div class="focus-media">${camera.videoUrl?`<video id="focus-video" controls playsinline poster="${imageUrl(camera,960,true)}"></video>`:`<img src="${imageUrl(camera,960,true)}" alt="${escapeHtml(camera.label)}" width="960" height="540">`}<img id="history-frame" class="history-frame" hidden alt="Historical frame for ${escapeHtml(camera.label)}"></div><section id="time-machine" class="time-machine" aria-live="polite"><div class="time-machine-empty"><strong>Traffic Time Machine</strong><span>Loading recent history…</span></div></section><div class="focus-actions"><button class="chip" data-focus="${escapeHtml(prev?.id||id)}">← Previous</button><button id="refresh-focus" class="chip">Refresh snapshot</button><button class="chip" data-focus="${escapeHtml(next?.id||id)}">Next →</button>${camera.webUrl?`<a class="chip" href="${escapeHtml(camera.webUrl)}" target="_blank" rel="noopener noreferrer">SDOT page</a>`:''}</div>${nearby?`<div class="nearby"><p>Nearby cameras</p>${nearby}</div>`:''}`;
  if (!modal.open) modal.showModal();
  $('#refresh-focus')?.addEventListener('click',()=>{const media=$('#focus-video')||modalBody.querySelector('img');if(media){if(media.tagName==='IMG')media.src=imageUrl(camera,960,true);else media.poster=imageUrl(camera,960,true);}});
  if (camera.videoUrl) setupVideo(camera);
  loadTimeMachine(camera);
}
function closeFocus() { stopTimelapse();focusHistory=null;destroyVideo();focusedId=null;updateUrl();modal.close(); }

grid.addEventListener('click',(event)=>{
  const play=event.target.closest('[data-grid-play]');
  if (play) {
    event.preventDefault();event.stopPropagation();
    const id=play.dataset.gridPlay;
    if (gridPlayers.has(id)) stopGridVideo(id); else startGridVideo(id,'manual');
    return;
  }
  const target=event.target.closest('.camera-image-open,.camera-open');
  if(target)openFocus(target.dataset.camera);
});
modalBody.addEventListener('click',(event)=>{const button=event.target.closest('[data-focus]');if(button)openFocus(button.dataset.focus);});
close.addEventListener('click',closeFocus);
modal.addEventListener('click',(event)=>{if(event.target===modal)closeFocus();});
modal.addEventListener('close',()=>{stopTimelapse();focusHistory=null;destroyVideo();focusedId=null;updateUrl();});
search.addEventListener('input',refilter);
collectionsEl.addEventListener('click',(event)=>{
  const button=event.target.closest('button');if(!button)return;
  if (button.dataset.liveGrid !== undefined) { setLiveGrid(!liveGridEnabled); return; }
  if(button.dataset.clearCollections!==undefined)activeCollections=[];
  else if(button.dataset.collection){const id=button.dataset.collection;activeCollections=activeCollections.includes(id)?activeCollections.filter((item)=>item!==id):[...activeCollections,id];}
  refilter();
});
$('#match-all').addEventListener('click',()=>{collectionMode='all';$('#match-all').classList.add('active');$('#match-any').classList.remove('active');refilter();});
$('#match-any').addEventListener('click',()=>{collectionMode='any';$('#match-any').classList.add('active');$('#match-all').classList.remove('active');refilter();});
$('#grid-view').addEventListener('click',()=>setView('grid'));
$('#map-view').addEventListener('click',()=>setView('map'));
document.querySelectorAll('[data-mobile-view]').forEach((button)=>button.addEventListener('click',()=>setView(button.dataset.mobileView)));
$('#settings-toggle').addEventListener('click',()=>{settings.hidden=!settings.hidden;$('#settings-toggle').setAttribute('aria-expanded',String(!settings.hidden));});
$('#mobile-settings').addEventListener('click',()=>{settings.hidden=false;$('#settings-toggle').setAttribute('aria-expanded','true');scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});});
$('#source-arcgis').addEventListener('click',()=>{source='arcgis';$('#source-arcgis').classList.add('active');$('#source-sdot').classList.remove('active');});
$('#source-sdot').addEventListener('click',()=>{source='sdot';$('#source-sdot').classList.add('active');$('#source-arcgis').classList.remove('active');});
$('#restore-source').addEventListener('click',()=>{$('#arcgis-url').value=DEFAULT_ARCGIS;featureService=DEFAULT_ARCGIS;sourceError.textContent='';});
$('#apply-source').addEventListener('click',async()=>{featureService=$('#arcgis-url').value.trim()||DEFAULT_ARCGIS;await loadCameras(true);if(!sourceError.textContent){settings.hidden=true;$('#settings-toggle').setAttribute('aria-expanded','false');}});
$('#diagnostics-toggle').addEventListener('click',()=>{diagnostics.hidden=!diagnostics.hidden;if(!diagnostics.hidden)renderDiagnostics();});
new IntersectionObserver(([entry])=>{if(entry.isIntersecting&&view==='grid'&&visible<filtered.length){visible+=6;renderGrid();if(liveGridEnabled)queueMicrotask(syncLiveGrid);}}, {rootMargin:'300px 0px'}).observe(sentinel);

document.addEventListener('visibilitychange',()=>{
  if (document.hidden) stopAllGridVideo();
  else {
    if (liveGridEnabled && view === 'grid') syncLiveGrid();
    loadPulse(true);
  }
});
setInterval(()=>{
  if (document.hidden) return;
  document.querySelectorAll('.camera-card img:not([hidden])').forEach((img)=>{const cardEl=img.closest('.camera-card');const camera=cameraById(cardEl?.dataset.cameraId);if(camera)img.src=imageUrl(camera,480,true);});
},30000);
setInterval(()=>loadCameras(false),5*60*1000);
setInterval(()=>loadPulse(false),PULSE_REFRESH_MS);
setInterval(()=>{
  if (activeCollections.includes('recent') || activeCollections.includes('issues')) refilter();
  else { renderCollections(); updateCounts(); }
},30000);

loadStyle('/evidence.css');
hydrateUrl();
$('#match-all').classList.toggle('active',collectionMode==='all');
$('#match-any').classList.toggle('active',collectionMode==='any');
refilter();setView(view);renderDiagnostics();renderPulse();
queueMicrotask(()=>loadPulse(false));
if (focusedId) queueMicrotask(()=>openFocus(focusedId));
