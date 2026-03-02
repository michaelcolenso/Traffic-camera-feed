# Deploy the Worker

## Step 1: Deploy
```bash
cd workers/video-proxy
npx wrangler deploy
```

You'll see output like:
```
✨ Successfully published your script to:
 https://seattle-traffic-video.YOUR_SUBDOMAIN.workers.dev
```

Copy that URL.

## Step 2: Test the Worker
Open this URL in a browser:
```
https://seattle-traffic-video.YOUR_SUBDOMAIN.workers.dev/?url=/live/3_Union_EW.stream/playlist.m3u8
```

You should see text starting with `#EXTM3U`. If you see HTML or an error, the worker isn't working.

## Step 3: Update App Config
Edit `src/config.ts` and set:
```ts
export const VIDEO_PROXY_URL = 'https://seattle-traffic-video.YOUR_SUBDOMAIN.workers.dev';
```

## Step 4: Rebuild and Deploy App
```bash
npm run build
git add -A
git commit -m "update video proxy URL"
git push
```
