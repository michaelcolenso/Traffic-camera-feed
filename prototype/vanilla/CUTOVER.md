# Production Cutover Plan

## What changes on merge

The root `wrangler.jsonc` becomes the production switch. It keeps the existing Worker name and `cams.hoxel.dev` custom domain, but points `main` at `prototype/vanilla/worker.ts` and `prototype/vanilla/public` rather than the React/Vite `dist` bundle.

The existing React application, source files, Vite configuration, and dependencies remain in the repository during the initial cutover window. This intentionally makes rollback a Git revert rather than a rebuild or reconstruction project.

## Pre-merge gates

Do not merge unless the branch is green on all of these:

1. `npm ci`
2. existing TypeScript check (`npm run lint`)
3. Wrangler production/prototype configuration type generation
4. isolated Workers deployment
5. root/asset/API smoke test
6. Playwright feature-parity regression suite
7. three same-runner mobile Lighthouse runs against production React and the replacement
8. replacement budget: performance >=95 minimum, median LCP <=2.5s, median TBT <=100ms, max CLS <=0.05, accessibility >=98

The feature-parity benchmark recorded in `BENCHMARK.md` passed at 100 / 99 / 99 performance, 0ms TBT, 0 CLS, and 100 accessibility.

## Merge and deployment sequence

1. Merge the cutover PR to `main`.
2. `.github/workflows/deploy-cloudflare.yml` validates TypeScript and the production Wrangler configuration.
3. Wrangler deploys the existing `hoxel-traffic-camera-feed` Worker to the existing `cams.hoxel.dev` custom-domain route.
4. The production smoke test waits for the edge-rendered HTML, enhancement JS, and ArcGIS camera API to be live together.
5. The smoke test validates a real transformed camera image and the expected validation behavior of the image/video routes.
6. Live HLS is probed separately as a nonfatal external dependency.
7. The existing post-deploy performance audit runs against `cams.hoxel.dev` after deployment.

## Immediate verification

Confirm these production behaviors after the deployment job is green:

- initial camera grid renders without a client-side loading shell
- search and collections update the URL
- camera focus opens and navigation works
- map mode loads only when selected
- a camera with `videoUrl` can attempt playback
- source settings open and ArcGIS remains the default
- `/api/cameras?source=arcgis` returns current cameras
- camera snapshots are served through `/api/image`
- mobile grid/map/source dock is usable

## Rollback

If a production regression appears:

1. Revert the cutover merge commit on `main`.
2. Allow the standard production deploy workflow to redeploy the restored root `wrangler.jsonc` and React/Vite assets.
3. Confirm the React root marker and API smoke tests from the reverted workflow/configuration.

No data migration, database migration, DNS change, or route recreation is required for rollback.

## Cleanup after a stable window

Do not remove the React stack in the cutover PR. After the replacement has been stable in production, make cleanup a separate PR that removes React, React DOM, SWR, Motion, Lucide React, Vite React integration, obsolete components/services, and the old build path. Keeping cleanup separate makes the architecture change easy to review and easy to revert.
