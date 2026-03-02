/**
 * Cloudflare Worker: Video Stream CORS Proxy
 * Proxies Seattle traffic camera HLS streams with CORS headers
 */

// Allowed origins - update with your actual domains
const ALLOWED_ORIGINS = [
  'https://blog.michaelcolenso.com',     // Your custom domain
  'https://michaelcolenso.github.io',     // GitHub Pages
  'http://localhost:5173',                // Vite dev server
  'http://localhost:4173',                // Vite preview
  null,                                   // Allow no origin (direct requests)
];

// Video server we're proxying
const VIDEO_SERVER = 'video.seattle.gov';

function getCorsHeaders(origin) {
  // Check if origin is allowed (including wildcard for debugging)
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    
    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(origin),
      });
    }

    // Only allow GET/HEAD
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { 
        status: 405,
        headers: getCorsHeaders(origin),
      });
    }

    // Extract the target path from query param
    const targetPath = url.searchParams.get('url');
    if (!targetPath) {
      return new Response('Missing url parameter. Usage: ?url=/live/STREAM_NAME.stream/playlist.m3u8', { 
        status: 400,
        headers: getCorsHeaders(origin),
      });
    }

    // Validate path (only allow /live/ paths)
    if (!targetPath.startsWith('/live/')) {
      return new Response('Invalid path. Only /live/ paths allowed.', { 
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
          'Referer': `https://${VIDEO_SERVER}/`,
        },
      });

      // Create new headers with CORS
      const corsHeaders = getCorsHeaders(origin);
      const newHeaders = new Headers();
      
      // Copy relevant headers from origin response
      ['Content-Type', 'Content-Length', 'Accept-Ranges', 'Content-Range', 'Cache-Control', 'ETag', 'Last-Modified'].forEach(name => {
        const value = response.headers.get(name);
        if (value) newHeaders.set(name, value);
      });
      
      // Set CORS headers
      Object.entries(corsHeaders).forEach(([key, val]) => newHeaders.set(key, val));
      
      // Determine content type if missing
      if (!newHeaders.has('Content-Type')) {
        if (targetPath.endsWith('.m3u8')) {
          newHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
        } else if (targetPath.endsWith('.ts')) {
          newHeaders.set('Content-Type', 'video/MP2T');
        }
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
