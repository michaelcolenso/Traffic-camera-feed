import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, MapPin, RefreshCw, Video as VideoIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { TrafficCamera } from '../types';

interface CameraCardProps {
  camera: TrafficCamera;
  searchQuery?: string;
  refreshInterval?: number;
  priority?: boolean;
  onFocus?: (camera: TrafficCamera) => void;
  onHealthChange?: (camera: TrafficCamera, event: 'image-refresh' | 'image-error' | 'stream-error') => void;
}

export const CameraCard: React.FC<CameraCardProps> = ({ camera, searchQuery = '', refreshInterval = 30_000, priority = false, onFocus, onHealthChange }) => {
  const cardRef = useRef<HTMLElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(() => document.visibilityState === 'visible');
  const [timestamp, setTimestamp] = useState(Date.now());
  const [isImgLoading, setIsImgLoading] = useState(true);
  const [hasImgError, setHasImgError] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(([entry]) => setIsInView(entry.isIntersecting), {
      threshold: 0.05,
      rootMargin: '160px 0px',
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setIsPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!isInView || !isPageVisible || isVideoPlaying) return;

    const elapsed = Date.now() - timestamp;
    const remaining = Math.max(1_000, refreshInterval - elapsed);
    const jitter = Math.floor(Math.random() * Math.min(4_000, refreshInterval * 0.1));

    const id = window.setTimeout(() => {
      setTimestamp(Date.now());
      setIsImgLoading(true);
      setHasImgError(false);
    }, remaining + jitter);

    return () => window.clearTimeout(id);
  }, [isInView, isPageVisible, isVideoPlaying, refreshInterval, timestamp]);

  useEffect(() => {
    if (!isInView && isVideoPlaying) {
      setIsVideoPlaying(false);
    }
  }, [isInView, isVideoPlaying]);

  const imageUrl = `${camera.imageurl.url}?t=${timestamp}`;
  const videoUrl = camera.video_url?.url;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const labelIndex = normalizedQuery ? camera.cameralabel.toLowerCase().indexOf(normalizedQuery) : -1;
  const highlightedLabel = labelIndex >= 0 ? (
    <>
      {camera.cameralabel.slice(0, labelIndex)}
      <mark className="rounded bg-cyan-300/25 px-0.5 text-cyan-50">{camera.cameralabel.slice(labelIndex, labelIndex + normalizedQuery.length)}</mark>
      {camera.cameralabel.slice(labelIndex + normalizedQuery.length)}
    </>
  ) : camera.cameralabel;

  return (
    <article
      ref={cardRef}
      className="group relative overflow-hidden rounded-2xl border border-slate-300/15 bg-slate-900/60 shadow-[0_20px_36px_rgba(2,6,23,0.5)] transition-all duration-250 hover:border-cyan-300/40 hover:shadow-[0_24px_42px_rgba(6,182,212,0.18)]"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '280px' }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/55 to-transparent opacity-70" />

      <header className="flex items-center justify-between border-b border-slate-300/10 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-300/35 bg-cyan-400/10 text-cyan-200">
            <MapPin className="h-3.5 w-3.5" />
          </span>
          <h2
            className="truncate text-xs font-medium tracking-[0.04em] text-slate-100"
            title={camera.cameralabel}
          >
            {highlightedLabel}
          </h2>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {isImgLoading && !isVideoPlaying && isInView && (
            <RefreshCw className="h-3 w-3 animate-spin text-slate-500" aria-label="Refreshing image" />
          )}
          {isVideoPlaying ? (
            <div className="flex items-center gap-1 rounded-full border border-rose-300/35 bg-rose-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-rose-200">
              <span className="status-pulse inline-block h-1.5 w-1.5 rounded-full bg-rose-300" />
              Live
            </div>
          ) : (
            <span className="text-[11px] text-slate-300">
              {new Date(timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
      </header>

      <div className="relative aspect-video w-full bg-slate-950">
        {isVideoPlaying && videoUrl && isInView ? (
          <NativeVideoPlayer
            url={videoUrl}
            poster={imageUrl}
            onError={() => {
              setIsVideoPlaying(false);
              onHealthChange?.(camera, 'stream-error');
            }}
          />
        ) : hasImgError ? (
          <button
            type="button"
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400 transition hover:bg-slate-900/80 hover:text-slate-200"
            onClick={() => {
              setHasImgError(false);
              setIsImgLoading(true);
              setTimestamp(Date.now());
            }}
            aria-label={`Retry snapshot for ${camera.cameralabel}`}
          >
            <AlertTriangle className="h-7 w-7 opacity-65" />
            <span className="text-xs uppercase tracking-[0.12em]">Signal lost · tap to retry</span>
          </button>
        ) : (
          <img
            src={imageUrl}
            alt={camera.cameralabel}
            className={cn(
              'h-full w-full cursor-pointer object-cover transition-opacity duration-500',
              isImgLoading ? 'opacity-65' : 'opacity-100',
            )}
            onClick={() => onFocus?.(camera)}
            onLoad={() => {
              setIsImgLoading(false);
              setHasImgError(false);
              onHealthChange?.(camera, 'image-refresh');
            }}
            onError={() => {
              setIsImgLoading(false);
              setHasImgError(true);
              onHealthChange?.(camera, 'image-error');
            }}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'low'}
          />
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-900/10 to-transparent opacity-90" />

        <div className="absolute inset-x-0 bottom-0 flex translate-y-0 items-center justify-between gap-2 p-3 sm:translate-y-2 sm:opacity-90 sm:transition-all sm:duration-200 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100">
          <button
            onClick={() => onFocus?.(camera)}
            className="min-h-10 rounded-lg border border-cyan-300/35 bg-slate-950/80 px-3 py-2 text-xs font-medium text-cyan-100 backdrop-blur transition hover:bg-cyan-500/15 sm:min-h-0 sm:px-2 sm:py-1 sm:text-[11px]"
            aria-label={`View camera ${camera.cameralabel}`}
          >
            View camera
          </button>
          <span className="hidden rounded-md border border-slate-300/20 bg-slate-950/70 px-1.5 py-1 text-[11px] text-slate-200 backdrop-blur sm:inline">
            {parseFloat(camera.location.latitude).toFixed(4)}, {parseFloat(camera.location.longitude).toFixed(4)}
          </span>
          <div className="flex items-center gap-2">
            {videoUrl && !isVideoPlaying && (
              <button
                onClick={() => setIsVideoPlaying(true)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/35 bg-cyan-500/15 text-cyan-200 transition hover:bg-cyan-500/25 sm:h-auto sm:w-auto sm:p-1.5"
                title="Play live stream"
                aria-label={`Play live stream for ${camera.cameralabel}`}
              >
                <VideoIcon className="h-3.5 w-3.5" />
              </button>
            )}
            {isVideoPlaying && (
              <button
                onClick={() => setIsVideoPlaying(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-rose-300/40 bg-rose-500/20 text-rose-200 transition hover:bg-rose-500/35 sm:h-auto sm:w-auto sm:p-1.5"
                title="Stop live stream"
                aria-label={`Stop live stream for ${camera.cameralabel}`}
              >
                <VideoIcon className="h-3.5 w-3.5" />
              </button>
            )}
            {camera.web_url?.url && (
              <a
                href={camera.web_url.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300/25 bg-slate-950/70 text-slate-200 transition hover:border-slate-200/40 sm:h-auto sm:w-auto sm:p-1.5"
                title="Open SDOT page"
                aria-label={`Open SDOT page for ${camera.cameralabel}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};

function NativeVideoPlayer({
  url,
  poster,
  onError,
}: {
  url: string;
  poster?: string;
  onError?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onErrorRef = useRef(onError);
  const [error, setError] = useState(false);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(false);

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
      return () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
    }

    let hlsInstance: import('hls.js').default | null = null;
    let isDisposed = false;

    import('hls.js').then(
      ({ default: Hls }) => {
        if (isDisposed) return;
        if (!Hls.isSupported()) {
          setError(true);
          onErrorRef.current?.();
          return;
        }

        const hls = new Hls({ enableWorker: true });
        hlsInstance = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError(true);
            onErrorRef.current?.();
          }
        });
      },
      () => {
        if (!isDisposed) {
          setError(true);
          onErrorRef.current?.();
        }
      },
    );

    return () => {
      isDisposed = true;
      hlsInstance?.destroy();
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900 text-slate-500">
        <AlertTriangle className="h-7 w-7 opacity-60" />
        <span className="text-xs uppercase tracking-[0.12em]">Stream unavailable</span>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      className="h-full w-full object-cover"
      poster={poster}
      muted
      autoPlay
      playsInline
      controls
      preload="metadata"
    />
  );
}
