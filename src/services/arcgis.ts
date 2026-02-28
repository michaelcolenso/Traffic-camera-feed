import { TrafficCamera } from '../types';

// Seattle City GIS traffic cameras Feature Service
// https://data-seattlecitygis.opendata.arcgis.com/datasets/SeattleCityGIS::traffic-cameras
export const ARCGIS_FEATURE_SERVICE_URL =
  'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_TrafficCameras/FeatureServer/0';

interface ArcGISFeature {
  type: 'Feature';
  id?: number | string;
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  } | null;
  properties: Record<string, unknown>;
}

interface ArcGISGeoJSON {
  type: 'FeatureCollection';
  features: ArcGISFeature[];
}

/** Case-insensitive lookup for a string URL property among common field name variants. */
function findUrl(
  props: Record<string, unknown>,
  candidates: string[],
): string {
  for (const candidate of candidates) {
    const key = Object.keys(props).find(
      (k) => k.toLowerCase() === candidate.toLowerCase(),
    );
    if (key && typeof props[key] === 'string') {
      const val = props[key] as string;
      if (val.startsWith('http')) return val;
    }
  }
  return '';
}

/** Case-insensitive lookup for any string property. */
function findString(
  props: Record<string, unknown>,
  candidates: string[],
): string {
  for (const candidate of candidates) {
    const key = Object.keys(props).find(
      (k) => k.toLowerCase() === candidate.toLowerCase(),
    );
    if (key && typeof props[key] === 'string' && props[key]) {
      return props[key] as string;
    }
  }
  return '';
}

function mapFeature(feature: ArcGISFeature): TrafficCamera | null {
  const { properties: props, geometry } = feature;

  // Coordinates — prefer geometry, fall back to explicit lat/lng fields
  const lng =
    geometry?.coordinates[0]?.toString() ??
    findString(props, ['longitude', 'lon', 'long', 'x']);
  const lat =
    geometry?.coordinates[1]?.toString() ??
    findString(props, ['latitude', 'lat', 'y']);

  if (!lat || !lng) return null;

  const label =
    findString(props, [
      'cameralabel',
      'camera_label',
      'label',
      'name',
      'description',
      'camera_name',
      'title',
    ]) || `Camera ${feature.id ?? ''}`;

  // ArcGIS Hub stores the SDOT nested JSON fields as plain strings or nested objects
  // Try both flat and nested patterns
  const rawImageUrl =
    findUrl(props, ['imageurl', 'image_url', 'imagelink', 'photo_url', 'snapshot_url']) ||
    (() => {
      const nested = props['imageurl'];
      if (nested && typeof nested === 'object') {
        return (nested as { url?: string }).url ?? '';
      }
      return '';
    })();

  if (!rawImageUrl) return null;

  const rawVideoUrl =
    findUrl(props, ['video_url', 'videourl', 'stream_url', 'hls_url', 'hlsurl']) ||
    (() => {
      const nested = props['video_url'];
      if (nested && typeof nested === 'object') {
        return (nested as { url?: string }).url ?? '';
      }
      return '';
    })();

  const rawWebUrl =
    findUrl(props, ['web_url', 'weburl', 'link', 'url']) ||
    (() => {
      const nested = props['web_url'];
      if (nested && typeof nested === 'object') {
        return (nested as { url?: string }).url ?? '';
      }
      return '';
    })();

  const xCoord = findString(props, ['x_coord', 'xcoord', 'x']) || lng;
  const yCoord = findString(props, ['y_coord', 'ycoord', 'y']) || lat;

  return {
    cameralabel: label,
    imageurl: { url: rawImageUrl },
    video_url: rawVideoUrl ? { url: rawVideoUrl } : undefined,
    web_url: rawWebUrl ? { url: rawWebUrl } : undefined,
    x_coord: xCoord,
    y_coord: yCoord,
    location: { latitude: lat, longitude: lng },
  };
}

export async function fetchArcGISCameras(
  featureServiceUrl: string,
): Promise<TrafficCamera[]> {
  const queryUrl = `${featureServiceUrl}/query?where=1%3D1&outFields=*&f=geojson`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(queryUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `ArcGIS API error: ${response.status} ${response.statusText}`,
      );
    }
    const data: ArcGISGeoJSON = await response.json();
    return data.features
      .map(mapFeature)
      .filter((c): c is TrafficCamera => c !== null);
  } finally {
    clearTimeout(timeoutId);
  }
}
