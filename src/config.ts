// App configuration
// Cloudflare Worker proxy URL for video streams
export const VIDEO_PROXY_URL = 'https://seattle-video-proxy.aged-morning-c8e4.workers.dev';

// Video stream server (Wowza Streaming Engine)
export const VIDEO_SERVER = '61e0c5d388c2e.streamlock.net';

/**
 * Get video URL with CORS proxy
 * SDOT uses Wowza: https://61e0c5d388c2e.streamlock.net/live/STREAM_NAME.stream/playlist.m3u8
 */
export function getVideoUrl(streamPath: string): string {
  // streamPath like: /live/STREAM_NAME.stream/playlist.m3u8
  const proxyBase = VIDEO_PROXY_URL.replace(/\/$/, '');
  return `${proxyBase}?url=${encodeURIComponent(streamPath)}`;
}
