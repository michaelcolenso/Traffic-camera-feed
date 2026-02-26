import { TrafficCamera } from '../types';

const API_ENDPOINT = 'https://data.seattle.gov/resource/65fc-btcc.json';

export async function fetchCameras(): Promise<TrafficCamera[]> {
  const response = await fetch(API_ENDPOINT);
  if (!response.ok) {
    throw new Error('Failed to fetch cameras');
  }
  return response.json();
}
