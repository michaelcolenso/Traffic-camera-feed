import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, MapPin, RefreshCw, Video as VideoIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { TrafficCamera } from '../types';

interface CameraCardProps {
  camera: TrafficCamera;
  refreshInterval?: number;
}

export const CameraCard: React.FC<CameraCardProps> = ({ camera, refreshInterval = 30_000 }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [timestamp, setTimestamp] = useState(Date.now());
  const [isImgLoading, setIsImgLoading] = useState(true);
  const [hasImgError, setHasImgError] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(([entry]) => setIsInView(entry.isIntersecting), {
      threshold: 0.1,
      rootMargin: '120px',
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isVideoPlaying) return;
    const id = setInterval(() => {
      setTimestamp(Date.now());
      setIsImgLoading(true);
    }, refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval, isVideoPlaying]);

  useEffect(() => {
    if (!isInView && isVideoPlaying) {
      setIsVideoPlaying(false);
    }
  }, [isInView, isVideoPlaying]);

  const imageUrl = `${camera.imageurl.url}?t=${timestamp}`;
  const videoUrl = camera.video_url?.url;

  return (
    <article
      ref={cardRef}
      className="group relative overflow-hidden rounded-2xl border border-slate-300/15 bg-slate-900/60 shadow-[0_20px_36px_rgba(2,6,23,0.5)] transition-all duration-250 hover:border-cyan-300/40 hover:shadow-[0_24px_42px_rgba(6,182,212,0.18)]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/55 to-transparent opacity-70" />

      <header className="flex items-center justify-between border-b border-slate-300/10 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-cyan-300/35 bg-cyan-400/10 text-cyan-200">
            <MapPin className="h-3.5 w-3.5" />
          </span>
          <h3
            className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-slate-200"
            title={camera.cameralabel}
          >
            {camera.cameralabel}
          </h3>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {isImgLoading && !isVideoPlaying && (
            <RefreshCw className="h-3 w-3 animate-spin text-slate-500" aria-label="Refreshing image" />
          )}
          {isVideoPlaying ? (
            <div className="flex items-center gap-1 rounded-full border border-rose-300/35 bg-rose-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-rose-200">
              <span className="status-pulse inline-block h-1.5 w-1.5 rounded-full bg-rose-300" />
              Live
            </div>
          ) : (
            <span className="text-[10px] text-slate-500">
              {new Date(timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
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
            }}
          />
        ) : hasImgError ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-500">
            <AlertTriangle className="h-7 w-7 opacity-65" />
            <span className="text-xs uppercase tracking-[0.12em]">Signal lost</span>
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={camera.cameralabel}
            className={cn(
              'h-full w-full object-cover transition-opacity duration-500',
              isImgLoading ? 'opacity-65' : 'opacity-100',
            )}
            onLoad={() => {
              setIsImgLoading(false);
              setHasImgError(false);
            }}
            onError={() => {
              setIsImgLoading(false);
              setHasImgError(true);
            }}
            loading="lazy"
          />
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-900/10 to-transparent opacity-90" />

        <div className="absolute inset-x-0 bottom-0 flex translate-y-0 items-center justify-between gap-2 p-3 sm:translate-y-full sm:transition-transform sm:duration-200 sm:group-hover:translate-y-0">
          <span className="rounded-md border border-slate-300/20 bg-slate-950/70 px-1.5 py-1 text-[10px] text-slate-300 backdrop-blur">
            {parseFloat(camera.location.latitude).toFixed(4)}, {parseFloat(camera.location.longitude).toFixed(4)}
          </span>
          <div className="flex items-center gap-2">
            {videoUrl && !isVideoPlaying && (
              <button
                onClick={() => setIsVideoPlaying(true)}
                className="rounded-full border border-cyan-300/35 bg-cyan-500/15 p-1.5 text-cyan-200 transition hover:bg-cyan-500/25"
                title="Play live stream"
              >
                <VideoIcon className="h-3.5 w-3.5" />
              </button>
            )}
            {isVideoPlaying && (
              <button
                onClick={() => setIsVideoPlaying(false)}
                className="rounded-full border border-rose-300/40 bg-rose-500/20 p-1.5 text-rose-200 transition hover:bg-rose-500/35"
                title="Stop stream"
              >
                <VideoIcon className="h-3.5 w-3.5" />
              </button>
            )}
            {camera.web_url?.url && (
              <a
                href={camera.web_url.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-slate-300/25 bg-slate-950/70 p-1.5 text-slate-200 transition hover:border-slate-200/40"
                title="Open on SDOT"
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
  const [error, setError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
    } else if (typeof (window as any).Hls !== 'undefined') {
      const Hls = (window as any).Hls;
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (data.fatal) {
          setError(true);
          onError?.();
        }
      });
      return () => hls.destroy();
    } else {
      setError(true);
      onError?.();
    }
  }, [url, onError]);

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
    />
  );
}
