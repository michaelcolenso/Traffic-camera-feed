import { TrafficCamera } from '../types';

const API_ENDPOINT = 'https://data.seattle.gov/resource/65fc-btcc.json';
const FETCH_TIMEOUT_MS = 10_000;

export async function fetchCameras(): Promise<TrafficCamera[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(API_ENDPOINT, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch cameras: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
