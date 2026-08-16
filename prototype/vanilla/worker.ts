const ARCGIS_QUERY = 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/ArcGIS/rest/services/Traffic_Cameras_CDL/FeatureServer/0/query?where=1%3D1&outFields=NAME%2CLOCATION%2CURL%2CSTREAM_NAME%2CSERVSTAT&outSR=4326&returnGeometry=true&f=json';
const CAMERA_HOST = 'www.seattle.gov';
const CAMERA_PREFIX = '/trafficcams/images/';

type Env = { ASSETS: Fetcher };
type Camera = { id: string; label: string; imagePath: string; stream?: string };

type ArcFeature = {
  attributes?: Record<string, unknown>;
};

type ArcResponse = { features?: ArcFeature[] };

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function normalize(data: ArcResponse): Camera[] {
  const cameras: Camera[] = [];
  for (const feature of data.features ?? []) {
    const attrs = feature.attributes ?? {};
    const status = String(attrs.SERVSTAT ?? '').toUpperCase();
    if (status === 'INACT' || status === 'INACTIVE') continue;
    const rawUrl = String(attrs.URL ?? '').replace(/^http:/, 'https:');
    if (!rawUrl) continue;
    let url: URL;
    try { url = new URL(rawUrl); } catch { continue; }
    if (url.hostname !== CAMERA_HOST || !url.pathname.startsWith(CAMERA_PREFIX)) continue;
    const label = String(attrs.LOCATION || attrs.NAME || 'Seattle traffic camera');
    cameras.push({
      id: String(attrs.NAME || url.pathname),
      label,
      imagePath: url.pathname,
      stream: attrs.STREAM_NAME ? String(attrs.STREAM_NAME) : undefined,
    });
  }
  return cameras;
}

async function getCameras(): Promise<Camera[]> {
  const response = await fetch(ARCGIS_QUERY, {
    cf: { cacheEverything: true, cacheTtl: 300 },
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`ArcGIS ${response.status}`);
  return normalize(await response.json() as ArcResponse);
}

function card(camera: Camera, index: number): string {
  const img = `/api/image?path=${encodeURIComponent(camera.imagePath)}`;
  return `<article class="camera-card" data-label="${esc(camera.label.toLowerCase())}">
    <button class="camera-open" data-camera="${esc(camera.id)}" aria-label="View ${esc(camera.label)}">
      <div class="image-shell"><img src="${img}" alt="${esc(camera.label)}" width="480" height="270" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></div>
      <div class="card-copy"><h2>${esc(camera.label)}</h2><span>${camera.stream ? 'Live capable' : 'Snapshot'}</span></div>
    </button>
  </article>`;
}

function page(cameras: Camera[]): Response {
  const first = cameras.slice(0, 6);
  const bootstrap = JSON.stringify(cameras).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Seattle Traffic Watch — Vanilla Benchmark</title>
    <meta name="description" content="Cloudflare edge-rendered Seattle traffic camera benchmark.">
    <link rel="stylesheet" href="/benchmark.css">
  </head><body>
    <header><div><p class="eyebrow">Cloudflare edge prototype</p><h1>Seattle Traffic Watch</h1><p class="sub">${cameras.length} cameras · server-rendered first view · no UI framework</p></div>
      <input id="search" type="search" placeholder="Search intersections" aria-label="Search cameras"></header>
    <main><div id="grid" class="grid">${first.map(card).join('')}</div><div id="sentinel" aria-hidden="true"></div></main>
    <dialog id="modal"><button id="close" aria-label="Close">×</button><div id="modal-body"></div></dialog>
    <script>window.__CAMERAS__=${bootstrap}</script><script type="module" src="/benchmark.js"></script>
  </body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=30, s-maxage=120' } });
}

async function image(request: Request, url: URL): Promise<Response> {
  const path = url.searchParams.get('path');
  if (!path || !path.startsWith(CAMERA_PREFIX) || path.includes('..')) return new Response('bad image path', { status: 400 });
  const upstream = new URL(path, `https://${CAMERA_HOST}`);
  const accept = request.headers.get('Accept') || '';
  const format = accept.includes('image/avif') ? 'avif' : accept.includes('image/webp') ? 'webp' : undefined;
  const response = await fetch(upstream, {
    headers: { Accept: accept || 'image/avif,image/webp,image/*,*/*;q=0.8' },
    cf: { image: { width: 480, fit: 'scale-down', quality: 68, ...(format ? { format } : {}) }, cacheEverything: true, cacheTtl: 60 },
  } as RequestInit);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=30, s-maxage=60');
  headers.set('Vary', 'Accept');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      try { return page(await getCameras()); }
      catch { return new Response('Camera data temporarily unavailable', { status: 503 }); }
    }
    if (url.pathname === '/api/cameras') {
      try { return Response.json(await getCameras(), { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } }); }
      catch { return Response.json({ error: 'camera data unavailable' }, { status: 503 }); }
    }
    if (url.pathname === '/api/image') return image(request, url);
    return env.ASSETS.fetch(request);
  },
};
