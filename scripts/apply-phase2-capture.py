from pathlib import Path
import re

history_path = Path('prototype/vanilla/history.ts')
source = history_path.read_text()

source = source.replace(
"""export type HistoryCamera = {
  id: string;
  label: string;
  imagePath: string;
};""",
"""export type HistoryCamera = {
  id: string;
  label: string;
  imagePath: string;
  lat?: number;
  lng?: number;
};"""
)

source = source.replace(
"""export type HistoryBindings = {
  HISTORY_DB?: HistoryD1Database;
  HISTORY_BUCKET?: HistoryR2Bucket;
};""",
"""type ImagesOutput = { response: () => Response };
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
};"""
)

source = source.replace(
"function hasBindings(env: HistoryBindings): env is Required<HistoryBindings> {\n  return Boolean(env.HISTORY_DB && env.HISTORY_BUCKET);\n}",
"function hasBindings(env: HistoryBindings): env is ReadyHistoryBindings {\n  return Boolean(env.HISTORY_DB && env.HISTORY_BUCKET);\n}"
)

marker = "const MAX_HISTORY_LIMIT = 288;"
helper = r'''

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
'''
if helper.strip() not in source:
    source = source.replace(marker, marker + helper)

capture = r'''async function captureOne(env: ReadyHistoryBindings, camera: HistoryCamera, capturedAt: number): Promise<'stored' | 'duplicate'> {
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
'''
source, count = re.subn(r"async function captureOne\([\s\S]*?\n}\n\n(?=async function mapLimit)", capture + "\n", source, count=1)
if count != 1:
    raise SystemExit('captureOne replacement failed')

source = source.replace(
"SELECT captured_at, r2_key, sha256, bytes, is_duplicate\n       FROM camera_snapshots",
"SELECT captured_at, r2_key, sha256, bytes, is_duplicate, visual_fingerprint, mean_luma, visual_contrast\n       FROM camera_snapshots"
)
source = source.replace(
".all<{ captured_at: number; r2_key: string; sha256: string; bytes: number; is_duplicate: number }>();",
".all<{ captured_at: number; r2_key: string; sha256: string; bytes: number; is_duplicate: number; visual_fingerprint: string | null; mean_luma: number | null; visual_contrast: number | null }>();"
)
source = source.replace(
"""    bytes: row.bytes,
    duplicate: Boolean(row.is_duplicate),""",
"""    bytes: row.bytes,
    duplicate: Boolean(row.is_duplicate),
    visual: row.visual_fingerprint ? {
      meanLuma: row.mean_luma,
      contrast: row.visual_contrast,
    } : null,"""
)

history_path.write_text(source)

benchmark = Path('prototype/vanilla/public/benchmark.js')
js = benchmark.read_text()
phase2_import = "\nimport('/phase2.js').catch(()=>{});\n"
if phase2_import.strip() not in js:
    benchmark.write_text(js.rstrip() + phase2_import)
