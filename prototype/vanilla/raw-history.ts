export type RawHistoryCamera = {
  id: string;
  label: string;
  imagePath: string;
  lat?: number;
  lng?: number;
};

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
};

type R2Bucket = {
  put: (key: string, value: ArrayBuffer, options?: unknown) => Promise<unknown>;
};

export type RawHistoryBindings = {
  HISTORY_DB?: D1Database;
  HISTORY_BUCKET?: R2Bucket;
};

type ReadyBindings = {
  HISTORY_DB: D1Database;
  HISTORY_BUCKET: R2Bucket;
};

const CAMERA_HOST = 'www.seattle.gov';
const CAMERA_PREFIX = '/trafficcams/images/';
const HISTORY_PREFIX = 'frames/';
const CAPTURE_BUCKETS = 5;
const CAPTURE_CONCURRENCY = 6;

function hasBindings(env: RawHistoryBindings): env is ReadyBindings {
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

function extensionFor(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('webp')) return 'webp';
  return 'img';
}

function frameKey(cameraId: string, capturedAt: number, contentType: string): string {
  const date = new Date(capturedAt);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const safeId = cameraId.replace(/[^a-z0-9._~-]+/gi, '_');
  return `${HISTORY_PREFIX}${y}/${m}/${d}/${safeId}/${capturedAt}.${extensionFor(contentType)}`;
}

async function digestHex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function fetchRawFrame(camera: RawHistoryCamera): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!camera.imagePath.startsWith(CAMERA_PREFIX) || camera.imagePath.includes('..')) throw new Error('invalid camera path');
  const upstream = new URL(camera.imagePath, `https://${CAMERA_HOST}`);
  const response = await fetch(upstream, {
    headers: {
      Accept: 'image/jpeg,image/png,image/gif,image/webp,image/*,*/*;q=0.8',
      'Cache-Control': 'no-cache',
    },
    cf: {
      cacheEverything: false,
      cacheTtl: 0,
    },
  } as RequestInit);
  if (!response.ok) throw new Error(`snapshot ${response.status}`);
  const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
  if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`unexpected snapshot content type ${contentType}`);
  return { bytes: await response.arrayBuffer(), contentType };
}

async function captureOne(env: ReadyBindings, camera: RawHistoryCamera, capturedAt: number): Promise<'stored' | 'duplicate'> {
  const { bytes, contentType } = await fetchRawFrame(camera);
  const sha256 = await digestHex(bytes);
  const latest = await env.HISTORY_DB.prepare(
    `SELECT r2_key, sha256, visual_fingerprint, mean_luma, visual_contrast
       FROM camera_snapshots
      WHERE camera_id = ?
      ORDER BY captured_at DESC LIMIT 1`,
  ).bind(camera.id).first<{
    r2_key: string;
    sha256: string;
    visual_fingerprint: string | null;
    mean_luma: number | null;
    visual_contrast: number | null;
  }>();

  let key = latest?.r2_key;
  let duplicate = 0;
  let visualFingerprint: string | null = null;
  let meanLuma: number | null = null;
  let visualContrast: number | null = null;

  if (!latest || latest.sha256 !== sha256 || !key) {
    key = frameKey(camera.id, capturedAt, contentType);
    await env.HISTORY_BUCKET.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { cameraId: camera.id, capturedAt: String(capturedAt), sha256, processing: 'raw-passthrough' },
    });
  } else {
    duplicate = 1;
    visualFingerprint = latest.visual_fingerprint;
    meanLuma = latest.mean_luma;
    visualContrast = latest.visual_contrast;
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
    visualFingerprint,
    meanLuma,
    visualContrast,
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

export async function captureRawHistory(env: RawHistoryBindings, cameras: RawHistoryCamera[], scheduledAt = Date.now()): Promise<void> {
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
      console.error(JSON.stringify({ event: 'raw_history_capture_error', camera: camera.id, message: error instanceof Error ? error.message : String(error) }));
    }
  });

  console.log(JSON.stringify({ event: 'raw_history_capture_complete', bucket, selected: selected.length, stored, duplicate, failed }));
}
