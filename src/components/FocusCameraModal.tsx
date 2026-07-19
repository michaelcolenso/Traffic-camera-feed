import { useEffect, useState } from 'react';
import { Copy, ExternalLink, RefreshCw, Video, X } from 'lucide-react';
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
  const coords = getCameraCoordinates(camera);
  const nearby = getNearbyCameras(camera, cameras);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const currentIndex = cameras.findIndex((candidate) => getCameraId(candidate) === getCameraId(camera));
      if (currentIndex === -1) return;
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = cameras[(currentIndex + direction + cameras.length) % cameras.length];
      if (next) onSelect(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [camera, cameras, onClose, onSelect]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/82 p-3 backdrop-blur-md" role="dialog" aria-modal="true">
      <section className="glass-panel-strong max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-3xl">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-300/15 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-sm uppercase tracking-[0.14em] text-cyan-100">{camera.cameralabel}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">
              {coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'Coordinates unavailable'} · Focus mode
            </p>
          </div>
          <button onClick={() => setTimestamp(Date.now())} className="rounded-xl border border-slate-300/20 p-2 text-slate-300 transition hover:border-cyan-300/45 hover:text-cyan-200" aria-label="Refresh snapshot">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={copyBriefingLink} className="rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 transition hover:bg-cyan-500/20">
            <Copy className="mr-1.5 inline h-3.5 w-3.5" />{copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy briefing'}
          </button>
          <button onClick={onClose} className="rounded-xl border border-slate-300/20 p-2 text-slate-400 transition hover:border-slate-200/35 hover:text-slate-100" aria-label="Close focus mode">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-0 lg:grid-cols-[1fr_18rem]">
          <div className="bg-slate-950">
            <img src={`${camera.imageurl.url}?t=${timestamp}`} alt={camera.cameralabel} className="max-h-[70vh] min-h-72 w-full object-contain" />
          </div>
          <aside className="space-y-4 border-t border-slate-300/15 p-4 lg:border-l lg:border-t-0">
            <div className="rounded-2xl border border-slate-300/15 bg-slate-950/45 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Snapshot history</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-slate-300">
                {['Now', '30s', '2m'].map((label, index) => (
                  <button key={label} onClick={() => setTimestamp(Date.now() - index * 30_000)} className="rounded-lg border border-slate-300/15 px-2 py-1.5 hover:border-cyan-300/35">{label}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {camera.video_url?.url && (
                <a href={camera.video_url.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 transition hover:bg-cyan-500/20">
                  <Video className="h-4 w-4" /> Open live stream
                </a>
              )}
              {camera.web_url?.url && (
                <a href={camera.web_url.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-slate-300/20 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-200/35">
                  <ExternalLink className="h-4 w-4" /> SDOT source
                </a>
              )}
            </div>

            {nearby.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">Nearby cameras</p>
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
