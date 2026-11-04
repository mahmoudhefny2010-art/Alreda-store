/* global document, innerWidth */
// Local lab only: explicitly disable real accounts, databases and provider credentials.
Object.assign(process.env, { DATABASE_URL: '', DIRECT_URL: '', DATABASE_REQUIRED: 'false', CHECKOUT_ENABLED: 'false',
  CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '', MEDIA_PUBLIC_MANIFEST: 'false' });
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { createApp } = require('../../src/app');
const catalog = require('../../src/config/catalog.json');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function main() {
  const app = createApp({ environment: 'production', authSettings: {}, mediaSettings: {}, whatsappSettings: {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      for (const route of ['/', '/collections/mirrors', `/products/${catalog.products[0].slug}`]) {
        const runs = [];
        for (let run = 0; run < 3; run++) {
          const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
          try {
            await context.route('**/*', request => new URL(request.request().url()).origin === origin ? request.continue() : request.abort());
            const page = await context.newPage();
            await page.goto(origin + route, { waitUntil: 'networkidle' });
            const metrics = await page.evaluate(() => {
              const entries = performance.getEntriesByType('resource');
              const navigation = performance.getEntriesByType('navigation')[0];
              const css = entries.filter(entry => new URL(entry.name).pathname.startsWith('/assets/css/'));
              return { ttfbMs: navigation.responseStart, domReadyMs: navigation.domContentLoadedEventEnd,
                transferredBytes: navigation.transferSize + entries.reduce((total, entry) => total + entry.transferSize, 0),
                cssRequests: css.length, cssDecodedBytes: css.reduce((total, entry) => total + entry.decodedBodySize, 0),
                requests: entries.length + 1, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
            });
            runs.push(metrics);
            if (run === 0) {
              await fs.mkdir(path.resolve('test-results/performance'), { recursive: true });
              const welcome = page.locator('[data-welcome-dialog]');
              if (await welcome.isVisible()) await welcome.locator('[data-welcome-close]').click();
              await page.screenshot({ path: path.resolve(`test-results/performance/${viewport.width}-${results.length}.png`) });
            }
          } finally { await context.close(); }
        }
        const summary = Object.fromEntries(['ttfbMs', 'domReadyMs', 'transferredBytes', 'cssRequests', 'cssDecodedBytes', 'requests'].map(key => [key, median(runs.map(run => run[key]))]));
        results.push({ viewport, route, median: summary, runs });
      }
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  const report = { conditions: 'Loopback, local snapshot, production app settings, cold browser cache per run, warm app process, service workers blocked, external services disabled; no production latency/field-vitals claim.', results };
  await fs.mkdir(path.resolve('test-results/performance'), { recursive: true });
  await fs.writeFile(path.resolve('test-results/performance/local-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.info(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('LOCAL_PERFORMANCE_CHECK_FAILED'); process.exitCode = 1; });
