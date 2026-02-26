import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { cn } from '../lib/utils';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface VideoPlayerProps {
  url: string;
  className?: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  onError?: () => void;
  onLoad?: () => void;
}

export function VideoPlayer({
  url,
  className,
  poster,
  autoPlay = true,
  muted = true,
  onError,
  onLoad,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset state on URL change
    setIsLoading(true);
    setHasError(false);

    let hls: Hls | null = null;

    const handleCanPlay = () => {
      setIsLoading(false);
      onLoad?.();
      if (autoPlay) {
        video.play().catch((e) => {
          console.warn('Autoplay prevented:', e);
          // Don't treat autoplay failure as a stream error, just leave it paused
        });
      }
    };

    const handleError = (e: Event | string) => {
      console.error('Video error:', e);
      setHasError(true);
      setIsLoading(false);
      onError?.();
    };

    if (Hls.isSupported() && url.includes('.m3u8')) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        handleCanPlay();
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
              break;
            default:
              handleError(event);
              hls?.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || !url.includes('.m3u8')) {
      // Native HLS support (Safari) or standard video file
      video.src = url;
      video.addEventListener('loadedmetadata', handleCanPlay);
      video.addEventListener('error', handleError);
    } else {
      // Format not supported
      setHasError(true);
      setIsLoading(false);
      onError?.();
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
      if (video) {
        video.removeEventListener('loadedmetadata', handleCanPlay);
        video.removeEventListener('error', handleError);
        video.removeAttribute('src');
      }
    };
  }, [url, autoPlay, onError, onLoad]);

  return (
    <div className={cn("relative bg-black", className)}>
      <video
        ref={videoRef}
        className={cn(
          "h-full w-full object-cover",
          isLoading || hasError ? "opacity-0" : "opacity-100"
        )}
        poster={poster}
        muted={muted}
        playsInline
        loop
        controls
      />
      
      {isLoading && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-[1px]">
          <Loader2 className="h-8 w-8 animate-spin text-white/50" />
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 text-zinc-500">
          <AlertTriangle className="h-8 w-8 opacity-50" />
          <span className="text-xs">Stream Unavailable</span>
        </div>
      )}
    </div>
  );
}
