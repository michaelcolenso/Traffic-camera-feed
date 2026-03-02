/**
 * Simple CORS Proxy for Seattle Traffic Cameras
 */

// Update this with your actual domain
const ALLOWED_ORIGINS = [
  'https://blog.michaelcolenso.com',
  'https://michaelcolenso.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    
    // CORS headers - allow the requesting origin if in list
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Vary': 'Origin',
    };
    
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const targetPath = url.searchParams.get('url');
    if (!targetPath) {
      return new Response('Usage: ?url=/live/STREAM_NAME.stream/playlist.m3u8', { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    // Validate path
    if (!targetPath.startsWith('/live/')) {
      return new Response('Invalid path', { status: 403, headers: corsHeaders });
    }

    const targetUrl = `https://video.seattle.gov${targetPath}`;

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
          'Accept': '*/*',
        },
      });

      // Create new response with CORS headers
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));

      // Set correct content type
      if (targetPath.endsWith('.m3u8')) {
        newHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
      }

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });

    } catch (err) {
      return new Response(`Error: ${err.message}`, { 
        status: 502, 
        headers: corsHeaders 
      });
    }
  },
};
