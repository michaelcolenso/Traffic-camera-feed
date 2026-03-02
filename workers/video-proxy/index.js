/**
 * CORS Proxy for Seattle Traffic Camera Video Streams
 * Proxies Wowza streams from 61e0c5d388c2e.streamlock.net
 */

const ALLOWED_ORIGINS = [
  'https://blog.michaelcolenso.com',
  'https://michaelcolenso.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

// Wowza Streaming Engine server
const VIDEO_SERVER = '61e0c5d388c2e.streamlock.net';

function getCorsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    const targetPath = url.searchParams.get('url');
    if (!targetPath) {
      return new Response('Missing url parameter', { status: 400, headers: corsHeaders });
    }

    // Build target URL
    const targetUrl = `https://${VIDEO_SERVER}${targetPath}`;

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
          'Accept': '*/*',
        },
      });

      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));

      // Set correct content type for m3u8
      if (targetPath.endsWith('.m3u8')) {
        newHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
      } else if (targetPath.endsWith('.ts')) {
        newHeaders.set('Content-Type', 'video/mp2t');
      }

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });

    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, { status: 502, headers: corsHeaders });
    }
  },
};
