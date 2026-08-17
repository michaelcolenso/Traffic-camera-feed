export type HistoryCamera = {
  id: string;
  label: string;
  imagePath: string;
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

export type HistoryBindings = {
  HISTORY_DB?: HistoryD1Database;
  HISTORY_BUCKET?: HistoryR2Bucket;
};

const CAMERA_HOST = 'www.seattle.gov';
const CAMERA_PREFIX = '/trafficcams/images/';
const HISTORY_PREFIX = 'frames/';
const RETENTION_MS = 48 * 60 * 60 * 1000;
const CAPTURE_BUCKETS = 5;
const CAPTURE_CONCURRENCY = 6;
const MAX_HISTORY_LIMIT = 288;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function hasBindings(env: HistoryBindings): env is Required<HistoryBindings> {
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

async function captureOne(env: Required<HistoryBindings>, camera: HistoryCamera, capturedAt: number): Promise<'stored' | 'duplicate'> {
  const { bytes, contentType } = await fetchFrame(camera);
  const sha256 = await digestHex(bytes);
  const latest = await env.HISTORY_DB.prepare(
    'SELECT r2_key, sha256 FROM camera_snapshots WHERE camera_id = ? ORDER BY captured_at DESC LIMIT 1',
  ).bind(camera.id).first<{ r2_key: string; sha256: string }>();

  let key = latest?.r2_key;
  let duplicate = 0;
  if (!latest || latest.sha256 !== sha256 || !key) {
    key = frameKey(camera.id, capturedAt);
    await env.HISTORY_BUCKET.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { cameraId: camera.id, capturedAt: String(capturedAt), sha256 },
    });
  } else {
    duplicate = 1;
  }

  await env.HISTORY_DB.prepare(
    `INSERT INTO camera_snapshots
      (camera_id, camera_label, captured_at, r2_key, sha256, bytes, is_duplicate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(camera.id, camera.label, capturedAt, key, sha256, bytes.byteLength, duplicate).run();
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
    `SELECT captured_at, r2_key, sha256, bytes, is_duplicate
       FROM camera_snapshots
      WHERE camera_id = ? AND captured_at >= ?
      ORDER BY captured_at DESC
      LIMIT ?`,
  ).bind(cameraId, cutoff, limit).all<{ captured_at: number; r2_key: string; sha256: string; bytes: number; is_duplicate: number }>();
  const frames = (result.results ?? []).reverse().map((row) => ({
    capturedAt: row.captured_at,
    imageUrl: `/api/history/image?key=${encodeURIComponent(row.r2_key)}`,
    sha256: row.sha256,
    bytes: row.bytes,
    duplicate: Boolean(row.is_duplicate),
  }));
  return json({ cameraId, hours, frames }, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
}
