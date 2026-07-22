import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, ExternalLink, RefreshCw, Video, X } from 'lucide-react';
import { TrafficCamera } from '../types';
import { getCameraCoordinates, getCameraId, getNearbyCameras } from '../lib/cameras';

interface FocusCameraModalProps {
  camera: TrafficCamera;
  cameras: TrafficCamera[];
  onClose: () => void;
  onSelect: (camera: TrafficCamera) => void;
}

export function FocusCameraModal({ camera, cameras, onClose, onSelect }: FocusCameraModalProps) {
  const [timestamp, setTimestamp] = useState(Date.now());
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const coords = getCameraCoordinates(camera);
  const nearby = getNearbyCameras(camera, cameras);
  const currentIndex = cameras.findIndex((candidate) => getCameraId(candidate) === getCameraId(camera));

  function selectAdjacentCamera(direction: -1 | 1) {
    if (currentIndex === -1 || cameras.length === 0) return;
    const next = cameras[(currentIndex + direction + cameras.length) % cameras.length];
    if (next) onSelect(next);
  }

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') selectAdjacentCamera(-1);
      if (event.key === 'ArrowRight') selectAdjacentCamera(1);
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusable.length === 0) return;

      const first = focusable[0] as HTMLElement | undefined;
      const last = focusable[focusable.length - 1] as HTMLElement | undefined;

      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [camera, currentIndex, cameras, onClose, onSelect]);

  async function copyBriefingLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('camera', getCameraId(camera));

    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }

    window.setTimeout(() => setCopyStatus('idle'), 1600);
  }

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/82 p-3 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogTitleId}
    >
      <section className="glass-panel-strong max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-3xl">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-300/15 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p id={dialogTitleId} className="font-display truncate text-sm uppercase tracking-[0.12em] text-cyan-100">{camera.cameralabel}</p>
            <p className="mt-1 text-xs text-slate-300">
              {coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'Coordinates unavailable'} · Focus mode
            </p>
          </div>
          <button onClick={() => selectAdjacentCamera(-1)} className="rounded-xl border border-slate-300/20 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-300/45 hover:text-cyan-200" aria-label="Previous camera">
            <ChevronLeft className="mr-1 inline h-4 w-4" />Prev
          </button>
          <button onClick={() => selectAdjacentCamera(1)} className="rounded-xl border border-slate-300/20 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-300/45 hover:text-cyan-200" aria-label="Next camera">
            Next<ChevronRight className="ml-1 inline h-4 w-4" />
          </button>
          <button onClick={() => setTimestamp(Date.now())} className="rounded-xl border border-slate-300/20 p-2 text-slate-300 transition hover:border-cyan-300/45 hover:text-cyan-200" aria-label="Refresh snapshot">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={copyBriefingLink} className="rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 transition hover:bg-cyan-500/20">
            <Copy className="mr-1.5 inline h-3.5 w-3.5" />{copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy briefing'}
          </button>
          <button ref={closeButtonRef} onClick={onClose} className="rounded-xl border border-slate-300/20 p-2 text-slate-300 transition hover:border-slate-200/35 hover:text-slate-100" aria-label="Close focus mode">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-0 lg:grid-cols-[1fr_18rem]">
          <div className="bg-slate-950">
            <img src={`${camera.imageurl.url}?t=${timestamp}`} alt={camera.cameralabel} className="max-h-[70vh] min-h-72 w-full object-contain" />
          </div>
          <aside className="space-y-4 border-t border-slate-300/15 p-4 lg:border-l lg:border-t-0">
            <div className="rounded-2xl border border-slate-300/15 bg-slate-950/45 p-3">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-300">Snapshot history</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-200">
                {[
                  { label: 'Now', offset: 0 },
                  { label: '30s', offset: 30_000 },
                  { label: '2m', offset: 120_000 },
                ].map(({ label, offset }) => (
                  <button key={label} onClick={() => setTimestamp(Date.now() - offset)} className="rounded-lg border border-slate-300/15 px-2 py-1.5 hover:border-cyan-300/35">{label}</button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">History re-requests camera snapshots and may depend on upstream caching.</p>
            </div>

            <div className="space-y-2">
              {camera.video_url?.url && (
                <a href={camera.video_url.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 transition hover:bg-cyan-500/20" aria-label={`Open live stream for ${camera.cameralabel}`}>
                  <Video className="h-4 w-4" /> Open live stream
                </a>
              )}
              {camera.web_url?.url && (
                <a href={camera.web_url.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-slate-300/20 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-200/35" aria-label={`Open SDOT source page for ${camera.cameralabel}`}>
                  <ExternalLink className="h-4 w-4" /> SDOT source
                </a>
              )}
            </div>

            {nearby.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-slate-300">Nearby cameras</p>
                <div className="space-y-2">
                  {nearby.map((item) => (
                    <button key={getCameraId(item)} onClick={() => onSelect(item)} className="w-full rounded-xl border border-slate-300/15 bg-slate-950/35 px-3 py-2 text-left text-xs text-slate-300 transition hover:border-cyan-300/35 hover:text-cyan-100">
                      {item.cameralabel}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
