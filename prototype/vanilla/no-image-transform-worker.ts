import app from './worker';
import { purgeHistory, type HistoryBindings } from './history';
import { type PulseBindings } from './pulse';
import { captureRawHistory, type RawHistoryBindings, type RawHistoryCamera } from './raw-history';

const CAMERA_HOST = 'www.seattle.gov';
const CAMERA_PREFIX = '/trafficcams/images/';

async function rawImage(request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const path = url.searchParams.get('path');
  if (!path || !path.startsWith(CAMERA_PREFIX) || path.includes('..')) {
    return new Response('Bad image path', { status: 400 });
  }

  const upstream = new URL(path, `https://${CAMERA_HOST}`);
  const response = await fetch(upstream, {
    method: request.method,
    headers: { Accept: request.headers.get('Accept') || 'image/*,*/*;q=0.8' },
    cf: {
      cacheEverything: true,
      cacheTtl: 30,
    },
  } as RequestInit);

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');
  headers.set('X-Image-Processing', 'passthrough');
  headers.delete('Set-Cookie');
  return new Response(response.body, { status: response.status, headers });
}

type RuntimeEnv = Env & HistoryBindings & PulseBindings & RawHistoryBindings;

type ExecutionContextLike = {
  waitUntil(promise: Promise<void>): void;
};

type ScheduledControllerLike = {
  scheduledTime: number;
};

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/image') return rawImage(request, url);
    return app.fetch(request, env);
  },

  async scheduled(controller: ScheduledControllerLike, env: RuntimeEnv, ctx: ExecutionContextLike): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        const cameraResponse = await app.fetch(new Request('https://cams.hoxel.dev/api/cameras?source=arcgis'), env);
        if (!cameraResponse.ok) throw new Error(`camera catalog ${cameraResponse.status}`);
        const cameras = await cameraResponse.json() as RawHistoryCamera[];
        if (!Array.isArray(cameras) || cameras.length === 0) throw new Error('camera catalog was empty');
        await captureRawHistory(env, cameras, controller.scheduledTime);
        await purgeHistory(env, controller.scheduledTime);
      } catch (error) {
        console.error(JSON.stringify({ event: 'raw_history_tick_error', message: error instanceof Error ? error.message : String(error) }));
      }
    })());
  },
};
