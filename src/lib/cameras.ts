import { TrafficCamera } from '../types';

export type CollectionId = 'live' | 'downtown' | 'bridges' | 'i5' | 'aurora' | 'recent' | 'issues';

export interface CameraHealth {
  lastImageRefresh?: number;
  lastImageError?: number;
  lastStreamError?: number;
}

export interface CameraCollection {
  id: CollectionId;
  label: string;
  description: string;
  matches: (camera: TrafficCamera, health?: CameraHealth) => boolean;
}

const corridorKeywords: Record<Exclude<CollectionId, 'live' | 'recent' | 'issues'>, string[]> = {
  downtown: ['downtown', '5th', '4th', '3rd', '2nd', '1st', 'pike', 'pine', 'union', 'madison', 'james'],
  bridges: ['bridge', 'fremont', 'ballard', 'montlake', 'spokane', 'west seattle', 'university'],
  i5: ['i-5', 'i5', 'interstate 5'],
  aurora: ['aurora', 'sr 99', 'sr99', '99'],
};

export function getCameraId(camera: TrafficCamera): string {
  const raw = camera.web_url?.url || camera.video_url?.url || camera.imageurl?.url || camera.cameralabel;
  return encodeURIComponent(raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || camera.cameralabel);
}

export function getCameraCoordinates(camera: TrafficCamera): { lat: number; lng: number } | null {
  const lat = Number(camera.location?.latitude);
  const lng = Number(camera.location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function cameraMatchesQuery(camera: TrafficCamera, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return camera.cameralabel.toLowerCase().includes(normalized);
}

function labelIncludes(camera: TrafficCamera, words: string[]): boolean {
  const label = camera.cameralabel.toLowerCase();
  return words.some((word) => label.includes(word));
}

export const cameraCollections: CameraCollection[] = [
  {
    id: 'live',
    label: 'Live streams',
    description: 'Cameras with a playable video stream.',
    matches: (camera) => Boolean(camera.video_url?.url),
  },
  {
    id: 'downtown',
    label: 'Downtown',
    description: 'Likely downtown intersections based on camera labels.',
    matches: (camera) => labelIncludes(camera, corridorKeywords.downtown),
  },
  {
    id: 'bridges',
    label: 'Bridges',
    description: 'Bridge approaches and named bridge cameras.',
    matches: (camera) => labelIncludes(camera, corridorKeywords.bridges),
  },
  {
    id: 'i5',
    label: 'I-5',
    description: 'Interstate 5 corridor cameras.',
    matches: (camera) => labelIncludes(camera, corridorKeywords.i5),
  },
  {
    id: 'aurora',
    label: 'Aurora / 99',
    description: 'Aurora Avenue and SR-99 cameras.',
    matches: (camera) => labelIncludes(camera, corridorKeywords.aurora),
  },
  {
    id: 'recent',
    label: 'Recently refreshed',
    description: 'Cameras that successfully refreshed within the last minute.',
    matches: (_camera, health) => Boolean(health?.lastImageRefresh && Date.now() - health.lastImageRefresh < 60_000),
  },
  {
    id: 'issues',
    label: 'Signal issues',
    description: 'Cameras with recent image or stream failures.',
    matches: (_camera, health) => Boolean(health?.lastImageError || health?.lastStreamError),
  },
];

export function filterCameras(
  cameras: TrafficCamera[],
  query: string,
  activeCollections: CollectionId[],
  healthByCamera: Record<string, CameraHealth>,
): TrafficCamera[] {
  return cameras.filter((camera) => {
    if (!camera.imageurl?.url || !cameraMatchesQuery(camera, query)) return false;
    return activeCollections.every((id) => {
      const collection = cameraCollections.find((c) => c.id === id);
      return collection ? collection.matches(camera, healthByCamera[getCameraId(camera)]) : true;
    });
  });
}

export function getNearbyCameras(camera: TrafficCamera, cameras: TrafficCamera[], limit = 4): TrafficCamera[] {
  const origin = getCameraCoordinates(camera);
  if (!origin) return [];
  return cameras
    .filter((candidate) => getCameraId(candidate) !== getCameraId(camera))
    .map((candidate) => {
      const coords = getCameraCoordinates(candidate);
      if (!coords) return null;
      const distance = Math.hypot(coords.lat - origin.lat, coords.lng - origin.lng);
      return { candidate, distance };
    })
    .filter((entry): entry is { candidate: TrafficCamera; distance: number } => entry !== null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}
