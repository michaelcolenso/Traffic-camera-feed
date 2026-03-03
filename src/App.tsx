import { useDeferredValue, useState } from 'react';
import useSWR from 'swr';
import { Search, Video, AlertTriangle, Map, LayoutGrid, Settings, X, Database } from 'lucide-react';
import { CameraCard } from './components/CameraCard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MapView } from './components/MapView';
import { fetchArcGISCameras, ARCGIS_FEATURE_SERVICE_URL } from './services/arcgis';
import { fetchCameras } from './services/api';
import { TrafficCamera } from './types';

type ViewMode = 'grid' | 'map';
type DataSource = 'sdot' | 'arcgis';

function makeFetcher(source: DataSource, arcgisUrl: string) {
  return (_key: string): Promise<TrafficCamera[]> =>
    source === 'arcgis' ? fetchArcGISCameras(arcgisUrl) : fetchCameras();
}

export default function App() {
  const [view, setView] = useState<ViewMode>('grid');
  const [source, setSource] = useState<DataSource>('arcgis');
  const [arcgisUrl, setArcgisUrl] = useState(ARCGIS_FEATURE_SERVICE_URL);
  const [pendingUrl, setPendingUrl] = useState(ARCGIS_FEATURE_SERVICE_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);

  const swrKey = `cameras-${source}-${arcgisUrl}`;
  const { data: cameras, error, isLoading, mutate } = useSWR(
    swrKey,
    makeFetcher(source, arcgisUrl),
    { refreshInterval: 5 * 60_000, revalidateOnFocus: false },
  );

  const filteredCameras = cameras?.filter(
    (camera) =>
      camera.cameralabel.toLowerCase().includes(deferredQuery.toLowerCase()) && camera.imageurl?.url,
  );

  const withVideo = cameras?.filter((c) => c.video_url?.url).length ?? 0;

  function applyArcGISUrl() {
    setArcgisUrl(pendingUrl.trim());
    setSource('arcgis');
    setShowSettings(false);
  }

  return (
    <ErrorBoundary>
      <div className="app-shell min-h-screen text-slate-100 selection:bg-cyan-400/25">
        <header className="sticky top-0 z-30 border-b border-slate-300/10 bg-slate-950/70 backdrop-blur-xl">
          <div className="mx-auto max-w-7xl px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="mr-auto flex min-w-64 items-center gap-3 rounded-2xl border border-slate-400/20 bg-slate-900/55 px-3 py-2 shadow-[inset_0_1px_0_rgba(148,163,184,0.15)]">
                <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-300/10 text-cyan-300 shadow-[0_0_18px_rgba(41,216,255,0.35)]">
                  <Video className="h-5 w-5" />
                  <span className="pointer-events-none absolute -inset-0.5 rounded-xl border border-cyan-200/20" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-display truncate text-[0.95rem] font-semibold tracking-[0.08em] text-slate-100">
                    Seattle Traffic Watch
                  </h1>
                  <p className="truncate text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    {source === 'arcgis' ? 'ArcGIS feed | SDOT cameras' : 'Socrata feed | SDOT data'}
                  </p>
                </div>
              </div>

              {cameras && (
                <div className="hidden items-center gap-2 xl:flex">
                  <span className="hud-pill">{cameras.length} cameras online</span>
                  {withVideo > 0 && <span className="hud-pill hud-pill--accent">{withVideo} live streams</span>}
                </div>
              )}

              <div className="relative order-last w-full sm:order-none sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  aria-label="Search cameras"
                  placeholder="Locate camera node..."
                  className="w-full rounded-xl border border-slate-400/20 bg-slate-900/70 py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-300/55 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
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
              <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-slate-900/75 p-4 shadow-[0_24px_48px_rgba(2,6,23,0.55)] backdrop-blur-md">
                <p className="mb-3 font-display text-[11px] uppercase tracking-[0.2em] text-cyan-200">
                  Data Source Console
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      setSource('sdot');
                      setShowSettings(false);
                    }}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${source === 'sdot' ? 'border-cyan-300/55 bg-cyan-500/10 text-cyan-200' : 'border-slate-400/20 bg-slate-900/80 text-slate-300 hover:border-slate-300/35'}`}
                  >
                    <Database className="h-3.5 w-3.5" />
                    SDOT Socrata API
                  </button>

                  <div className="flex min-w-72 flex-1 items-center gap-2">
                    <input
                      type="url"
                      value={pendingUrl}
                      onChange={(e) => setPendingUrl(e.target.value)}
                      placeholder="ArcGIS Feature Service URL..."
                      className="w-full rounded-xl border border-slate-400/20 bg-slate-950/75 py-2 px-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-300/55 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                    />
                    <button
                      onClick={applyArcGISUrl}
                      className="rounded-xl border border-cyan-300/55 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/20"
                    >
                      Use ArcGIS
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  Paste the FeatureServer/0 endpoint from Seattle City GIS hub.
                </p>
              </div>
            )}
          </div>
        </header>

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
        ) : error ? (
          <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
            <div className="glass-panel-strong rounded-3xl px-8 py-9">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-300/40 bg-rose-500/15 text-rose-300">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h2 className="font-display text-lg tracking-[0.08em] text-slate-100">
                Camera network unreachable
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
                Retry sync
              </button>
            </div>
          </div>
        ) : view === 'map' ? (
          <MapView cameras={cameras ?? []} />
        ) : (
          <main className="mx-auto max-w-7xl px-4 py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-400/15 bg-slate-900/55 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                Visible nodes
                <span className="ml-2 text-cyan-200">{filteredCameras?.length}</span>
                <span className="mx-1 text-slate-500">/</span>
                <span className="text-slate-300">{cameras?.length}</span>
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="flex items-center gap-1 rounded-lg border border-slate-400/20 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-slate-400 transition hover:border-slate-300/35 hover:text-slate-200"
                >
                  <X className="h-3 w-3" />
                  Clear filter
                </button>
              )}
            </div>

            {filteredCameras?.length === 0 ? (
              <div className="glass-panel mx-auto max-w-xl rounded-3xl px-6 py-16 text-center">
                <p className="font-display text-sm uppercase tracking-[0.16em] text-slate-200">
                  No camera nodes match "{searchQuery}"
                </p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-4 rounded-xl border border-cyan-300/45 bg-cyan-500/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20"
                >
                  Reset query
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredCameras?.map((camera) => (
                  <CameraCard key={camera.imageurl.url} camera={camera} />
                ))}
              </div>
            )}
          </main>
        )}
      </div>
    </ErrorBoundary>
  );
}
