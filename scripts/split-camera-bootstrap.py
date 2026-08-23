from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    s = p.read_text()
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    p.write_text(s.replace(old, new, 1))


worker = 'prototype/vanilla/worker.ts'
replace_once(
    worker,
    """function initialCollectionButtons(cameras: Camera[]): string {
  return INITIAL_COLLECTIONS.flatMap(([id, label]) => {
    const count = initialCollectionCount(cameras, id);
    if (!count && !['live', 'recent', 'issues'].includes(id)) return [];
    return [`<button class=\"chip\" data-collection=\"${id}\" aria-pressed=\"false\">${esc(label)} <span>${count}</span></button>`];
  }).join('');
}""",
    """function initialCollectionButtons(cameras: Camera[]): string {
  const chips = INITIAL_COLLECTIONS.flatMap(([id, label]) => {
    const count = initialCollectionCount(cameras, id);
    if (!count && !['live', 'recent', 'issues'].includes(id)) return [];
    return [`<button class=\"chip\" data-collection=\"${id}\" aria-pressed=\"false\">${esc(label)} <span>${count}</span></button>`];
  }).join('');
  return `${chips}<button class=\"chip live-grid-toggle\" data-live-grid aria-pressed=\"false\" title=\"Autoplay up to 4 visible live cameras, muted\">▶ Live Grid</button>`;
}""",
    'server-render Live Grid control',
)
replace_once(
    worker,
    """function page(cameras: Camera[]): Response {
  const first = cameras.slice(0, 6);
  const bootstrap = JSON.stringify(cameras).replace(/</g, '\\\\u003c');""",
    """function page(cameras: Camera[]): Response {
  const first = cameras.slice(0, 6);
  // Keep the critical HTML small: bootstrap only the viewport cameras. The full
  // catalog is fetched after first paint and upgrades window.__CAMERAS__ in place.
  const bootstrap = JSON.stringify(first).replace(/</g, '\\\\u003c');""",
    'viewport-only camera bootstrap',
)
replace_once(
    worker,
    """    <script>window.__CAMERAS__=${bootstrap};window.__DEFAULT_ARCGIS__=${JSON.stringify(DEFAULT_FEATURE_SERVICE)}</script><script type=\"module\" src=\"/benchmark.js\"></script>""",
    """    <script>window.__CAMERAS__=${bootstrap};window.__CAMERA_COUNT__=${cameras.length};window.__DEFAULT_ARCGIS__=${JSON.stringify(DEFAULT_FEATURE_SERVICE)}</script><script type=\"module\" src=\"/benchmark.js\"></script>""",
    'total camera count bootstrap',
)

js = 'prototype/vanilla/public/benchmark.js'
replace_once(
    js,
    """let cameras = window.__CAMERAS__ || [];
let filtered = cameras;""",
    """let cameras = window.__CAMERAS__ || [];
const bootstrapCameraCount = Number(window.__CAMERA_COUNT__ || cameras.length);
let catalogReady = cameras.length >= bootstrapCameraCount;
let filtered = cameras;""",
    'catalog readiness state',
)
replace_once(
    js,
    """function hydrateServerGrid() {
  if (search.value || activeCollections.length || !grid.children.length) return false;
  filtered = cameras;
  visible = matchMedia('(min-width:768px)').matches ? 16 : 6;
  // The Worker already rendered the first viewport. Preserve it and append only
  // the additional desktop cards instead of destroying and rebuilding the DOM.
  renderGrid(false);
  renderCollections();
  updateCounts();
  updateUrl();
  return true;
}""",
    """function hydrateServerGrid() {
  if (search.value || activeCollections.length || !grid.children.length) return false;
  filtered = cameras;
  visible = matchMedia('(min-width:768px)').matches ? 16 : 6;
  // The Worker already rendered the first viewport and truthful city-wide counts.
  // Bind behavior in place; the full catalog will append/upgrade after first paint.
  empty.hidden = true;
  sentinel.hidden = true;
  bindImageHealth();
  observeCards();
  updateUrl();
  return true;
}""",
    'viewport-only hydration',
)
replace_once(
    js,
    """    cameras = next;
    lastSync = Date.now();
    refilter();
    if (!diagnostics.hidden) renderDiagnostics();""",
    """    const upgradingBootstrap = !catalogReady && source === 'arcgis' && !force && featureService === DEFAULT_ARCGIS;
    cameras = next;
    window.__CAMERAS__ = next;
    catalogReady = true;
    lastSync = Date.now();
    if (upgradingBootstrap && !search.value && !activeCollections.length && view === 'grid') {
      filtered = cameras;
      visible = matchMedia('(min-width:768px)').matches ? 16 : 6;
      renderGrid(false);
      renderCollections();
      updateCounts();
      updateUrl();
    } else {
      refilter();
    }
    if (!diagnostics.hidden) renderDiagnostics();""",
    'non-destructive catalog upgrade',
)
replace_once(
    js,
    """if (!hydrateServerGrid()) refilter();
setView(view);
const hydratePulse = () => loadPulse(false);
if ('requestIdleCallback' in window) requestIdleCallback(hydratePulse,{timeout:2500});
else setTimeout(hydratePulse,800);
if (focusedId) queueMicrotask(()=>openFocus(focusedId));""",
    """const hydratedViewport = hydrateServerGrid();
if (!hydratedViewport && catalogReady) refilter();
setView(view);
const hydratePulse = () => loadPulse(false);
const hydrateCatalog = async () => {
  if (!catalogReady) await loadCameras(false);
  if ('requestIdleCallback' in window) requestIdleCallback(hydratePulse,{timeout:2200});
  else setTimeout(hydratePulse,700);
  if (focusedId) openFocus(focusedId);
};
if (catalogReady) {
  if ('requestIdleCallback' in window) requestIdleCallback(hydratePulse,{timeout:2200});
  else setTimeout(hydratePulse,700);
  if (focusedId) queueMicrotask(()=>openFocus(focusedId));
} else if ('requestIdleCallback' in window) {
  requestIdleCallback(()=>hydrateCatalog(),{timeout:900});
} else {
  setTimeout(()=>hydrateCatalog(),500);
}""",
    'post-paint full catalog hydration',
)
