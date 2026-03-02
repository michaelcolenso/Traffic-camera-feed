/**
 * Cloudflare Worker: Video Stream CORS Proxy
 * Proxies Seattle traffic camera HLS streams with CORS headers
 */

// Allowed origins - add your GitHub Pages domain
const ALLOWED_ORIGINS = [
  'https://michaelcolenso.github.io',  // Your GitHub Pages domain
  'http://localhost:5173',              // Vite dev server
  'http://localhost:4173',              // Vite preview
];

// Video server we're proxying
const VIDEO_SERVER = 'video.seattle.gov';

function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    
    // Check if origin is allowed
    const isAllowed = !origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o));
    
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(isAllowed ? origin : ALLOWED_ORIGINS[0]),
      });
    }

    // Only allow GET/HEAD
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { status: 405 });
    }

    // Extract the target path from query param
    // Format: /?url=/live/STREAM_NAME.stream/playlist.m3u8
    const targetPath = url.searchParams.get('url');
    if (!targetPath) {
      return new Response('Missing url parameter', { 
        status: 400,
        headers: getCorsHeaders(origin),
      });
    }

    // Validate path (only allow /live/ paths)
    if (!targetPath.startsWith('/live/')) {
      return new Response('Invalid path', { 
        status: 403,
        headers: getCorsHeaders(origin),
      });
    }

    // Build target URL
    const targetUrl = `https://${VIDEO_SERVER}${targetPath}`;

    try {
      // Fetch from video server
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': request.headers.get('User-Agent') || 'Cloudflare-Worker',
          'Accept': request.headers.get('Accept') || '*/*',
        },
      });

      // Clone response and add CORS headers
      const corsHeaders = getCorsHeaders(isAllowed ? origin : ALLOWED_ORIGINS[0]);
      
      // Determine content type
      const contentType = response.headers.get('Content-Type') || 
        (targetPath.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T');

      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, val]) => newHeaders.set(key, val));
      newHeaders.set('Content-Type', contentType);
      
      // Cache control - playlist updates frequently, segments can cache longer
      if (targetPath.endsWith('.m3u8')) {
        newHeaders.set('Cache-Control', 'public, max-age=2');
      } else {
        newHeaders.set('Cache-Control', 'public, max-age=60');
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });

    } catch (error) {
      return new Response(`Proxy error: ${error.message}`, { 
        status: 502,
        headers: getCorsHeaders(origin),
      });
    }
  },
};
