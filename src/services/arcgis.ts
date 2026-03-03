import { TrafficCamera } from '../types';
import { getVideoUrl } from '../config';

// Seattle City GIS traffic cameras Feature Service (CDL = Camera Data Layer)
// https://data-seattlecitygis.opendata.arcgis.com/datasets/SeattleCityGIS::traffic-cameras
export const ARCGIS_FEATURE_SERVICE_URL =
  'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/ArcGIS/rest/services/Traffic_Cameras_CDL/FeatureServer/0';

interface ArcGISFeature {
  type: 'Feature';
  id?: number | string;
  geometry: {
    x: number; // longitude
    y: number; // latitude
  } | null;
  attributes: Record<string, unknown>;
}

interface ArcGISResponse {
  features: ArcGISFeature[];
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Construct HLS video stream URL from stream name.
 * Seattle uses: https://video.seattle.gov/live/{STREAM_NAME}.stream/playlist.m3u8
 * Routes through CORS proxy if configured.
 */
function buildVideoUrl(streamName: string | null | undefined): string | undefined {
  if (!streamName) return undefined;
  // Clean up the stream name
  const cleanName = String(streamName).trim();
  if (!cleanName) return undefined;
  return getVideoUrl(`/live/${cleanName}.stream/playlist.m3u8`);
}

/**
 * Build SDOT web page URL for the camera.
 * SDOT traveler map uses: https://web6.seattle.gov/travelers/
 */
function buildWebUrl(cameraName: string | null | undefined): string | undefined {
  // For now, link to the main travelers map
  // Individual camera URLs would need specific camera IDs
  return 'https://web6.seattle.gov/travelers/';
}

function mapFeature(feature: ArcGISFeature): TrafficCamera | null {
  const { attributes: attrs, geometry } = feature;

  // Skip inactive cameras
  const status = String(attrs['SERVSTAT'] || '').toUpperCase();
  if (status === 'INACT' || status === 'INACTIVE') {
    return null;
  }

  // Get coordinates from geometry (WGS84)
  const lng = geometry?.x;
  const lat = geometry?.y;

  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return null;
  }

  // Camera name/label
  const name = String(attrs['NAME'] || '').replace('.jpg', '');
  const location = String(attrs['LOCATION'] || '');
  const label = location || name || `Camera ${feature.id ?? ''}`;

  // Image URL - force HTTPS to avoid mixed content and CORS issues
  let imageUrl = String(attrs['URL'] || '');
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return null;
  }
  // Upgrade HTTP to HTTPS
  imageUrl = imageUrl.replace(/^http:\/\//, 'https://');

  // Video stream URL
  const streamName = attrs['STREAM_NAME'];
  const videoUrl =
    typeof streamName === 'string'
      ? buildVideoUrl(streamName)
      : streamName == null
        ? undefined
        : buildVideoUrl(String(streamName));

  // Web URL
  const webUrl = buildWebUrl(name);

  return {
    cameralabel: label,
    imageurl: { url: imageUrl },
    video_url: videoUrl ? { url: videoUrl } : undefined,
    web_url: webUrl ? { url: webUrl } : undefined,
    x_coord: String(lng),
    y_coord: String(lat),
    location: { latitude: String(lat), longitude: String(lng) },
  };
}

export async function fetchArcGISCameras(
  featureServiceUrl: string,
): Promise<TrafficCamera[]> {
  // Query with outSR=4326 to get WGS84 (lat/lng) coordinates
  const queryUrl = `${featureServiceUrl}/query?where=1%3D1&outFields=*&outSR=4326&f=json`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(queryUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `ArcGIS API error: ${response.status} ${response.statusText}`,
      );
    }
    const data: ArcGISResponse = await response.json();
    
    if (data.error) {
      throw new Error(`ArcGIS API error: ${data.error.message}`);
    }
    
    return data.features
      .map(mapFeature)
      .filter((c): c is TrafficCamera => c !== null);
  } finally {
    clearTimeout(timeoutId);
  }
}
