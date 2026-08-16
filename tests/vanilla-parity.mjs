import fs from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.VANILLA_URL;
if (!base) throw new Error('VANILLA_URL is required');
fs.mkdirSync('test-artifacts', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  check(await page.locator('.camera-card').count() >= 6, 'initial camera cards missing');
  check(await page.locator('#collections [data-collection]').count() === 7, 'camera collections missing');
  await page.screenshot({ path: 'test-artifacts/mobile-grid.png', fullPage: true });

  await page.locator('#search').fill('bridge');
  await page.waitForTimeout(150);
  check(new URL(page.url()).searchParams.get('q') === 'bridge', 'search URL state missing');

  await page.locator('[data-collection="live"]').click();
  check((new URL(page.url()).searchParams.get('collections') || '').includes('live'), 'collection URL state missing');

  await page.locator('#search').fill('');
  await page.locator('[data-clear-collections]').click();
  await page.locator('.camera-open').first().click();
  check(await page.locator('#modal[open]').count() === 1, 'focus modal did not open');
  const firstFocused = new URL(page.url()).searchParams.get('camera');
  await page.screenshot({ path: 'test-artifacts/mobile-focus.png', fullPage: true });
  await page.locator('#modal [data-focus]').filter({ hasText: 'Next' }).click();
  const nextFocused = new URL(page.url()).searchParams.get('camera');
  check(await page.locator('#modal[open]').count() === 1, 'focus modal closed during next-camera navigation');
  check(Boolean(nextFocused) && nextFocused !== firstFocused, 'next-camera navigation did not update focus URL state');
  await page.locator('#close').click();

  await page.locator('#map-view').click();
  check(new URL(page.url()).searchParams.get('view') === 'map', 'map URL state missing');
  check(await page.locator('#map').isVisible(), 'map shell missing');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-artifacts/mobile-map.png', fullPage: true });
  await page.locator('#grid-view').click();

  await page.locator('#settings-toggle').click();
  check(await page.locator('#settings').isVisible(), 'source settings missing');
  check(await page.locator('#settings-toggle').getAttribute('aria-expanded') === 'true', 'settings expanded state missing');

  const bootstrap = await page.evaluate(() => window.__CAMERAS__ || []);
  check(bootstrap.length > 0, 'bootstrap camera data missing');

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
