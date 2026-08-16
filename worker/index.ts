const VIDEO_SERVER = '61e0c5d388c2e.streamlock.net';
const CAMERA_IMAGE_HOST = 'www.seattle.gov';
const CAMERA_IMAGE_PREFIX = '/trafficcams/images/';

type ImageFetchInit = RequestInit & {
  cf: {
    image: {
      width: number;
      fit: 'scale-down';
      quality: number;
      format?: 'avif' | 'webp';
    };
    cacheEverything: boolean;
    cacheTtl: number;
  };
};

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

function getImageFormat(accept: string | null): 'avif' | 'webp' | undefined {
  if (accept?.includes('image/avif')) return 'avif';
  if (accept?.includes('image/webp')) return 'webp';
  return undefined;
}

async function handleImageRequest(request: Request, requestUrl: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  const path = requestUrl.searchParams.get('path');
  if (!path || !path.startsWith(CAMERA_IMAGE_PREFIX) || path.includes('..')) {
    return new Response('Invalid or missing camera image path', { status: 400 });
  }

  const version = requestUrl.searchParams.get('v');
  if (version && !/^\d+$/.test(version)) {
    return new Response('Invalid image version', { status: 400 });
  }

  const upstreamUrl = new URL(path, `https://${CAMERA_IMAGE_HOST}`);
  if (upstreamUrl.hostname !== CAMERA_IMAGE_HOST || !upstreamUrl.pathname.startsWith(CAMERA_IMAGE_PREFIX)) {
    return new Response('Invalid camera image host', { status: 400 });
  }

  // A 30-second client bucket gives all users the same transform URL during a refresh window.
  // Keep the bucket on the upstream URL so Cloudflare's transformed-image cache shares the result.
  if (version) upstreamUrl.searchParams.set('v', version);

  const format = getImageFormat(request.headers.get('Accept'));
  const init: ImageFetchInit = {
    method: request.method,
    headers: {
      Accept: request.headers.get('Accept') || 'image/avif,image/webp,image/*,*/*;q=0.8',
      'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
    },
    redirect: 'follow',
    cf: {
      image: {
        width: 480,
        fit: 'scale-down',
        quality: 70,
        ...(format ? { format } : {}),
      },
      cacheEverything: true,
      cacheTtl: 45,
    },
  };

  try {
    const upstream = await fetch(upstreamUrl, init);
    if (!upstream.ok && !upstream.redirected) {
      return new Response('Camera image unavailable', { status: upstream.status });
    }

    const headers = new Headers(upstream.headers);
    headers.set('Cache-Control', 'public, max-age=20, s-maxage=45');
    headers.set('Vary', 'Accept');
    headers.set('X-Image-Proxy', 'sdot-resized');
    headers.delete('Set-Cookie');

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown image error';
    return new Response(`Image proxy error: ${message}`, { status: 502 });
  }
}

async function handleVideoRequest(request: Request, requestUrl: URL): Promise<Response> {
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
    const isPlaylist = contentType.includes('mpegurl') || upstreamUrl.pathname.endsWith('.m3u8');

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
}

export default {
  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname === '/api/image') {
      return handleImageRequest(request, requestUrl);
    }

    if (requestUrl.pathname === '/api/video') {
      return handleVideoRequest(request, requestUrl);
    }

    return new Response('Not found', { status: 404 });
  },
};
