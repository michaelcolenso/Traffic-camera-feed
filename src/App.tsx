import { useState, useDeferredValue } from 'react';
import useSWR from 'swr';
import { fetchCameras } from './services/api';
import { CameraCard } from './components/CameraCard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Search, Video, AlertTriangle } from 'lucide-react';

export default function App() {
  const { data: cameras, error, isLoading } = useSWR('cameras', fetchCameras, {
    refreshInterval: 60000 * 5, // Refresh list every 5 minutes
    revalidateOnFocus: false,
  });

  const [searchQuery, setSearchQuery] = useState('');
  // Defer filtering so typing stays responsive even with large lists
  const deferredQuery = useDeferredValue(searchQuery);

  const filteredCameras = cameras?.filter((camera) =>
    camera.cameralabel.toLowerCase().includes(deferredQuery.toLowerCase()) &&
    camera.imageurl?.url && // Ensure image URL exists
    camera.video_url?.url   // Ensure video URL exists
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                <Video className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white">Seattle Traffic Watch</h1>
                <p className="text-xs text-zinc-500 font-mono">LIVE VIDEO FEEDS • SDOT DATA</p>
              </div>
            </div>

            <div className="relative w-full sm:w-72">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Search className="h-4 w-4 text-zinc-500" aria-hidden="true" />
              </div>
              <input
                type="text"
                aria-label="Search cameras by street name"
                placeholder="Search streets..."
                className="w-full rounded-lg border border-white/10 bg-zinc-900 py-2 pl-10 pr-4 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="mx-auto max-w-7xl px-4 py-8">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="aspect-video animate-pulse rounded-xl bg-zinc-900/50 border border-white/5" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 rounded-full bg-red-500/10 p-4 text-red-500">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <h2 className="text-lg font-semibold text-white">Failed to load cameras</h2>
              <p className="text-sm text-zinc-500">Please check your connection and try again.</p>
            </div>
          ) : (
            <>
              <div className="mb-6 flex items-center justify-between">
                <p className="text-sm text-zinc-500">
                  Showing <span className="font-medium text-zinc-300">{filteredCameras?.length}</span> cameras
                </p>
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
                    // imageurl.url is a stable, unique identifier per camera
                    <CameraCard key={camera.imageurl.url} camera={camera} />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}
