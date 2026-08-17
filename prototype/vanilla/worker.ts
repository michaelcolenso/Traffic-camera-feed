const DEFAULT_FEATURE_SERVICE = 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/ArcGIS/rest/services/Traffic_Cameras_CDL/FeatureServer/0';
const SDOT_ENDPOINT = 'https://data.seattle.gov/resource/65fc-btcc.json';
const VIDEO_SERVER = '61e0c5d388c2e.streamlock.net';
const VIDEO_ORIGIN = `https://${VIDEO_SERVER}:443`;
const VIDEO_FETCH_TIMEOUT_MS = 7000;
const CAMERA_HOST = 'www.seattle.gov';
const CAMERA_PREFIX = '/trafficcams/images/';

type Camera = {
  id: string;
  label: string;
  imagePath: string;
  stream?: string;
  videoUrl?: string;
  directVideoUrl?: string;
  webUrl?: string;
  lat?: number;
  lng?: number;
};

type ArcFeature = {
  geometry?: { x?: number; y?: number } | null;
  attributes?: Record<string, unknown>;
};
type ArcResponse = { features?: ArcFeature[]; error?: { message?: string } };

type SdotCamera = {
  cameralabel?: string;
  imageurl?: { url?: string };
  video_url?: { url?: string };
  web_url?: { url?: string };
  location?: { latitude?: string; longitude?: string };
  x_coord?: string;
  y_coord?: string;
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function cameraId(raw: string): string {
  return encodeURIComponent(raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || raw);
}

function safeCameraPath(rawUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl.replace(/^http:/, 'https:'));
    return url.hostname === CAMERA_HOST && url.pathname.startsWith(CAMERA_PREFIX) && !url.pathname.includes('..')
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}

function normalizeArcGIS(data: ArcResponse): Camera[] {
  if (data.error?.message) throw new Error(data.error.message);
  const cameras: Camera[] = [];
  for (const feature of data.features ?? []) {
    const attrs = feature.attributes ?? {};
    const status = String(attrs.SERVSTAT ?? '').toUpperCase();
    if (status === 'INACT' || status === 'INACTIVE') continue;
    const imagePath = safeCameraPath(String(attrs.URL ?? ''));
    if (!imagePath) continue;
    const label = String(attrs.LOCATION || attrs.NAME || 'Seattle traffic camera');
    const stream = attrs.STREAM_NAME ? String(attrs.STREAM_NAME).trim() : undefined;
    const lat = Number(feature.geometry?.y);
    const lng = Number(feature.geometry?.x);
    cameras.push({
      id: cameraId(String(attrs.NAME || imagePath)),
      label,
      imagePath,
      stream,
      videoUrl: stream ? `/api/video?url=${encodeURIComponent(`/live/${stream}.stream/playlist.m3u8`)}` : undefined,
      directVideoUrl: stream ? `${VIDEO_ORIGIN}/live/${encodeURIComponent(stream)}.stream/playlist.m3u8` : undefined,
      webUrl: 'https://web.seattle.gov/Travelers/',
      ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
    });
  }
  return cameras;
}

function normalizeSdot(rows: SdotCamera[]): Camera[] {
  const cameras: Camera[] = [];
  for (const row of rows) {
    const imagePath = safeCameraPath(String(row.imageurl?.url ?? ''));
    if (!imagePath) continue;
    const label = String(row.cameralabel || imagePath);
    const lat = Number(row.location?.latitude ?? row.y_coord);
    const lng = Number(row.location?.longitude ?? row.x_coord);
    const videoUrl = row.video_url?.url;
    cameras.push({
      id: cameraId(String(row.web_url?.url || videoUrl || row.imageurl?.url || label)),
      label,
      imagePath,
      videoUrl,
      directVideoUrl: videoUrl,
      webUrl: row.web_url?.url,
      ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
    });
  }
  return cameras;
}

function validatedFeatureService(raw: string | null): string {
  if (!raw) return DEFAULT_FEATURE_SERVICE;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !url.pathname.toLowerCase().includes('featureserver')) {
    throw new Error('Invalid ArcGIS FeatureServer URL');
  }
  const host = url.hostname.toLowerCase();
  if (!(host === 'services.arcgis.com' || host.endsWith('.arcgis.com'))) {
    throw new Error('ArcGIS FeatureServer host is not allowed');
  }
  return url.toString().replace(/\/$/, '');
}

async function getArcGISCameras(featureService = DEFAULT_FEATURE_SERVICE): Promise<Camera[]> {
  const query = new URL(`${featureService}/query`);
  query.searchParams.set('where', '1=1');
  query.searchParams.set('outFields', 'NAME,LOCATION,URL,STREAM_NAME,SERVSTAT');
  query.searchParams.set('outSR', '4326');
  query.searchParams.set('returnGeometry', 'true');
  query.searchParams.set('f', 'json');
  const response = await fetch(query, {
    cf: { cacheEverything: true, cacheTtl: 300 },
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`ArcGIS ${response.status}`);
  return normalizeArcGIS(await response.json() as ArcResponse);
}

async function getSdotCameras(): Promise<Camera[]> {
  const response = await fetch(SDOT_ENDPOINT, {
    cf: { cacheEverything: true, cacheTtl: 300 },
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`SDOT ${response.status}`);
  return normalizeSdot(await response.json() as SdotCamera[]);
}

function card(camera: Camera, index: number): string {
  const img = `/api/image?path=${encodeURIComponent(camera.imagePath)}`;
  return `<article class="camera-card" data-camera-id="${esc(camera.id)}">
    <button class="camera-open" data-camera="${esc(camera.id)}" aria-label="View ${esc(camera.label)}">
      <div class="image-shell"><img src="${img}" alt="${esc(camera.label)}" width="480" height="270" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></div>
      <div class="card-copy"><h2>${esc(camera.label)}</h2><span>${camera.videoUrl ? 'Live' : 'Snapshot'}</span></div>
    </button>
  </article>`;
}

const INITIAL_COLLECTIONS: Array<[string, string, string[]]> = [
  ['live', 'Live streams', []],
  ['downtown', 'Downtown', ['downtown', '5th', '4th', '3rd', '2nd', '1st', 'pike', 'pine', 'union', 'madison', 'james']],
  ['bridges', 'Bridges', ['bridge', 'fremont', 'ballard', 'montlake', 'spokane', 'west seattle', 'university']],
  ['i5', 'I-5', ['i-5', 'i5', 'interstate 5']],
  ['aurora', 'Aurora / 99', ['aurora', 'sr 99', 'sr99', '99']],
  ['recent', 'Recently refreshed', []],
  ['issues', 'Signal issues', []],
];

function initialCollectionCount(cameras: Camera[], id: string, keywords: string[]): number {
  if (id === 'live') return cameras.filter((camera) => Boolean(camera.videoUrl)).length;
  if (id === 'recent' || id === 'issues') return 0;
  return cameras.filter((camera) => keywords.some((keyword) => camera.label.toLowerCase().includes(keyword))).length;
}

function initialCollectionButtons(cameras: Camera[]): string {
  return INITIAL_COLLECTIONS.map(([id, label, keywords]) => {
    const count = initialCollectionCount(cameras, id, keywords);
    return `<button class="chip" data-collection="${id}" aria-pressed="false">${esc(label)} <span>${count}</span></button>`;
  }).join('');
}

function page(cameras: Camera[]): Response {
  const first = cameras.slice(0, 6);
  const bootstrap = JSON.stringify(cameras).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <meta name="theme-color" content="#020617">
    <title>Seattle Traffic Watch</title>
    <meta name="description" content="Fast, filterable Seattle traffic camera snapshots and live feeds.">
    <link rel="stylesheet" href="/benchmark.css">
  </head><body>
    <header class="topbar">
      <div class="brand"><p class="eyebrow">Seattle traffic telemetry</p><h1>Seattle Traffic Watch</h1><p id="status-line" class="sub">${cameras.length} cameras · ArcGIS source</p></div>
      <div class="header-actions">
        <label class="search-wrap"><span class="sr-only">Search cameras</span><input id="search" type="search" placeholder="Search intersection, corridor, URL, or coordinate" autocomplete="off"></label>
        <div class="view-toggle" aria-label="View mode"><button id="grid-view" class="active" aria-pressed="true">Grid</button><button id="map-view" aria-pressed="false">Map</button></div>
        <button id="settings-toggle" class="icon-button" aria-expanded="false" aria-controls="settings">Settings</button>
      </div>
    </header>
    <section id="settings" class="settings" hidden>
      <div><strong>Data source</strong><p>Switch feeds or use an ArcGIS FeatureServer endpoint.</p></div>
      <button id="source-arcgis" class="chip active">ArcGIS</button><button id="source-sdot" class="chip">SDOT Socrata</button>
      <input id="arcgis-url" type="url" value="${esc(DEFAULT_FEATURE_SERVICE)}" aria-label="ArcGIS FeatureServer URL">
      <button id="apply-source" class="chip accent">Apply</button><button id="restore-source" class="chip">Restore default</button>
      <p id="source-error" class="error" role="alert"></p>
    </section>
    <section class="toolbar">
      <div id="collections" class="collections" aria-label="Camera collections">${initialCollectionButtons(cameras)}</div>
      <div class="toolbar-row"><p id="visible-count">${cameras.length} visible / ${cameras.length} total</p><div class="match-toggle"><button id="match-all" class="active" aria-pressed="true">Match all</button><button id="match-any" aria-pressed="false">Match any</button></div><button id="diagnostics-toggle" class="chip">Diagnostics · 0 issues</button></div>
      <div id="diagnostics" class="diagnostics" hidden></div>
    </section>
    <main id="main"><div id="grid" class="grid">${first.map(card).join('')}</div><div id="map" class="map-shell" hidden></div><div id="empty" class="empty" hidden>No cameras match the selected filters.</div><div id="sentinel" aria-hidden="true"></div></main>
    <dialog id="modal"><button id="close" class="modal-close" aria-label="Close">×</button><div id="modal-body"></div></dialog>
    <nav class="mobile-dock" aria-label="Primary navigation"><button data-mobile-view="grid" class="active">Grid</button><button data-mobile-view="map">Map</button><button id="mobile-settings">Source</button></nav>
    <script>window.__CAMERAS__=${bootstrap};window.__DEFAULT_ARCGIS__=${JSON.stringify(DEFAULT_FEATURE_SERVICE)}</script><script type="module" src="/benchmark.js"></script>
  </body></html>`;
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300, stale-if-error=86400',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https://*.basemaps.cartocdn.com; media-src 'self' blob: https://61e0c5d388c2e.streamlock.net; style-src 'self' 'unsafe-inline' https://unpkg.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; connect-src 'self' https://61e0c5d388c2e.streamlock.net https://*.basemaps.cartocdn.com https://unpkg.com https://cdn.jsdelivr.net; worker-src 'self' blob:;",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
  } });
}

async function image(request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const path = url.searchParams.get('path');
  if (!path || !path.startsWith(CAMERA_PREFIX) || path.includes('..')) return new Response('Bad image path', { status: 400 });
  const upstream = new URL(path, `https://${CAMERA_HOST}`);
  const accept = request.headers.get('Accept') || '';
  const format = accept.includes('image/avif') ? 'avif' : accept.includes('image/webp') ? 'webp' : undefined;
  const width = Math.min(Math.max(Number(url.searchParams.get('w') || 480), 240), 960);
  const response = await fetch(upstream, {
    method: request.method,
    headers: { Accept: accept || 'image/avif,image/webp,image/*,*/*;q=0.8' },
    cf: { image: { width, fit: 'scale-down', quality: width > 480 ? 76 : 68, ...(format ? { format } : {}) }, cacheEverything: true, cacheTtl: 60 },
  } as RequestInit);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
  headers.set('Vary', 'Accept');
  headers.delete('Set-Cookie');
  return new Response(response.body, { status: response.status, headers });
}

function proxyVideoUrl(requestUrl: URL, upstreamUrl: URL): string {
  return `${requestUrl.origin}/api/video?url=${encodeURIComponent(`${upstreamUrl.pathname}${upstreamUrl.search}`)}`;
}

function rewritePlaylist(playlist: string, requestUrl: URL, upstreamUrl: URL): string {
  return playlist.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    try {
      const resolved = new URL(trimmed, upstreamUrl);
      return resolved.hostname === VIDEO_SERVER ? proxyVideoUrl(requestUrl, resolved) : line;
    } catch { return line; }
  }).join('\n');
}

async function video(request: Request, requestUrl: URL): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const targetPath = requestUrl.searchParams.get('url');
  if (!targetPath || !targetPath.startsWith('/live/') || targetPath.includes('..')) return new Response('Invalid video path', { status: 400 });
  const upstreamUrl = new URL(`${VIDEO_ORIGIN}${targetPath}`);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: { Accept: request.headers.get('Accept') || '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(VIDEO_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return new Response(timedOut ? 'Video upstream timed out' : 'Video upstream unavailable', {
      status: timedOut ? 504 : 502,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }
  const contentType = upstream.headers.get('Content-Type') || '';
  const isPlaylist = contentType.includes('mpegurl') || upstreamUrl.pathname.endsWith('.m3u8');
  const headers = new Headers(upstream.headers);
  headers.delete('Set-Cookie');
  headers.set('Access-Control-Allow-Origin', '*');
  if (isPlaylist && request.method !== 'HEAD') {
    const text = await upstream.text();
    headers.set('Content-Type', 'application/vnd.apple.mpegurl');
    headers.delete('Content-Length');
    return new Response(rewritePlaylist(text, requestUrl, upstreamUrl), { status: upstream.status, headers });
  }
  if (upstreamUrl.pathname.endsWith('.ts')) headers.set('Content-Type', 'video/mp2t');
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      try { return page(await getArcGISCameras()); }
      catch (error) {
        console.error(JSON.stringify({ event: 'home_data_error', message: error instanceof Error ? error.message : String(error) }));
        return new Response('Camera data temporarily unavailable', { status: 503 });
      }
    }
    if (url.pathname === '/api/cameras') {
      try {
        const source = url.searchParams.get('source') === 'sdot' ? 'sdot' : 'arcgis';
        const cameras = source === 'sdot' ? await getSdotCameras() : await getArcGISCameras(validatedFeatureService(url.searchParams.get('arcgis')));
        return Response.json(cameras, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400' } });
      } catch (error) {
        console.error(JSON.stringify({ event: 'camera_api_error', message: error instanceof Error ? error.message : String(error) }));
        return Response.json({ error: 'Camera data unavailable' }, { status: 503 });
      }
    }
    if (url.pathname === '/api/image') return image(request, url);
    if (url.pathname === '/api/video') {
      try { return await video(request, url); }
      catch (error) {
        console.error(JSON.stringify({ event: 'video_proxy_error', message: error instanceof Error ? error.message : String(error) }));
        return new Response('Video upstream unavailable', { status: 502 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};