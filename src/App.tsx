import { useState, useDeferredValue } from 'react';
import useSWR from 'swr';
import { fetchCameras } from './services/api';
import { fetchArcGISCameras, ARCGIS_FEATURE_SERVICE_URL } from './services/arcgis';
import { CameraCard } from './components/CameraCard';
import { MapView } from './components/MapView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Search, Video, AlertTriangle, Map, LayoutGrid, Settings, X, Database } from 'lucide-react';
import { TrafficCamera } from './types';

type ViewMode = 'grid' | 'map';
type DataSource = 'sdot' | 'arcgis';

// Fetcher factories for SWR — key includes the source so caches are independent
function makeFetcher(source: DataSource, arcgisUrl: string) {
  return (_key: string): Promise<TrafficCamera[]> =>
    source === 'arcgis' ? fetchArcGISCameras(arcgisUrl) : fetchCameras();
}

export default function App() {
  const [view, setView] = useState<ViewMode>('grid');
  const [source, setSource] = useState<DataSource>('sdot');
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
      camera.cameralabel.toLowerCase().includes(deferredQuery.toLowerCase()) &&
      camera.imageurl?.url,
  );

  const withVideo = cameras?.filter((c) => c.video_url?.url).length ?? 0;

  function applyArcGISUrl() {
    setArcgisUrl(pendingUrl.trim());
    setSource('arcgis');
    setShowSettings(false);
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-20 border-b border-white/10 bg-zinc-950/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">

            {/* Logo */}
            <div className="flex items-center gap-3 mr-auto">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                <Video className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-white leading-none">
                  Seattle Traffic Watch
                </h1>
                <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                  {source === 'arcgis' ? 'ARCGIS • SDOT CAMERAS' : 'SOCRATA • SDOT DATA'}
                </p>
              </div>
            </div>

            {/* Stats pills */}
            {cameras && (
              <div className="hidden sm:flex items-center gap-2">
                <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs font-mono text-zinc-400">
                  {cameras.length} cameras
                </span>
                {withVideo > 0 && (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-mono text-emerald-400">
                    {withVideo} with video
                  </span>
                )}
              </div>
            )}

            {/* Search */}
            <div className="relative w-full sm:w-56 order-last sm:order-none">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Search className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
              </div>
              <input
                type="text"
                aria-label="Search cameras"
                placeholder="Search cameras…"
                className="w-full rounded-lg border border-white/10 bg-zinc-900 py-1.5 pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* View toggle */}
            <div className="flex rounded-lg border border-white/10 bg-zinc-900 p-0.5">
              <button
                onClick={() => setView('grid')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${view === 'grid' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Grid
              </button>
              <button
                onClick={() => setView('map')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${view === 'map' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <Map className="h-3.5 w-3.5" />
                Map
              </button>
            </div>

            {/* Settings */}
            <button
              onClick={() => setShowSettings((s) => !s)}
              className={`rounded-lg border border-white/10 p-2 transition-colors ${showSettings ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}
              title="Data source settings"
              aria-label="Toggle data source settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>

          {/* ── Settings panel ───────────────────────────────────────────── */}
          {showSettings && (
            <div className="border-t border-white/5 bg-zinc-900/60 backdrop-blur-sm px-4 py-4">
              <div className="mx-auto max-w-7xl">
                <p className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Data Source
                </p>
                <div className="flex flex-wrap gap-3">
                  {/* SDOT Socrata */}
                  <button
                    onClick={() => { setSource('sdot'); setShowSettings(false); }}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${source === 'sdot' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-white/10 text-zinc-400 hover:border-white/20'}`}
                  >
                    <Database className="h-3.5 w-3.5" />
                    SDOT Socrata API
                  </button>

                  {/* ArcGIS */}
                  <div className="flex flex-1 min-w-60 items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="url"
                        value={pendingUrl}
                        onChange={(e) => setPendingUrl(e.target.value)}
                        placeholder="ArcGIS Feature Service URL…"
                        className="w-full rounded-lg border border-white/10 bg-zinc-800 py-2 pl-3 pr-3 text-xs text-zinc-200 placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                      />
                    </div>
                    <button
                      onClick={applyArcGISUrl}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 transition-colors whitespace-nowrap"
                    >
                      Use ArcGIS
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-zinc-600 font-mono">
                  ArcGIS: paste the FeatureServer/0 endpoint URL from the Seattle City GIS hub
                </p>
              </div>
            </div>
          )}
        </header>

        {/* ── Content ────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className={view === 'map' ? 'p-0' : 'mx-auto max-w-7xl px-4 py-8'}>
            {view === 'map' ? (
              <div className="flex h-[calc(100vh-73px)] items-center justify-center bg-zinc-950">
                <div className="text-zinc-600 text-sm font-mono animate-pulse">Loading cameras…</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="aspect-video animate-pulse rounded-xl bg-zinc-900/50 border border-white/5" />
                ))}
              </div>
            )}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 text-center px-4">
            <div className="mb-4 rounded-full bg-red-500/10 p-4 text-red-500">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-semibold text-white">Failed to load cameras</h2>
            <p className="mt-1 text-sm text-zinc-500 max-w-sm">
              {source === 'arcgis'
                ? 'Could not reach the ArcGIS Feature Service. Check the URL in settings.'
                : 'Could not reach the SDOT API. Check your connection.'}
            </p>
            <button
              onClick={() => mutate()}
              className="mt-4 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : view === 'map' ? (
          <MapView cameras={cameras ?? []} />
        ) : (
          <main className="mx-auto max-w-7xl px-4 py-8">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-sm text-zinc-500">
                Showing{' '}
                <span className="font-medium text-zinc-300">{filteredCameras?.length}</span>
                {' '}of{' '}
                <span className="font-medium text-zinc-300">{cameras?.length}</span>{' '}
                cameras
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              )}
            </div>

            {filteredCameras?.length === 0 ? (
              <div className="py-20 text-center text-zinc-500">
                <p>No cameras found matching &ldquo;{searchQuery}&rdquo;</p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-3 text-sm text-emerald-500 hover:underline"
                >
                  Clear search
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
