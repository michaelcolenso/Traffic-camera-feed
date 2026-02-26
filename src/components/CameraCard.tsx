import React, { useState, useEffect } from 'react';
import { TrafficCamera } from '../types';
import { cn } from '../lib/utils';
import { MapPin, ExternalLink, RefreshCw, Video as VideoIcon } from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';

interface CameraCardProps {
  camera: TrafficCamera;
  refreshInterval?: number; // in milliseconds
}

export const CameraCard: React.FC<CameraCardProps> = ({ camera, refreshInterval = 30000 }) => {
  const [timestamp, setTimestamp] = useState(Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(!!camera.video_url?.url);

  useEffect(() => {
    if (isVideoPlaying) return; // Don't refresh image if video is playing

    const interval = setInterval(() => {
      setTimestamp(Date.now());
      setIsLoading(true);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, isVideoPlaying]);

  const handleImageLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleImageError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const handleVideoError = () => {
    console.warn(`Video failed for ${camera.cameralabel}, falling back to image.`);
    setIsVideoPlaying(false);
    setIsLoading(true); // Reset loading state for image fallback
  };

  const handleVideoLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  // Construct URL with cache buster
  const imageUrl = `${camera.imageurl.url}?t=${timestamp}`;
  const videoUrl = camera.video_url?.url;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-zinc-900/80">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <MapPin className="h-4 w-4 text-emerald-500" />
          <h3 className="truncate font-mono text-xs font-medium text-zinc-300" title={camera.cameralabel}>
            {camera.cameralabel}
          </h3>
        </div>
        <div className="flex items-center gap-2">
           {isLoading && <RefreshCw className="h-3 w-3 animate-spin text-zinc-500" />}
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

      {/* Media Container */}
      <div className="relative aspect-video w-full bg-black">
        {hasError && !isVideoPlaying ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-500">
            <ExternalLink className="h-8 w-8 opacity-50" />
            <span className="text-xs">Signal Lost</span>
          </div>
        ) : isVideoPlaying && videoUrl ? (
          <VideoPlayer
            url={videoUrl}
            className="h-full w-full"
            poster={imageUrl}
            onLoad={handleVideoLoad}
            onError={handleVideoError}
          />
        ) : (
          <img
            src={imageUrl}
            alt={camera.cameralabel}
            className={cn(
              "h-full w-full object-cover transition-opacity duration-500",
              isLoading ? "opacity-80" : "opacity-100"
            )}
            onLoad={handleImageLoad}
            onError={handleImageError}
            loading="lazy"
          />
        )}
        
        {/* Overlay Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
        
        {/* Actions Overlay */}
        <div className="absolute bottom-0 left-0 right-0 flex translate-y-full items-center justify-between p-3 transition-transform group-hover:translate-y-0">
          <div className="flex gap-2">
            <span className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 backdrop-blur-md">
              {camera.x_coord}, {camera.y_coord}
            </span>
          </div>
          <div className="flex gap-2">
            {videoUrl && !isVideoPlaying && (
              <button
                onClick={() => setIsVideoPlaying(true)}
                className="rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20 backdrop-blur-md"
                title="Switch to Video"
                aria-label={`Switch ${camera.cameralabel} to live video`}
              >
                <VideoIcon className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
            {camera.web_url && (
               <a
                 href={camera.web_url.url}
                 target="_blank"
                 rel="noopener noreferrer"
                 className="rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20 backdrop-blur-md"
                 title="Open in SDOT"
                 aria-label={`Open ${camera.cameralabel} on SDOT website`}
               >
                 <ExternalLink className="h-3 w-3" aria-hidden="true" />
               </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
