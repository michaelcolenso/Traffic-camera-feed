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
let map = null;
let mapMarkers = [];
let mapReadyPromise = null;
let hls = null;

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

const COLLECTIONS = [
  ['live','Live streams','Cameras with a playable video stream.'],
  ['downtown','Downtown','Likely downtown intersections based on camera labels.'],
  ['bridges','Bridges','Bridge approaches and named bridge cameras.'],
  ['i5','I-5','Interstate 5 corridor cameras.'],
  ['aurora','Aurora / 99','Aurora Avenue and SR-99 cameras.'],
  ['recent','Recently refreshed','Cameras refreshed successfully within the last minute.'],
  ['issues','Signal issues','Cameras with recent image or stream failures.'],
];
const KEYWORDS = {
  downtown:['downtown','5th','4th','3rd','2nd','1st','pike','pine','union','madison','james'],
  bridges:['bridge','fremont','ballard','montlake','spokane','west seattle','university'],
  i5:['i-5','i5','interstate 5'],
  aurora:['aurora','sr 99','sr99','99'],
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function imageUrl(camera, width = 480, fresh = false) {
  const bucket = fresh ? `&v=${Math.floor(Date.now()/30000)}` : '';
  return `/api/image?path=${encodeURIComponent(camera.imagePath)}&w=${width}${bucket}`;
}
function cameraById(id) { return cameras.find((camera) => camera.id === id); }
function getHealth(camera) { return health.get(camera.id) || {}; }
function noteHealth(camera, kind) {
  const current = getHealth(camera);
  if (kind === 'refresh') health.set(camera.id, {...current,lastImageRefresh:Date.now(),lastImageError:undefined});
  if (kind === 'image-error') health.set(camera.id, {...current,lastImageError:Date.now()});
  if (kind === 'stream-error') health.set(camera.id, {...current,lastStreamError:Date.now()});
  renderCollections();
  if (!diagnostics.hidden) renderDiagnostics();
}
function matchesCollection(camera, id) {
  const h = getHealth(camera);
  if (id === 'live') return Boolean(camera.videoUrl);
  if (id === 'recent') return Boolean(h.lastImageRefresh && Date.now() - h.lastImageRefresh < 60000);
  if (id === 'issues') return Boolean(h.lastImageError || h.lastStreamError);
  return (KEYWORDS[id] || []).some((word) => camera.label.toLowerCase().includes(word));
}
function matchesQuery(camera, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const searchable = [camera.label,camera.imagePath,camera.videoUrl,camera.webUrl,camera.lat,camera.lng].filter(Boolean).join(' ').toLowerCase();
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
  visible = matchMedia('(min-width:768px)').matches ? 16 : 6;
  renderGrid(true);
  renderCollections();
  updateCounts();
  updateUrl();
  if (view === 'map') renderMapMarkers();
}
function card(camera, index) {
  return `<article class="camera-card" data-camera-id="${escapeHtml(camera.id)}"><button class="camera-open" data-camera="${escapeHtml(camera.id)}" aria-label="View ${escapeHtml(camera.label)}"><div class="image-shell"><img src="${imageUrl(camera)}" alt="${escapeHtml(camera.label)}" width="480" height="270" ${index ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async"></div><div class="card-copy"><h2>${escapeHtml(camera.label)}</h2><span>${camera.videoUrl ? 'Live' : 'Snapshot'}</span></div></button></article>`;
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
function renderGrid(reset = false) {
  if (reset) grid.textContent = '';
  const target = Math.min(visible, filtered.length);
  if (grid.children.length > target) grid.textContent = '';
  for (let i = grid.children.length; i < target; i++) grid.insertAdjacentHTML('beforeend', card(filtered[i],i));
  empty.hidden = filtered.length !== 0;
  sentinel.hidden = target >= filtered.length;
  bindImageHealth();
}
function renderCollections() {
  collectionsEl.innerHTML = COLLECTIONS.map(([id,label,description]) => {
    const count = cameras.filter((camera) => matchesCollection(camera,id)).length;
    const active = activeCollections.includes(id);
    return `<button class="chip ${active?'active':''}" data-collection="${id}" title="${escapeHtml(description)}" aria-pressed="${active}">${escapeHtml(label)} <span>${count}</span></button>`;
  }).join('') + (activeCollections.length ? '<button class="chip" data-clear-collections>Clear all</button>' : '');
}
function issueCount() { return [...health.values()].filter((h) => h.lastImageError || h.lastStreamError).length; }
function updateCounts() {
  visibleCount.textContent = `${filtered.length} visible / ${cameras.length} total`;
  statusLine.textContent = `${cameras.length} cameras · ${source === 'arcgis' ? 'ArcGIS' : 'SDOT Socrata'} source · ${cameras.filter(c=>c.videoUrl).length} live`;
  $('#diagnostics-toggle').textContent = `Diagnostics · ${issueCount()} issues`;
}
function renderDiagnostics() {
  diagnostics.innerHTML = `<div><span>Total cameras</span><strong>${cameras.length}</strong></div><div><span>Live streams</span><strong>${cameras.filter(c=>c.videoUrl).length}</strong></div><div><span>Signal issues</span><strong>${issueCount()}</strong></div><div><span>Last sync</span><strong>${new Date(lastSync).toLocaleTimeString()}</strong></div><button id="refresh-feed" class="chip accent">Refresh feed</button>`;
  $('#refresh-feed')?.addEventListener('click', () => loadCameras(true));
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
  grid.hidden = isMap;
  sentinel.hidden = isMap || visible >= filtered.length;
  mapEl.hidden = !isMap;
  empty.hidden = isMap || filtered.length !== 0;
  $('#grid-view').classList.toggle('active',!isMap); $('#grid-view').setAttribute('aria-pressed',String(!isMap));
  $('#map-view').classList.toggle('active',isMap); $('#map-view').setAttribute('aria-pressed',String(isMap));
  document.querySelectorAll('[data-mobile-view]').forEach((button)=>button.classList.toggle('active',button.dataset.mobileView===view));
  updateUrl();
  if (isMap) ensureMap();
}
function loadScript(src) {
  return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);});
}
function loadStyle(href) {
  if ([...document.styleSheets].some((s)=>s.href===href)) return;
  const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);
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
  mapMarkers.forEach((m)=>m.remove()); mapMarkers=[];
  const mappable = filtered.filter((c)=>Number.isFinite(c.lat)&&Number.isFinite(c.lng));
  $('#map-count').textContent = `${mappable.length} active cameras`;
  for (const camera of mappable) {
    const el=document.createElement('button');el.className=`camera-marker ${camera.videoUrl?'live':''} ${getHealth(camera).lastImageError?'issue':''}`;el.title=camera.label;el.setAttribute('aria-label',`View ${camera.label}`);
    el.addEventListener('click',(event)=>{event.stopPropagation();openFocus(camera.id);map.flyTo({center:[camera.lng,camera.lat],zoom:Math.max(map.getZoom(),13)});});
    mapMarkers.push(new maplibregl.Marker({element:el}).setLngLat([camera.lng,camera.lat]).addTo(map));
  }
}
function fitMap() {
  if (!map) return;
  const points=filtered.filter((c)=>Number.isFinite(c.lat)&&Number.isFinite(c.lng)); if (!points.length) return;
  const bounds=new maplibregl.LngLatBounds();points.forEach((c)=>bounds.extend([c.lng,c.lat]));map.fitBounds(bounds,{padding:72,maxZoom:14});
}

function nearest(camera, limit = 4) {
  if (!Number.isFinite(camera.lat)||!Number.isFinite(camera.lng)) return [];
  return cameras.filter((c)=>c.id!==camera.id&&Number.isFinite(c.lat)&&Number.isFinite(c.lng)).map((c)=>({c,d:Math.hypot(c.lat-camera.lat,c.lng-camera.lng)})).sort((a,b)=>a.d-b.d).slice(0,limit).map((x)=>x.c);
}
async function setupVideo(camera) {
  if (!camera.videoUrl) return;
  const video = $('#focus-video'); if (!video) return;
  if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src=camera.videoUrl; return; }
  try {
    if (!window.Hls) await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js');
    if (window.Hls?.isSupported()) {
      hls = new Hls({enableWorker:true,lowLatencyMode:false});hls.loadSource(camera.videoUrl);hls.attachMedia(video);
      hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)noteHealth(camera,'stream-error');});
    }
  } catch { noteHealth(camera,'stream-error'); }
}
function destroyVideo() { if (hls){hls.destroy();hls=null;} }
function openFocus(id) {
  const camera=cameraById(id); if (!camera) return;
  destroyVideo(); focusedId=id; updateUrl();
  const set=filtered.length?filtered:cameras;const index=set.findIndex((c)=>c.id===id);const prev=set[(index-1+set.length)%set.length];const next=set[(index+1)%set.length];
  const nearby=nearest(camera).map((c)=>`<button class="nearby-camera" data-focus="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`).join('');
  modalBody.innerHTML=`<div class="focus-head"><p class="eyebrow">Camera focus</p><h2>${escapeHtml(camera.label)}</h2></div><div class="focus-media">${camera.videoUrl?`<video id="focus-video" controls playsinline poster="${imageUrl(camera,960,true)}"></video>`:`<img src="${imageUrl(camera,960,true)}" alt="${escapeHtml(camera.label)}" width="960" height="540">`}</div><div class="focus-actions"><button class="chip" data-focus="${escapeHtml(prev?.id||id)}">← Previous</button><button id="refresh-focus" class="chip">Refresh snapshot</button><button class="chip" data-focus="${escapeHtml(next?.id||id)}">Next →</button>${camera.webUrl?`<a class="chip" href="${escapeHtml(camera.webUrl)}" target="_blank" rel="noopener noreferrer">SDOT page</a>`:''}</div>${nearby?`<div class="nearby"><p>Nearby cameras</p>${nearby}</div>`:''}`;
  if (!modal.open) modal.showModal();
  $('#refresh-focus')?.addEventListener('click',()=>{const media=$('#focus-video')||modalBody.querySelector('img');if(media){if(media.tagName==='IMG')media.src=imageUrl(camera,960,true);else media.poster=imageUrl(camera,960,true);}});
  if (camera.videoUrl) setupVideo(camera);
}
function closeFocus() { destroyVideo();focusedId=null;updateUrl();modal.close(); }

grid.addEventListener('click',(event)=>{const button=event.target.closest('.camera-open');if(button)openFocus(button.dataset.camera);});
modalBody.addEventListener('click',(event)=>{const button=event.target.closest('[data-focus]');if(button)openFocus(button.dataset.focus);});
close.addEventListener('click',closeFocus);modal.addEventListener('click',(event)=>{if(event.target===modal)closeFocus();});modal.addEventListener('close',()=>{destroyVideo();focusedId=null;updateUrl();});
search.addEventListener('input',refilter);
collectionsEl.addEventListener('click',(event)=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.clearCollections!==undefined)activeCollections=[];else if(button.dataset.collection){const id=button.dataset.collection;activeCollections=activeCollections.includes(id)?activeCollections.filter((x)=>x!==id):[...activeCollections,id];}refilter();});
$('#match-all').addEventListener('click',()=>{collectionMode='all';$('#match-all').classList.add('active');$('#match-any').classList.remove('active');refilter();});
$('#match-any').addEventListener('click',()=>{collectionMode='any';$('#match-any').classList.add('active');$('#match-all').classList.remove('active');refilter();});
$('#grid-view').addEventListener('click',()=>setView('grid'));$('#map-view').addEventListener('click',()=>setView('map'));document.querySelectorAll('[data-mobile-view]').forEach((b)=>b.addEventListener('click',()=>setView(b.dataset.mobileView)));
$('#settings-toggle').addEventListener('click',()=>{settings.hidden=!settings.hidden;$('#settings-toggle').setAttribute('aria-expanded',String(!settings.hidden));});
$('#mobile-settings').addEventListener('click',()=>{settings.hidden=false;$('#settings-toggle').setAttribute('aria-expanded','true');scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});});
$('#source-arcgis').addEventListener('click',()=>{source='arcgis';$('#source-arcgis').classList.add('active');$('#source-sdot').classList.remove('active');});
$('#source-sdot').addEventListener('click',()=>{source='sdot';$('#source-sdot').classList.add('active');$('#source-arcgis').classList.remove('active');});
$('#restore-source').addEventListener('click',()=>{$('#arcgis-url').value=DEFAULT_ARCGIS;featureService=DEFAULT_ARCGIS;sourceError.textContent='';});
$('#apply-source').addEventListener('click',async()=>{featureService=$('#arcgis-url').value.trim()||DEFAULT_ARCGIS;await loadCameras(true);if(!sourceError.textContent){settings.hidden=true;$('#settings-toggle').setAttribute('aria-expanded','false');}});
$('#diagnostics-toggle').addEventListener('click',()=>{diagnostics.hidden=!diagnostics.hidden;if(!diagnostics.hidden)renderDiagnostics();});
new IntersectionObserver(([entry])=>{if(entry.isIntersecting&&view==='grid'&&visible<filtered.length){visible+=6;renderGrid();}}, {rootMargin:'300px 0px'}).observe(sentinel);

setInterval(()=>{
  if (document.hidden) return;
  document.querySelectorAll('.camera-card img').forEach((img)=>{const card=img.closest('.camera-card');const camera=cameraById(card?.dataset.cameraId);if(camera)img.src=imageUrl(camera,480,true);});
},30000);
setInterval(()=>loadCameras(false),5*60*1000);

hydrateUrl();
$('#match-all').classList.toggle('active',collectionMode==='all');$('#match-any').classList.toggle('active',collectionMode==='any');
refilter();setView(view);renderDiagnostics();
if (focusedId) queueMicrotask(()=>openFocus(focusedId));