import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import { TrafficCamera } from '../types';
import { cn } from '../lib/utils';

interface CameraModalProps {
  camera: TrafficCamera;
  cameras: TrafficCamera[]; // zone peers for L/R swipe navigation
  onClose: () => void;
}

export function CameraModal({ camera: initialCamera, cameras, onClose }: CameraModalProps) {
  const [currentIdx, setCurrentIdx] = useState(() => {
    const idx = cameras.findIndex((c) => c.imageurl.url === initialCamera.imageurl.url);
    return idx >= 0 ? idx : 0;
  });
  const camera = cameras[currentIdx] ?? initialCamera;

  const [imgSrc, setImgSrc] = useState(camera.imageurl.url);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  // Touch state for swipe gestures
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // Update image when camera changes
  useEffect(() => {
    setImgLoaded(false);
    setImgSrc(`${camera.imageurl.url}?t=${Date.now()}`);
    setLastRefresh(Date.now());
  }, [camera.imageurl.url]);

  // Auto-refresh image every 30s
  useEffect(() => {
    const iv = setInterval(() => {
      setImgSrc(`${camera.imageurl.url}?t=${Date.now()}`);
      setLastRefresh(Date.now());
    }, 30_000);
    return () => clearInterval(iv);
  }, [camera.imageurl.url]);

  // Lock body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goTo(currentIdx - 1);
      if (e.key === 'ArrowRight') goTo(currentIdx + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  function goTo(idx: number) {
    const clamped = Math.max(0, Math.min(cameras.length - 1, idx));
    if (clamped !== currentIdx) {
      setCurrentIdx(clamped);
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;

    // Swipe down to close (must be more vertical than horizontal)
    if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
      return;
    }
    // Swipe left/right to navigate
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goTo(currentIdx + 1);
      else goTo(currentIdx - 1);
    }
  }

  function manualRefresh() {
    setImgLoaded(false);
    setImgSrc(`${camera.imageurl.url}?t=${Date.now()}`);
    setLastRefresh(Date.now());
  }

  const elapsed = Math.round((Date.now() - lastRefresh) / 1000);

  return (
    <div
      className="modal-enter fixed inset-0 z-60 flex flex-col bg-slate-950"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="dialog"
      aria-modal
      aria-label={camera.cameralabel}
    >
      {/* Header */}
      <div className="relative flex items-center gap-3 border-b border-slate-300/10 bg-slate-950/80 px-3 py-3 backdrop-blur-sm">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-xl border border-slate-400/20 bg-slate-900/70 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-300/35 hover:text-slate-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>

        <div className="min-w-0 flex-1 text-center">
          <p className="font-display truncate text-[11px] uppercase tracking-[0.16em] text-slate-100">
            {camera.cameralabel}
          </p>
          <p className="text-[9px] uppercase tracking-[0.12em] text-slate-500">
            {cameras.length > 1 && `${currentIdx + 1} / ${cameras.length} · `}
            Updated {elapsed < 5 ? 'just now' : `${elapsed}s ago`}
          </p>
        </div>

        {camera.web_url?.url ? (
          <a
            href={camera.web_url.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-slate-400/20 bg-slate-900/70 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-300/35 hover:text-slate-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <button
            onClick={manualRefresh}
            className="flex items-center gap-1.5 rounded-xl border border-slate-400/20 bg-slate-900/70 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-300/35 hover:text-slate-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Image area */}
      <div className="relative flex flex-1 items-center justify-center bg-black">
        {!imgLoaded && (
          <div className="skeleton-panel absolute inset-0" />
        )}
        <img
          src={imgSrc}
          alt={camera.cameralabel}
          className={cn(
            'max-h-full max-w-full object-contain transition-opacity duration-300',
            imgLoaded ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgLoaded(true)}
        />

        {/* Prev / Next overlay buttons */}
        {cameras.length > 1 && (
          <>
            <button
              onClick={() => goTo(currentIdx - 1)}
              disabled={currentIdx === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-slate-400/20 bg-slate-950/70 p-2.5 text-slate-300 backdrop-blur-sm transition disabled:opacity-20 hover:border-slate-300/40 hover:text-slate-100"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => goTo(currentIdx + 1)}
              disabled={currentIdx === cameras.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-slate-400/20 bg-slate-950/70 p-2.5 text-slate-300 backdrop-blur-sm transition disabled:opacity-20 hover:border-slate-300/40 hover:text-slate-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Footer: dot indicators + coords */}
      <div className="border-t border-slate-300/10 bg-slate-950/80 px-4 py-3">
        {/* Dot indicators */}
        {cameras.length > 1 && cameras.length <= 20 && (
          <div className="mb-2 flex justify-center gap-1.5">
            {cameras.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-200',
                  i === currentIdx
                    ? 'w-4 bg-cyan-400'
                    : 'w-1.5 bg-slate-600 hover:bg-slate-400',
                )}
                aria-label={`Go to camera ${i + 1}`}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
            {camera.location?.latitude && camera.location?.longitude
              ? `${parseFloat(camera.location.latitude).toFixed(4)}°N · ${Math.abs(parseFloat(camera.location.longitude)).toFixed(4)}°W`
              : 'Coordinates unavailable'}
          </p>
          <button
            onClick={manualRefresh}
            className="flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-slate-500 transition hover:text-cyan-300"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
        {/* Swipe hint */}
        <p className="mt-1 text-center text-[9px] uppercase tracking-[0.12em] text-slate-600">
          Swipe left/right to browse · Swipe down to close
        </p>
      </div>
    </div>
  );
}
