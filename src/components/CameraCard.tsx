import React, { useState, useEffect, useRef } from 'react';
import { TrafficCamera } from '../types';
import { cn } from '../lib/utils';
import { MapPin, ExternalLink, RefreshCw, Video as VideoIcon, AlertTriangle } from 'lucide-react';

interface CameraCardProps {
  camera: TrafficCamera;
  refreshInterval?: number;
}

export const CameraCard: React.FC<CameraCardProps> = ({
  camera,
  refreshInterval = 30_000,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [timestamp, setTimestamp] = useState(Date.now());
  const [isImgLoading, setIsImgLoading] = useState(true);
  const [hasImgError, setHasImgError] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);

  // Intersection observer for lazy loading
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.1, rootMargin: '120px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-refresh image
  useEffect(() => {
    if (isVideoPlaying) return;
    const id = setInterval(() => {
      setTimestamp(Date.now());
      setIsImgLoading(true);
    }, refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval, isVideoPlaying]);

  // Pause video when out of view
  useEffect(() => {
    if (!isInView && isVideoPlaying) {
      setIsVideoPlaying(false);
    }
  }, [isInView, isVideoPlaying]);

  const imageUrl = `${camera.imageurl.url}?t=${timestamp}`;
  const videoUrl = camera.video_url?.url;

  // Check if browser supports HLS natively (Safari) or via HLS.js
  const canPlayHLS = () => {
    const video = document.createElement('video');
    return video.canPlayType('application/vnd.apple.mpegurl') !== '' || 
           typeof (window as any).Hls !== 'undefined';
  };

  return (
    <div
      ref={cardRef}
      className="group relative overflow-hidden rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-zinc-900/80"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <MapPin className="h-4 w-4 shrink-0 text-emerald-500" />
          <h3 className="truncate font-mono text-xs font-medium text-zinc-300" title={camera.cameralabel}>
            {camera.cameralabel}
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isImgLoading && !isVideoPlaying && (
            <RefreshCw className="h-3 w-3 animate-spin text-zinc-500" />
          )}
          {isVideoPlaying ? (
            <div className="flex items-center gap-1 rounded-full bg-red-500/20 px-1.5 py-0.5">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              <span className="text-[10px] font-medium text-red-400">LIVE</span>
            </div>
          ) : (
            <span className="font-mono text-[10px] text-zinc-600">
              {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Media */}
      <div className="relative aspect-video w-full bg-black">
        {isVideoPlaying && videoUrl && isInView ? (
          <NativeVideoPlayer 
            url={videoUrl} 
            poster={imageUrl}
            onError={() => {
              setVideoError(true);
              setIsVideoPlaying(false);
            }}
          />
        ) : hasImgError ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-600">
            <AlertTriangle className="h-7 w-7 opacity-40" />
            <span className="text-xs">Signal Lost</span>
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={camera.cameralabel}
            className={cn(
              'h-full w-full object-cover transition-opacity duration-500',
              isImgLoading ? 'opacity-60' : 'opacity-100',
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

        {/* Hover gradient */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

        {/* Action bar */}
        <div className="absolute bottom-0 left-0 right-0 flex translate-y-full items-center justify-between p-3 transition-transform group-hover:translate-y-0">
          <span className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 backdrop-blur-md">
            {parseFloat(camera.location.latitude).toFixed(4)},{' '}
            {parseFloat(camera.location.longitude).toFixed(4)}
          </span>
          <div className="flex gap-2">
            {videoUrl && !isVideoPlaying && (
              <button
                onClick={() => setIsVideoPlaying(true)}
                className="rounded-full bg-white/10 p-1.5 text-white hover:bg-emerald-500/60 backdrop-blur-md transition-colors"
                title="Play live stream"
              >
                <VideoIcon className="h-3 w-3" />
              </button>
            )}
            {isVideoPlaying && (
              <button
                onClick={() => setIsVideoPlaying(false)}
                className="rounded-full bg-red-500/20 p-1.5 text-red-400 hover:bg-red-500/40 backdrop-blur-md transition-colors"
                title="Stop stream"
              >
                <VideoIcon className="h-3 w-3" />
              </button>
            )}
            {camera.web_url?.url && (
              <a
                href={camera.web_url.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20 backdrop-blur-md transition-colors"
                title="Open on SDOT"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Native HLS video player (Safari supports natively, Chrome needs HLS.js)
function NativeVideoPlayer({ url, poster, onError }: { url: string; poster?: string; onError?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Check if native HLS is supported (Safari)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
    } else if (typeof (window as any).Hls !== 'undefined') {
      // Use HLS.js
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
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-600 bg-zinc-900">
        <AlertTriangle className="h-7 w-7 opacity-40" />
        <span className="text-xs">Stream Unavailable</span>
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
