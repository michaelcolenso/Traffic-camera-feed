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

    // Support both query param and direct path
    // ?url=/live/xxx.stream/playlist.m3u8 OR /live/xxx.stream/playlist.m3u8
    let targetPath = url.searchParams.get('url');
    
    if (!targetPath) {
      // Try to extract from pathname (e.g., /live/xxx.stream/playlist.m3u8)
      const pathMatch = url.pathname.match(/^\/live\/.+/);
      if (pathMatch) {
        targetPath = url.pathname;
      }
    }

    if (!targetPath) {
      return new Response('Missing url parameter', { status: 400, headers: corsHeaders });
    }

    const targetUrl = `https://${VIDEO_SERVER}${targetPath}`;

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
          'Accept': '*/*',
        },
      });

      const contentType = response.headers.get('Content-Type') || '';
      
      // If it's an m3u8 playlist, rewrite relative URLs to absolute proxy URLs
      if (contentType.includes('mpegurl') || targetPath.endsWith('.m3u8')) {
        const text = await response.text();
        const baseUrl = `${url.protocol}//${url.host}`;
        
        // Rewrite relative chunklist URLs to proxy URLs
        // chunklist_xxx.m3u8 -> /live/stream/chunklist_xxx.m3u8
        const basePath = targetPath.substring(0, targetPath.lastIndexOf('/') + 1);
        const rewritten = text.replace(
          /^(chunklist_[^\s]+\.m3u8|media_[^\s]+\.ts)$/gm,
          (match) => `${baseUrl}${basePath}${match}`
        );

        return new Response(rewritten, {
          status: response.status,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/vnd.apple.mpegurl',
          },
        });
      }

      // For other files (ts segments, etc.)
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));

      if (targetPath.endsWith('.ts')) {
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
