import { chromium } from 'playwright';

const base = process.env.VANILLA_URL;
if (!base) throw new Error('VANILLA_URL is required');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  check(await page.locator('.camera-card').count() >= 6, 'initial camera cards missing');
  check(await page.locator('#collections [data-collection]').count() === 7, 'camera collections missing');

  await page.locator('#search').fill('bridge');
  await page.waitForTimeout(150);
  check(new URL(page.url()).searchParams.get('q') === 'bridge', 'search URL state missing');

  await page.locator('[data-collection="live"]').click();
  check((new URL(page.url()).searchParams.get('collections') || '').includes('live'), 'collection URL state missing');

  await page.locator('#search').fill('');
  await page.locator('[data-clear-collections]').click();
  await page.locator('.camera-open').first().click();
  check(await page.locator('#modal[open]').count() === 1, 'focus modal did not open');
  await page.locator('#close').click();

  await page.locator('#map-view').click();
  check(new URL(page.url()).searchParams.get('view') === 'map', 'map URL state missing');
  check(await page.locator('#map').isVisible(), 'map shell missing');
  await page.locator('#grid-view').click();

  await page.locator('#settings-toggle').click();
  check(await page.locator('#settings').isVisible(), 'source settings missing');

  const api = await page.request.get(`${base}/api/cameras?source=sdot`);
  check(api.ok(), 'SDOT fallback endpoint failed');

  const bootstrap = await page.evaluate(() => window.__CAMERAS__ || []);
  if (bootstrap[0]?.imagePath) {
    const image = await page.request.get(`${base}/api/image?path=${encodeURIComponent(bootstrap[0].imagePath)}&w=480`);
    check(image.status() !== 400, 'image proxy rejected a bootstrap camera path');
  } else {
    failures.push('bootstrap camera image path missing');
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Feature parity checks passed');
