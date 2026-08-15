const VIDEO_SERVER = '61e0c5d388c2e.streamlock.net';

function proxyUrl(requestUrl: URL, upstreamUrl: URL): string {
  const path = `${upstreamUrl.pathname}${upstreamUrl.search}`;
  return `${requestUrl.origin}/api/video?url=${encodeURIComponent(path)}`;
}

function rewritePlaylist(playlist: string, requestUrl: URL, upstreamUrl: URL): string {
  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();

      // HLS directives/comments and blank lines are not media URLs.
      if (!trimmed || trimmed.startsWith('#')) return line;

      try {
        const resolved = new URL(trimmed, upstreamUrl);
        if (resolved.hostname !== VIDEO_SERVER) return line;
        return proxyUrl(requestUrl, resolved);
      } catch {
        return line;
      }
    })
    .join('\n');
}

export default {
  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname !== '/api/video') {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD, OPTIONS' },
      });
    }

    const targetPath = requestUrl.searchParams.get('url');
    if (!targetPath || !targetPath.startsWith('/live/')) {
      return new Response('Invalid or missing video path', { status: 400 });
    }

    const upstreamUrl = new URL(`https://${VIDEO_SERVER}${targetPath}`);
    if (upstreamUrl.hostname !== VIDEO_SERVER) {
      return new Response('Invalid video host', { status: 400 });
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers: {
          Accept: request.headers.get('Accept') || '*/*',
          'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
        },
        redirect: 'follow',
      });

      const contentType = upstream.headers.get('Content-Type') || '';
      const isPlaylist =
        contentType.includes('mpegurl') || upstreamUrl.pathname.endsWith('.m3u8');

      if (isPlaylist && request.method !== 'HEAD') {
        const playlist = await upstream.text();
        const rewritten = rewritePlaylist(playlist, requestUrl, upstreamUrl);
        const headers = new Headers(upstream.headers);
        headers.set('Content-Type', 'application/vnd.apple.mpegurl');
        headers.delete('Content-Length');

        return new Response(rewritten, {
          status: upstream.status,
          headers,
        });
      }

      const headers = new Headers(upstream.headers);
      if (upstreamUrl.pathname.endsWith('.ts')) {
        headers.set('Content-Type', 'video/mp2t');
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown upstream error';
      return new Response(`Video proxy error: ${message}`, { status: 502 });
    }
  },
};
