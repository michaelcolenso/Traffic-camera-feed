// App configuration
// Set your Cloudflare Worker proxy URL here after deployment

// Example: 'https://seattle-traffic-video-proxy.YOUR_SUBDOMAIN.workers.dev'
export const VIDEO_PROXY_URL = '';

// Base URLs
export const VIDEO_SERVER = 'video.seattle.gov';

/**
 * Get video URL with optional CORS proxy
 * If VIDEO_PROXY_URL is set, routes through the proxy
 * Otherwise returns direct URL (will fail with CORS in most browsers)
 */
export function getVideoUrl(streamPath: string): string {
  // streamPath like: /live/STREAM_NAME.stream/playlist.m3u8
  if (VIDEO_PROXY_URL) {
    const proxyBase = VIDEO_PROXY_URL.replace(/\/$/, '');
    return `${proxyBase}?url=${encodeURIComponent(streamPath)}`;
  }
  return `https://${VIDEO_SERVER}${streamPath}`;
}
