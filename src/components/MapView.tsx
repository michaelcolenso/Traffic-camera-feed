import { lazy, Suspense } from 'react';
import { TrafficCamera } from '../types';
import { CameraHealth } from '../lib/cameras';

const LazyMapViewImpl = lazy(() =>
  import('./MapViewImpl').then((module) => ({ default: module.MapViewImpl })),
);

interface MapViewProps {
  cameras: TrafficCamera[];
  healthByCamera?: Record<string, CameraHealth>;
  onFocus?: (camera: TrafficCamera) => void;
}

export function MapView(props: MapViewProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-84px)] items-center justify-center">
          <div className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 px-4 py-3 text-xs uppercase tracking-[0.2em] text-cyan-200/80 shadow-[0_0_24px_rgba(41,216,255,0.18)]">
            Loading map engine...
          </div>
        </div>
      }
    >
      <LazyMapViewImpl {...props} />
    </Suspense>
  );
}
