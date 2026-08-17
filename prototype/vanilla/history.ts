export type HistoryCamera = {
  id: string;
  label: string;
  imagePath: string;
  lat?: number;
  lng?: number;
};

type HistoryD1Statement = {
  bind: (...values: unknown[]) => HistoryD1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

type HistoryD1Database = {
  prepare: (query: string) => HistoryD1Statement;
};

type HistoryR2Object = {
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata: (headers: Headers) => void;
};

type HistoryR2Bucket = {
  put: (key: string, value: ArrayBuffer, options?: unknown) => Promise<unknown>;
  get: (key: string, options?: unknown) => Promise<HistoryR2Object | null>;
  delete: (keys: string | string[]) => Promise<void>;
};

type ImagesOutput = { response: () => Response };
type ImagesTransformer = {
  transform: (options: Record<string, unknown>) => ImagesTransformer;
  output: (options: Record<string, unknown>) => Promise<ImagesOutput>;
};
type ImagesBinding = { input: (stream: ReadableStream) => ImagesTransformer };

export type HistoryBindings = {
  HISTORY_DB?: HistoryD1Database;
  HISTORY_BUCKET?: HistoryR2Bucket;
  IMAGES?: ImagesBinding;
};

type ReadyHistoryBindings = HistoryBindings & {
  HISTORY_DB: HistoryD1Database;
  HISTORY_BUCKET: HistoryR2Bucket;
};

const CAMERA_HOST = 'www.seattle.gov';
const CAMERA_PREFIX = '/trafficcams/images/';
const HISTORY_PREFIX = 'frames/';
const RETENTION_MS = 48 * 60 * 60 * 1000;
const CAPTURE_BUCKETS = 5;
const CAPTURE_CONCURRENCY = 6;
const MAX_HISTORY_LIMIT = 288;

type VisualMetrics = {
  fingerprint: string;
  meanLuma: number;
  contrast: number;
};

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

async function decodePngLuminance(bytes: ArrayBuffer): Promise<Uint8Array | null> {
  const data = new Uint8Array(bytes);
  if (data.length < 33 || data[0] !== 137 || data[1] !== 80 || data[2] !== 78 || data[3] !== 71) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > data.length) return null;
    if (type === 'IHDR') {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = data[start + 8];
      colorType = data[start + 9];
    } else if (type === 'IDAT') {
      idat.push(data.slice(start, end));
    } else if (type === 'IEND') break;
    offset = end + 4;
  }
  if (!width || !height || bitDepth !== 8 || !idat.length) return null;
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels) return null;
  const compressedLength = idat.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const chunk of idat) { compressed.set(chunk, cursor); cursor += chunk.length; }
  const decompressed = new Uint8Array(await new Response(new Response(compressed).body!.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const rowBytes = width * channels;
  if (decompressed.length < height * (rowBytes + 1)) return null;
  const raw = new Uint8Array(height * rowBytes);
  let input = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = decompressed[input++];
    for (let x = 0; x < rowBytes; x += 1) {
      const value = decompressed[input++];
      const outIndex = y * rowBytes + x;
      const left = x >= channels ? raw[outIndex - channels] : 0;
      const up = y > 0 ? raw[outIndex - rowBytes] : 0;
      const upperLeft = y > 0 && x >= channels ? raw[outIndex - rowBytes - channels] : 0;
      let decoded = value;
      if (filter === 1) decoded = (value + left) & 255;
      else if (filter === 2) decoded = (value + up) & 255;
      else if (filter === 3) decoded = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) decoded = (value + paeth(left, up, upperLeft)) & 255;
      else if (filter !== 0) return null;
      raw[outIndex] = decoded;
    }
  }
  const luminance = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < raw.length; i += channels, p += 1) {
    if (colorType === 0 || colorType === 4) luminance[p] = raw[i];
    else luminance[p] = Math.round(0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2]);
  }
  return luminance;
}

function encodeFingerprint(values: Uint8Array): string {
  let raw = '';
  for (const value of values) raw += String.fromCharCode(value);
  return btoa(raw);
}

async function measureVisual(images: ImagesBinding | undefined, bytes: ArrayBuffer): Promise<VisualMetrics | null> {
  if (!images) return null;
  try {
    const stream = new Response(bytes).body;
    if (!stream) return null;
    const output = await images.input(stream)
      .transform({ width: 16, height: 9, fit: 'cover' })
      .output({ format: 'image/png' });
    const response = output.response();
    if (!response.ok) return null;
    const pixels = await decodePngLuminance(await response.arrayBuffer());
    if (!pixels?.length) return null;
    const meanLuma = [...pixels].reduce((sum, value) => sum + value, 0) / pixels.length;
    const contrast = Math.sqrt([...pixels].reduce((sum, value) => sum + (value - meanLuma) ** 2, 0) / pixels.length);
    return {
      fingerprint: encodeFingerprint(pixels),
      meanLuma: Number(meanLuma.toFixed(3)),
      contrast: Number(contrast.toFixed(3)),
    };
  } catch (error) {
    console.error(JSON.stringify({ event: 'visual_measurement_error', message: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}


function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function hasBindings(env: HistoryBindings): env is ReadyHistoryBindings {
  return Boolean(env.HISTORY_DB && env.HISTORY_BUCKET);
}

function cameraBucket(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % CAPTURE_BUCKETS;
}

function safeCameraId(value: string | null): string | null {
  if (!value || value.length > 180 || !/^[a-z0-9%._~-]+$/i.test(value)) return null;
  return value;
}

function safeHistoryKey(value: string | null): string | null {
  if (!value || value.length > 500 || !value.startsWith(HISTORY_PREFIX) || value.includes('..')) return null;
  return value;
}

function frameKey(cameraId: string, capturedAt: number): string {
  const date = new Date(capturedAt);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const safeId = cameraId.replace(/[^a-z0-9._~-]+/gi, '_');
  return `${HISTORY_PREFIX}${y}/${m}/${d}/${safeId}/${capturedAt}.webp`;
}

async function digestHex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchFrame(camera: HistoryCamera): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!camera.imagePath.startsWith(CAMERA_PREFIX) || camera.imagePath.includes('..')) throw new Error('invalid camera path');
  const upstream = new URL(camera.imagePath, `https://${CAMERA_HOST}`);
  const response = await fetch(upstream, {
    headers: { Accept: 'image/webp,image/*,*/*;q=0.8' },
    cf: {
      image: { width: 480, fit: 'scale-down', quality: 60, format: 'webp' },
      cacheEverything: false,
    },
  } as RequestInit);
  if (!response.ok) throw new Error(`snapshot ${response.status}`);
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get('Content-Type') || 'image/webp' };
}

async function captureOne(env: ReadyHistoryBindings, camera: HistoryCamera, capturedAt: number): Promise<'stored' | 'duplicate'> {
  const { bytes, contentType } = await fetchFrame(camera);
  const sha256 = await digestHex(bytes);
  const latest = await env.HISTORY_DB.prepare(
    `SELECT r2_key, sha256, visual_fingerprint, mean_luma, visual_contrast
       FROM camera_snapshots
      WHERE camera_id = ?
      ORDER BY captured_at DESC LIMIT 1`,
  ).bind(camera.id).first<{ r2_key: string; sha256: string; visual_fingerprint: string | null; mean_luma: number | null; visual_contrast: number | null }>();

  let key = latest?.r2_key;
  let duplicate = 0;
  let visual: VisualMetrics | null = null;
  if (!latest || latest.sha256 !== sha256 || !key) {
    key = frameKey(camera.id, capturedAt);
    await env.HISTORY_BUCKET.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { cameraId: camera.id, capturedAt: String(capturedAt), sha256 },
    });
    visual = await measureVisual(env.IMAGES, bytes);
  } else {
    duplicate = 1;
    if (latest.visual_fingerprint && latest.mean_luma != null && latest.visual_contrast != null) {
      visual = { fingerprint: latest.visual_fingerprint, meanLuma: latest.mean_luma, contrast: latest.visual_contrast };
    }
  }

  await env.HISTORY_DB.prepare(
    `INSERT INTO camera_snapshots
      (camera_id, camera_label, captured_at, r2_key, sha256, bytes, is_duplicate,
       visual_fingerprint, mean_luma, visual_contrast, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    camera.id,
    camera.label,
    capturedAt,
    key,
    sha256,
    bytes.byteLength,
    duplicate,
    visual?.fingerprint ?? null,
    visual?.meanLuma ?? null,
    visual?.contrast ?? null,
    Number.isFinite(camera.lat) ? camera.lat : null,
    Number.isFinite(camera.lng) ? camera.lng : null,
  ).run();
  return duplicate ? 'duplicate' : 'stored';
}

async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await work(items[index]);
    }
  });
  await Promise.all(runners);
}

export async function captureHistory(env: HistoryBindings, cameras: HistoryCamera[], scheduledAt = Date.now()): Promise<void> {
  if (!hasBindings(env)) return;
  const bucket = new Date(scheduledAt).getUTCMinutes() % CAPTURE_BUCKETS;
  const selected = cameras.filter((camera) => cameraBucket(camera.id) === bucket);
  let stored = 0;
  let duplicate = 0;
  let failed = 0;

  await mapLimit(selected, CAPTURE_CONCURRENCY, async (camera) => {
    try {
      const result = await captureOne(env, camera, scheduledAt);
      if (result === 'stored') stored += 1;
      else duplicate += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ event: 'history_capture_error', camera: camera.id, message: error instanceof Error ? error.message : String(error) }));
    }
  });

  console.log(JSON.stringify({ event: 'history_capture_complete', bucket, selected: selected.length, stored, duplicate, failed }));
}

export async function purgeHistory(env: HistoryBindings, now = Date.now()): Promise<void> {
  if (!hasBindings(env)) return;
  const cutoff = now - RETENTION_MS;
  const stale = await env.HISTORY_DB.prepare(
    'SELECT id, r2_key FROM camera_snapshots WHERE captured_at < ? ORDER BY captured_at ASC LIMIT 200',
  ).bind(cutoff).all<{ id: number; r2_key: string }>();
  const rows = stale.results ?? [];
  if (!rows.length) return;

  const keys = [...new Set(rows.map((row) => row.r2_key))];
  const referenced = new Set<string>();
  for (const key of keys) {
    const stillUsed = await env.HISTORY_DB.prepare(
      'SELECT 1 AS found FROM camera_snapshots WHERE r2_key = ? AND captured_at >= ? LIMIT 1',
    ).bind(key, cutoff).first<{ found: number }>();
    if (stillUsed) referenced.add(key);
  }
  const deletable = keys.filter((key) => !referenced.has(key));
  if (deletable.length) await env.HISTORY_BUCKET.delete(deletable);
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  await env.HISTORY_DB.prepare(`DELETE FROM camera_snapshots WHERE id IN (${placeholders})`).bind(...ids).run();
  console.log(JSON.stringify({ event: 'history_purge', rows: rows.length, objects: deletable.length }));
}

export async function handleHistoryRequest(request: Request, url: URL, env: HistoryBindings): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/history')) return null;
  if (!hasBindings(env)) return json({ error: 'History is not configured yet' }, { status: 503 });

  if (url.pathname === '/api/history/image') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const key = safeHistoryKey(url.searchParams.get('key'));
    if (!key) return new Response('Invalid history key', { status: 400 });
    const object = await env.HISTORY_BUCKET.get(key, request.method === 'HEAD' ? { onlyIf: {} } : undefined);
    if (!object) return new Response('Historical frame not found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    if (request.method === 'HEAD') return new Response(null, { headers });
    return new Response(object.body, { headers });
  }

  if (url.pathname === '/api/history/status') {
    const stats = await env.HISTORY_DB.prepare(
      'SELECT COUNT(*) AS frames, COUNT(DISTINCT camera_id) AS cameras, MAX(captured_at) AS latest, MIN(captured_at) AS earliest FROM camera_snapshots',
    ).first<{ frames: number; cameras: number; latest: number | null; earliest: number | null }>();
    return json(stats ?? { frames: 0, cameras: 0, latest: null, earliest: null });
  }

  if (url.pathname !== '/api/history') return new Response('Not found', { status: 404 });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const cameraId = safeCameraId(url.searchParams.get('camera'));
  if (!cameraId) return json({ error: 'Invalid camera id' }, { status: 400 });
  const hours = Math.min(Math.max(Number(url.searchParams.get('hours') || 6), 0.1), 48);
  const limit = Math.min(Math.max(Math.floor(Number(url.searchParams.get('limit') || 96)), 1), MAX_HISTORY_LIMIT);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const result = await env.HISTORY_DB.prepare(
    `SELECT captured_at, r2_key, sha256, bytes, is_duplicate, visual_fingerprint, mean_luma, visual_contrast
       FROM camera_snapshots
      WHERE camera_id = ? AND captured_at >= ?
      ORDER BY captured_at DESC
      LIMIT ?`,
  ).bind(cameraId, cutoff, limit).all<{ captured_at: number; r2_key: string; sha256: string; bytes: number; is_duplicate: number; visual_fingerprint: string | null; mean_luma: number | null; visual_contrast: number | null }>();
  const frames = (result.results ?? []).reverse().map((row) => ({
    capturedAt: row.captured_at,
    imageUrl: `/api/history/image?key=${encodeURIComponent(row.r2_key)}`,
    sha256: row.sha256,
    bytes: row.bytes,
    duplicate: Boolean(row.is_duplicate),
    visual: row.visual_fingerprint ? {
      meanLuma: row.mean_luma,
      contrast: row.visual_contrast,
    } : null,
  }));
  return json({ cameraId, hours, frames }, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
}
