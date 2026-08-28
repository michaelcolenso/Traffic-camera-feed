// Shared loader for the three design-direction mockups.
// Locally (screenshot harness) it reads /data.json; anywhere else it pulls the
// real catalog from the deployed worker so the mockups stand on their own.
const REMOTE = 'https://cams.hoxel.dev';

export async function loadCameras(limit) {
  try {
    const local = await fetch('/data.json');
    if (local.ok) return (await local.json()).slice(0, limit);
  } catch {}
  const res = await fetch(`${REMOTE}/api/cameras`);
  const all = await res.json();
  return all
    .filter((c) => c.imagePath)
    .slice(0, limit)
    .map((c) => ({
      label: c.label,
      img: `${REMOTE}/api/image?path=${encodeURIComponent(c.imagePath)}&w=480`,
      live: Boolean(c.videoUrl),
      lat: c.lat,
      lng: c.lng,
    }));
}

export function clockAt(minutesAgo) {
  const d = new Date(Date.now() - minutesAgo * 60000);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
