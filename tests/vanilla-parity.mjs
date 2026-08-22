import fs from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.VANILLA_URL;
if (!base) throw new Error('VANILLA_URL is required');
fs.mkdirSync('test-artifacts', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

await page.addInitScript(() => {
  class HlsStub {
    static Events = { ERROR: 'error' };
    static isSupported() { return true; }
    loadSource() {}
    attachMedia() {}
    on() {}
    destroy() {}
  }
  window.Hls = HlsStub;
  HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function pause() {};
  HTMLMediaElement.prototype.load = function load() {};
});

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  check(await page.locator('.camera-card').count() >= 6, 'initial camera cards missing');
  check(await page.locator('#collections [data-collection]').count() >= 6, 'camera collections missing');
  check(await page.locator('[data-live-grid]').count() === 1, 'Live Grid toggle missing');
  check(!(await page.locator('#settings-toggle').isVisible()), 'desktop Settings control should be hidden on mobile');
  check(await page.locator('#mobile-settings').isVisible(), 'mobile Source control missing');
  await page.screenshot({ path: 'test-artifacts/mobile-grid.png', fullPage: true });

  const bootstrap = await page.evaluate(() => window.__CAMERAS__ || []);
  check(bootstrap.length > 0, 'bootstrap camera data missing');
  check(bootstrap.every((camera) => Array.isArray(camera.collections)), 'canonical camera collections missing from bootstrap payload');
  check(!bootstrap.some((camera) => /\b35th\b/i.test(camera.label) && camera.collections.includes('downtown')), '35th camera misclassified as Downtown');
  const i5Count = bootstrap.filter((camera) => camera.collections.includes('i5')).length;
  check((await page.locator('[data-collection="i5"]').count() > 0) === (i5Count > 0), 'I-5 collection visibility does not match canonical camera data');

  await page.locator('#search').fill('bridge');
  await page.waitForTimeout(150);
  check(new URL(page.url()).searchParams.get('q') === 'bridge', 'search URL state missing');

  await page.locator('[data-collection="live"]').click();
  check((new URL(page.url()).searchParams.get('collections') || '').includes('live'), 'collection URL state missing');

  await page.locator('#search').fill('');
  await page.locator('[data-clear-collections]').click();

  const manualPlay = page.locator('[data-grid-play]').first();
  if (await manualPlay.count()) {
    await manualPlay.click();
    await page.waitForTimeout(50);
    check(await page.locator('.camera-card.is-live .grid-video').count() === 1, 'manual in-grid live playback did not start');
    check(await manualPlay.getAttribute('aria-label')?.then((value) => value?.startsWith('Stop')), 'manual live button did not switch to stop state');
    await manualPlay.click();
    await page.waitForTimeout(20);
    check(await page.locator('.camera-card.is-live .grid-video').count() === 0, 'manual in-grid live playback did not stop');
  } else {
    failures.push('no live-capable grid card available for manual playback test');
  }

  await page.locator('[data-collection="live"]').click();
  await page.waitForTimeout(100);
  await page.locator('[data-live-grid]').click();
  await page.waitForTimeout(180);
  const autoVideos = page.locator('.camera-card.is-live .grid-video');
  const autoCount = await autoVideos.count();
  check(autoCount > 0, 'Live Grid did not start any visible streams');
  check(autoCount <= 4, `Live Grid exceeded four-stream cap (${autoCount})`);
  check(await page.locator('[data-live-grid]').getAttribute('aria-pressed') === 'true', 'Live Grid pressed state missing');
  if (autoCount) {
    check(await autoVideos.first().evaluate((video) => video.muted && video.playsInline), 'Live Grid video is not muted and inline');
    check(await autoVideos.first().evaluate((video) => (video.closest('.camera-card')?.getBoundingClientRect().top ?? Infinity) <= innerHeight + 720), 'Live Grid started outside viewport prewarm window');
  }
  await page.locator('[data-live-grid]').click();
  await page.waitForTimeout(30);
  check(await page.locator('.camera-card.is-live .grid-video').count() === 0, 'Live Grid auto streams did not stop when disabled');
  await page.locator('[data-clear-collections]').click();

  await page.locator('.camera-image-open').first().click();
  check(await page.locator('#modal[open]').count() === 1, 'camera image did not open focus modal');
  const firstFocused = new URL(page.url()).searchParams.get('camera');
  await page.screenshot({ path: 'test-artifacts/mobile-focus.png', fullPage: true });
  await page.locator('#modal [data-focus]').filter({ hasText: 'Next' }).click();
  const nextFocused = new URL(page.url()).searchParams.get('camera');
  check(await page.locator('#modal[open]').count() === 1, 'focus modal closed during next-camera navigation');
  check(Boolean(nextFocused) && nextFocused !== firstFocused, 'next-camera navigation did not update focus URL state');
  await page.locator('#close').click();

  await page.locator('[data-mobile-view="map"]').click();
  check(new URL(page.url()).searchParams.get('view') === 'map', 'map URL state missing');
  check(await page.locator('#map').isVisible(), 'map shell missing');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-artifacts/mobile-map.png', fullPage: true });
  await page.locator('[data-mobile-view="grid"]').click();

  await page.locator('#mobile-settings').click();
  check(await page.locator('#settings').isVisible(), 'source settings missing');
  check(await page.locator('#settings-toggle').getAttribute('aria-expanded') === 'true', 'settings expanded state missing');

  // Verify the source switch behavior without making functional parity depend on
  // Seattle's live Socrata availability from the GitHub-hosted runner.
  await page.route('**/api/cameras?source=sdot**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bootstrap.slice(0, Math.max(6, Math.min(bootstrap.length, 12)))),
    });
  });
  await page.locator('#source-sdot').click();
  await page.locator('#apply-source').click();
  await page.waitForTimeout(100);
  check((await page.locator('#status-line').textContent())?.includes('SDOT Socrata'), 'SDOT source switch did not update the app');
  check(await page.locator('#settings-toggle').getAttribute('aria-expanded') === 'false', 'settings expanded state not cleared after apply');

  if (bootstrap[0]?.imagePath) {
    const image = await page.request.get(`${base}/api/image?path=${encodeURIComponent(bootstrap[0].imagePath)}&w=480`);
    check(image.status() !== 400, 'image proxy rejected a bootstrap camera path');
  } else {
    failures.push('bootstrap camera image path missing');
  }

  // The real endpoint must exist and return either current data or the explicit
  // upstream-unavailable response; a missing/broken route is still a failure.
  await page.unroute('**/api/cameras?source=sdot**');
  const realSdot = await page.request.get(`${base}/api/cameras?source=sdot`);
  check([200, 503].includes(realSdot.status()), `unexpected SDOT route status ${realSdot.status()}`);

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await desktop.goto(base, { waitUntil: 'networkidle' });
  check(await desktop.locator('#settings-toggle').isVisible(), 'desktop Settings control missing');
  check(await desktop.locator('#grid-view').isVisible(), 'desktop view toggle missing');
  await desktop.screenshot({ path: 'test-artifacts/desktop-grid.png', fullPage: true });
  await desktop.close();
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Feature parity checks passed');