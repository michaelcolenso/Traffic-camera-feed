// App configuration
// Video is proxied through the same Cloudflare Worker that serves the SPA.
export const VIDEO_PROXY_URL = '/api/video';

// Video stream server (Wowza Streaming Engine)
export const VIDEO_SERVER = '61e0c5d388c2e.streamlock.net';

/**
 * Get a same-origin video URL through the Cloudflare Worker proxy.
 * SDOT uses Wowza: https://61e0c5d388c2e.streamlock.net/live/STREAM_NAME.stream/playlist.m3u8
 */
export function getVideoUrl(streamPath: string): string {
  return `${VIDEO_PROXY_URL}?url=${encodeURIComponent(streamPath)}`;
}
