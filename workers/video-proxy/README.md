# Seattle Traffic Video Proxy

Cloudflare Worker to bypass CORS for Seattle traffic camera HLS streams.

## Setup

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   npx wrangler login
   ```

3. Deploy:
   ```bash
   npx wrangler deploy
   ```

4. Note the worker URL (e.g., `https://seattle-traffic-video-proxy.YOUR_SUBDOMAIN.workers.dev`)

## Configuration

Update `ALLOWED_ORIGINS` in `index.js` with your domain:
- For GitHub Pages: `https://YOUR_USERNAME.github.io`
- For custom domain: `https://yourdomain.com`

## Usage

The worker proxies requests to `video.seattle.gov`:

```
https://your-worker.workers.dev/?url=/live/STREAM_NAME.stream/playlist.m3u8
```

This becomes:
```
https://video.seattle.gov/live/STREAM_NAME.stream/playlist.m3u8
```

With CORS headers added.
