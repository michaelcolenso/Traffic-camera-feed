import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Search,
  Video,
  AlertTriangle,
  Map,
  LayoutGrid,
  Settings,
  X,
  Database,
  Radio,
  Satellite,
  Clock3,
} from 'lucide-react';
import { CameraCard } from './components/CameraCard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MapView } from './components/MapView';
import { fetchArcGISCameras, ARCGIS_FEATURE_SERVICE_URL } from './services/arcgis';
import { fetchCameras } from './services/api';
import { CameraHealth, CollectionId, cameraCollections, filterCameras, getCameraId } from './lib/cameras';
import { FocusCameraModal } from './components/FocusCameraModal';
import { TrafficCamera } from './types';

type ViewMode = 'grid' | 'map';
type DataSource = 'sdot' | 'arcgis';
type CollectionMode = 'all' | 'any';

function makeFetcher(source: DataSource, arcgisUrl: string) {
  return (_key: string): Promise<TrafficCamera[]> =>
    source === 'arcgis' ? fetchArcGISCameras(arcgisUrl) : fetchCameras();
}

function getInitialCollections(): CollectionId[] {
  const allowed = new Set(cameraCollections.map((collection) => collection.id));
  return (new URLSearchParams(window.location.search).get('collections')?.split(',').filter((id): id is CollectionId =>
    allowed.has(id as CollectionId),
  ) ?? []);
}

function getInitialCollectionMode(): CollectionMode {
  return new URLSearchParams(window.location.search).get('filterMode') === 'any' ? 'any' : 'all';
}

export default function App() {
  const [view, setView] = useState<ViewMode>(() =>
    new URLSearchParams(window.location.search).get('view') === 'map' ? 'map' : 'grid',
  );
  const [source, setSource] = useState<DataSource>('arcgis');
  const [arcgisUrl, setArcgisUrl] = useState(ARCGIS_FEATURE_SERVICE_URL);
  const [pendingUrl, setPendingUrl] = useState(ARCGIS_FEATURE_SERVICE_URL);
  const [arcgisUrlError, setArcgisUrlError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [activeCollections, setActiveCollections] = useState<CollectionId[]>(getInitialCollections);
  const [collectionMode, setCollectionMode] = useState<CollectionMode>(getInitialCollectionMode);
  const [focusedCamera, setFocusedCamera] = useState<TrafficCamera | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [healthByCamera, setHealthByCamera] = useState<Record<string, CameraHealth>>({});
  const [hasHydratedUrlCamera, setHasHydratedUrlCamera] = useState(false);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<number | null>(null);
  const deferredQuery = useDeferredValue(searchQuery);

  const swrKey = `cameras-${source}-${arcgisUrl}`;
  const { data: cameras, error, isLoading, mutate } = useSWR(
    swrKey,
    makeFetcher(source, arcgisUrl),
    { refreshInterval: 5 * 60_000, revalidateOnFocus: false },
  );

  const filteredCameras = useMemo(
    () => filterCameras(cameras ?? [], deferredQuery, activeCollections, healthByCamera, collectionMode),
    [activeCollections, cameras, collectionMode, deferredQuery, healthByCamera],
  );

  const withVideo = cameras?.filter((c) => c.video_url?.url).length ?? 0;
  const issueCount = (Object.values(healthByCamera) as CameraHealth[]).filter((health) => health.lastImageError || health.lastStreamError).length;

  const handleHealthChange = useCallback((camera: TrafficCamera, event: 'image-refresh' | 'image-error' | 'stream-error') => {
    const id = getCameraId(camera);
    setHealthByCamera((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...(event === 'image-refresh' ? { lastImageRefresh: Date.now(), lastImageError: undefined } : {}),
        ...(event === 'image-error' ? { lastImageError: Date.now() } : {}),
        ...(event === 'stream-error' ? { lastStreamError: Date.now() } : {}),
      },
    }));
  }, []);

  function toggleCollection(id: CollectionId) {
    setActiveCollections((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  useEffect(() => {
    if (!hasHydratedUrlCamera) return;
    const params = new URLSearchParams(window.location.search);
    searchQuery ? params.set('q', searchQuery) : params.delete('q');
    activeCollections.length ? params.set('collections', activeCollections.join(',')) : params.delete('collections');
    collectionMode !== 'all' ? params.set('filterMode', collectionMode) : params.delete('filterMode');
    focusedCamera ? params.set('camera', getCameraId(focusedCamera)) : params.delete('camera');
    view !== 'grid' ? params.set('view', view) : params.delete('view');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [activeCollections, collectionMode, focusedCamera, hasHydratedUrlCamera, searchQuery, view]);

  function applyArcGISUrl() {
    const nextUrl = pendingUrl.trim();

    try {
      const parsedUrl = new URL(nextUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.pathname.toLowerCase().includes('featureserver')) {
        throw new Error('ArcGIS URL must use http(s) and include a FeatureServer endpoint.');
      }
    } catch {
      setArcgisUrlError('Enter a valid ArcGIS FeatureServer endpoint before switching sources.');
      return;
    }

    setArcgisUrlError('');
    setArcgisUrl(nextUrl);
    setSource('arcgis');
    setShowSettings(false);
  }

  function restoreDefaultArcGISUrl() {
    setPendingUrl(ARCGIS_FEATURE_SERVICE_URL);
    setArcgisUrlError('');
  }

  useEffect(() => {
    if (!cameras?.length || focusedCamera || hasHydratedUrlCamera) return;
    const params = new URLSearchParams(window.location.search);
    const cameraId = params.get('camera');
    const camera = cameras.find((item) => getCameraId(item) === cameraId);
    if (camera) setFocusedCamera(camera);
    setHasHydratedUrlCamera(true);
  }, [cameras, focusedCamera, hasHydratedUrlCamera]);

  useEffect(() => {
    if (cameras?.length) setLastSuccessfulSync(Date.now());
  }, [cameras]);

  return (
    <ErrorBoundary>
      <div className="app-shell min-h-screen text-slate-100 selection:bg-cyan-400/25">
        <header className="sticky top-0 z-30 border-b border-slate-300/10 bg-slate-950/70 backdrop-blur-xl">
          <div className="mx-auto max-w-7xl px-4 py-3">
            <div className="md:hidden">
              <div className="mobile-hero-panel rounded-3xl p-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/50 bg-cyan-300/10 text-cyan-300 shadow-[0_0_20px_rgba(41,216,255,0.4)]">
                    <Video className="h-5 w-5" />
                    <span className="pointer-events-none absolute -inset-0.5 rounded-xl border border-cyan-200/20" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h1 className="font-display truncate text-sm font-semibold tracking-[0.08em] text-slate-100">
                      Seattle Traffic Watch
                    </h1>
                    <p className="truncate text-[11px] uppercase tracking-[0.12em] text-cyan-100/80">
                      Live traffic cameras · optimized for rapid scanning
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSettings((s) => !s)}
                    className={`rounded-xl border p-2 transition ${showSettings ? 'border-cyan-300/55 bg-cyan-400/10 text-cyan-200 shadow-[0_0_12px_rgba(41,216,255,0.25)]' : 'border-slate-400/20 bg-slate-900/70 text-slate-400 hover:text-slate-200'}`}
                    title="Data source settings"
                    aria-label="Toggle data source settings"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-cyan-300/25 bg-slate-950/45 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-300">Cameras</p>
                    <p className="mt-1 text-lg font-semibold text-cyan-200">{cameras?.length ?? '--'}</p>
                  </div>
                  <div className="rounded-2xl border border-cyan-300/25 bg-slate-950/45 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-300">Live streams</p>
                    <p className="mt-1 text-lg font-semibold text-cyan-200">{withVideo}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-400/20 bg-slate-950/55 p-2">
                  <Search className="h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    aria-label="Search cameras"
                    placeholder="Search by corridor, intersection, or URL"
                    className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-400 focus:outline-none"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="rounded-lg border border-slate-300/20 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-slate-200"
                      aria-label="Clear camera search"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="hidden flex-wrap items-center gap-3 md:flex">
              <div className="mr-auto flex min-w-64 items-center gap-3 rounded-2xl border border-slate-400/20 bg-slate-900/55 px-3 py-2 shadow-[inset_0_1px_0_rgba(148,163,184,0.15)]">
                <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-300/10 text-cyan-300 shadow-[0_0_18px_rgba(41,216,255,0.35)]">
                  <Video className="h-5 w-5" />
                  <span className="pointer-events-none absolute -inset-0.5 rounded-xl border border-cyan-200/20" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-display truncate text-[0.95rem] font-semibold tracking-[0.08em] text-slate-100">
                    Seattle Traffic Watch
                  </h1>
                  <p className="truncate text-[11px] uppercase tracking-[0.14em] text-slate-300">
                    {source === 'arcgis' ? 'ArcGIS feed | SDOT cameras' : 'Socrata feed | SDOT data'}
                  </p>
                </div>
              </div>

              {cameras && (
                <div className="hidden items-center gap-2 xl:flex">
                  <span className="hud-pill">{cameras.length} cameras online</span>
                  {withVideo > 0 && <span className="hud-pill hud-pill--accent">{withVideo} live streams</span>}
                  {lastSuccessfulSync && (
                    <span className="hud-pill">
                      <Clock3 className="mr-1 inline h-3 w-3" />
                      synced {new Date(lastSuccessfulSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  <button
                    onClick={() => setShowDiagnostics((open) => !open)}
                    className="hud-pill transition hover:border-cyan-300/45 hover:text-cyan-100"
                    aria-expanded={showDiagnostics}
                  >
                    {issueCount} signal issues
                  </button>
                </div>
              )}

              <div className="relative order-last w-full sm:order-none sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  aria-label="Search cameras"
                  placeholder="Search intersection, corridor, URL, or coordinate"
                  className="w-full rounded-xl border border-slate-400/20 bg-slate-900/70 py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-400 focus:border-cyan-300/55 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="flex items-center rounded-xl border border-slate-400/20 bg-slate-900/70 p-1">
                <button
                  onClick={() => setView('grid')}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition ${view === 'grid' ? 'border border-cyan-300/45 bg-cyan-400/10 text-cyan-200 shadow-[0_0_12px_rgba(41,216,255,0.25)]' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Grid
                </button>
                <button
                  onClick={() => setView('map')}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition ${view === 'map' ? 'border border-cyan-300/45 bg-cyan-400/10 text-cyan-200 shadow-[0_0_12px_rgba(41,216,255,0.25)]' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <Map className="h-3.5 w-3.5" />
                  Map
                </button>
              </div>

              <button
                onClick={() => setShowSettings((s) => !s)}
                className={`rounded-xl border p-2 transition ${showSettings ? 'border-cyan-300/55 bg-cyan-400/10 text-cyan-200 shadow-[0_0_12px_rgba(41,216,255,0.25)]' : 'border-slate-400/20 bg-slate-900/70 text-slate-400 hover:text-slate-200'}`}
                title="Data source settings"
                aria-label="Toggle data source settings"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>

            {showSettings && (
              <div className="mt-3 rounded-3xl border border-cyan-300/20 bg-slate-900/75 p-4 shadow-[0_24px_48px_rgba(2,6,23,0.55)] backdrop-blur-md">
                <p className="mb-3 font-display text-[11px] uppercase tracking-[0.2em] text-cyan-200">
                  Data Source Console
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      setSource('sdot');
                      setArcgisUrlError('');
                      setShowSettings(false);
                    }}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${source === 'sdot' ? 'border-cyan-300/55 bg-cyan-500/10 text-cyan-200' : 'border-slate-400/20 bg-slate-900/80 text-slate-300 hover:border-slate-300/35'}`}
                  >
                    <Database className="h-3.5 w-3.5" />
                    Use SDOT Socrata
                  </button>

                  <div className="flex min-w-72 flex-1 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                    <label className="sr-only" htmlFor="arcgis-url">ArcGIS Feature Service URL</label>
                    <div className="flex-1">
                      <input
                        id="arcgis-url"
                        type="url"
                        value={pendingUrl}
                        onChange={(e) => {
                          setPendingUrl(e.target.value);
                          if (arcgisUrlError) setArcgisUrlError('');
                        }}
                        placeholder="ArcGIS Feature Service URL..."
                        aria-invalid={Boolean(arcgisUrlError)}
                        aria-describedby={arcgisUrlError ? 'arcgis-url-error' : 'arcgis-url-help'}
                        className="w-full rounded-xl border border-slate-400/20 bg-slate-950/75 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-400 focus:border-cyan-300/55 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                      />
                    </div>
                    <button
                      onClick={applyArcGISUrl}
                      className="rounded-xl border border-cyan-300/55 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/20"
                    >
                      Use ArcGIS
                    </button>
                    <button
                      onClick={restoreDefaultArcGISUrl}
                      className="rounded-xl border border-slate-300/20 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-200/35"
                    >
                      Restore default
                    </button>
                  </div>
                </div>
                {arcgisUrlError && (
                  <p id="arcgis-url-error" className="mt-2 text-xs text-rose-200">
                    {arcgisUrlError}
                  </p>
                )}
                <p id="arcgis-url-help" className="mt-2 text-xs text-slate-300">
                  Current source: {source === 'arcgis' ? 'ArcGIS FeatureServer' : 'SDOT Socrata'}. Paste a Seattle GIS FeatureServer endpoint or restore the default.
                </p>
              </div>
            )}
          </div>
        </header>

        {error && cameras && (
          <div className="mx-auto mt-3 max-w-7xl px-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <span>Showing last loaded camera data because the latest refresh failed.</span>
              <button onClick={() => mutate()} className="rounded-xl border border-amber-200/35 px-3 py-1.5 text-xs font-semibold transition hover:bg-amber-400/10">
                Retry refresh
              </button>
            </div>
          </div>
        )}

        <section className="mx-auto max-w-7xl px-4 pt-4">
          <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Camera collections">
            {cameraCollections.map((collection) => {
              const active = activeCollections.includes(collection.id);
              return (
                <button
                  key={collection.id}
                  onClick={() => toggleCollection(collection.id)}
                  title={collection.description}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] transition ${active ? 'border-cyan-300/55 bg-cyan-400/15 text-cyan-100' : 'border-slate-400/20 bg-slate-900/55 text-slate-400 hover:border-slate-300/35 hover:text-slate-200'}`}
                  aria-pressed={active}
                >
                  {collection.label}
                  <span className="ml-1.5 rounded-full bg-slate-950/60 px-1.5 text-[10px] text-slate-200">
                    {(cameras ?? []).filter((camera) => collection.matches(camera, healthByCamera[getCameraId(camera)])).length}
                  </span>
                </button>
              );
            })}
            {activeCollections.length > 0 && (
              <button onClick={() => setActiveCollections([])} className="shrink-0 rounded-full border border-slate-400/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-slate-300 transition hover:text-slate-100">
                Clear all
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 text-xs text-slate-300">
            <p>
              Filters match {collectionMode === 'all' ? 'all selected collections' : 'any selected collection'}. Use clear all to return to every camera.
            </p>
            <div className="flex rounded-xl border border-slate-400/20 bg-slate-900/60 p-1" aria-label="Filter match mode">
              <button
                onClick={() => setCollectionMode('all')}
                className={`rounded-lg px-2 py-1 transition ${collectionMode === 'all' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-300 hover:text-slate-100'}`}
                aria-pressed={collectionMode === 'all'}
              >
                Match all
              </button>
              <button
                onClick={() => setCollectionMode('any')}
                className={`rounded-lg px-2 py-1 transition ${collectionMode === 'any' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-300 hover:text-slate-100'}`}
                aria-pressed={collectionMode === 'any'}
              >
                Match any
              </button>
            </div>
          </div>
          {showDiagnostics && (
            <div className="mb-4 grid gap-3 rounded-2xl border border-cyan-300/20 bg-slate-900/75 p-4 text-xs text-slate-300 sm:grid-cols-4">
              <div><p className="text-slate-500">Total cameras</p><p className="mt-1 text-lg text-cyan-100">{cameras?.length ?? '--'}</p></div>
              <div><p className="text-slate-500">Live streams</p><p className="mt-1 text-lg text-cyan-100">{withVideo}</p></div>
              <div><p className="text-slate-500">Signal issues</p><p className="mt-1 text-lg text-rose-200">{issueCount}</p></div>
              <div className="flex flex-col gap-2">
                <p className="text-slate-500">Last successful sync</p>
                <p className="text-sm text-cyan-100">{lastSuccessfulSync ? new Date(lastSuccessfulSync).toLocaleTimeString() : '--'}</p>
              </div>
              <button onClick={() => mutate()} className="rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-cyan-100 transition hover:bg-cyan-500/20 sm:col-span-4">Refresh feed</button>
            </div>
          )}
        </section>

        {isLoading ? (
          <div className={view === 'map' ? 'p-0' : 'mx-auto max-w-7xl px-4 py-8'}>
            {view === 'map' ? (
              <div className="flex h-[calc(100vh-84px)] items-center justify-center">
                <div className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 px-4 py-3 text-xs uppercase tracking-[0.2em] text-cyan-200/80 shadow-[0_0_24px_rgba(41,216,255,0.18)]">
                  Loading camera telemetry...
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="skeleton-panel aspect-video rounded-2xl border border-slate-400/10"
                  />
                ))}
              </div>
            )}
          </div>
        ) : error && !cameras ? (
          <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
            <div className="glass-panel-strong rounded-3xl px-8 py-9">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-300/40 bg-rose-500/15 text-rose-300">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h2 className="font-display text-lg tracking-[0.08em] text-slate-100">
                Couldn’t load cameras
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                {source === 'arcgis'
                  ? 'ArcGIS source did not respond. Verify endpoint in Data Source Console.'
                  : 'SDOT source did not respond. Check connectivity and retry.'}
              </p>
              <button
                onClick={() => mutate()}
                className="mt-5 rounded-xl border border-cyan-300/50 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/20"
              >
                Retry
              </button>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setSource(source === 'arcgis' ? 'sdot' : 'arcgis')}
                  className="rounded-xl border border-slate-300/25 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-200/40"
                >
                  Try {source === 'arcgis' ? 'SDOT Socrata' : 'ArcGIS'} source
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="rounded-xl border border-slate-300/25 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-200/40"
                >
                  Open source settings
                </button>
              </div>
            </div>
          </div>
        ) : view === 'map' ? (
          <MapView cameras={filteredCameras} healthByCamera={healthByCamera} onFocus={setFocusedCamera} />
        ) : (
          <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 md:py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-400/15 bg-slate-900/55 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                Visible cameras
                <span className="ml-2 text-cyan-200">{filteredCameras?.length}</span>
                <span className="mx-1 text-slate-500">/</span>
                <span className="text-slate-300">{cameras?.length}</span>
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="flex items-center gap-1 rounded-lg border border-slate-400/20 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-slate-300 transition hover:border-slate-300/35 hover:text-slate-100"
                >
                  <X className="h-3 w-3" />
                  Clear filter
                </button>
              )}
            </div>

            {filteredCameras?.length === 0 ? (
              <div className="glass-panel mx-auto max-w-xl rounded-3xl px-6 py-16 text-center">
                <p className="font-display text-sm uppercase tracking-[0.16em] text-slate-200">
                  No cameras match {searchQuery ? `"${searchQuery}"` : 'the selected filters'}
                </p>
                {activeCollections.length > 0 && (
                  <p className="mt-3 text-sm text-slate-300">
                    Active filters: {activeCollections.join(', ')}
                  </p>
                )}
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-4 rounded-xl border border-cyan-300/45 bg-cyan-500/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20"
                >
                  Reset query
                </button>
                {activeCollections.length > 0 && (
                  <button
                    onClick={() => setActiveCollections([])}
                    className="ml-2 mt-4 rounded-xl border border-slate-300/25 px-3 py-2 text-xs uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-200/40"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredCameras?.map((camera) => (
                  <CameraCard key={camera.imageurl.url} camera={camera} searchQuery={deferredQuery} onFocus={setFocusedCamera} onHealthChange={handleHealthChange} />
                ))}
              </div>
            )}
          </main>
        )}

        {focusedCamera && (
          <FocusCameraModal
            camera={focusedCamera}
            cameras={filteredCameras.length ? filteredCameras : cameras ?? []}
            onClose={() => setFocusedCamera(null)}
            onSelect={setFocusedCamera}
          />
        )}

        <nav className="mobile-command-dock fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 items-center gap-2 rounded-2xl border border-cyan-200/20 bg-slate-950/85 p-2 shadow-[0_18px_35px_rgba(2,8,20,0.7)] backdrop-blur-xl md:hidden">
          <button
            onClick={() => setView('grid')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs ${view === 'grid' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-400'}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Grid
          </button>
          <button
            onClick={() => setView('map')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs ${view === 'map' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-400'}`}
          >
            <Map className="h-3.5 w-3.5" />
            Map
          </button>
          <button
            onClick={() => setSource((current) => (current === 'arcgis' ? 'sdot' : 'arcgis'))}
            className="flex min-w-20 items-center justify-center gap-1.5 rounded-xl border border-slate-400/25 px-3 py-2 text-[11px] text-slate-200"
            aria-label={`Switch data source from ${source === 'arcgis' ? 'ArcGIS' : 'SDOT Socrata'}`}
          >
            {source === 'arcgis' ? <Satellite className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
            Source
          </button>
        </nav>
      </div>
    </ErrorBoundary>
  );
}
