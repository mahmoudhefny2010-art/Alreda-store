/* global document, innerWidth */
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createApp } = require('../../src/app');
const repository = require('../../src/services/catalog.repository');
const { getDatabaseProduct } = require('../../src/services/product.service');
const { productDescription } = require('../../src/utils/productDescription');
const { disconnectDatabase } = require('../../src/config/prisma');
const output = path.resolve(__dirname, '../../test-results/product-details-source');
fs.mkdirSync(path.join(output, 'tmp'), { recursive: true });
Object.assign(process.env, { TMP: path.join(output, 'tmp'), TEMP: path.join(output, 'tmp'), TMPDIR: path.join(output, 'tmp') });
const { chromium } = require('playwright');
let server; let browser; let stage = 'database';
async function main() {
  const data = await repository.getDatabaseCatalog();
  assert(data.persistent, 'Use the real persistent product repository');
  const products = data.catalog.products;
  const cases = [
    { name: 'desktop-mixed-en', locale: 'en', width: 1440, product: products.find(item => item.slug === 'delight-bathroom-accessories-pieces-stainless-304-black') },
    { name: 'mobile-manual-en', locale: 'en', width: 390, product: products.find(item => item.slug === 'round-column-stainless-ashtray') },
    { name: 'mobile-manual-ar', locale: 'ar', width: 390, product: products.find(item => item.slug === 'safe-box-17cm') },
  ];
  for (const product of products) for (const locale of ['en', 'ar']) {
    const details = productDescription(product, locale);
    assert(details.html && !details.originalLanguage, 'All persistent product descriptions must be available in both languages');
  }
  server = createApp({ environment: 'test', logger: { error: () => {} } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  stage = 'browser-launch';
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  let checks = 0;
  for (const item of cases) {
    stage = item.name;
    assert(item.product);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: item.width, height: 900 }, isMobile: item.width === 390, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'alreda_locale', value: item.locale, url: origin }]);
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', () => errors.push('browser-script-error'));
    const response = await page.goto(`${origin}/products/${encodeURIComponent(item.product.slug)}`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    const expected = (await getDatabaseProduct(item.product.slug, { locale: item.locale })).product;
    const content = page.locator('.product-description-content');
    assert(await content.isVisible());
    assert.equal(await content.getAttribute('lang'), expected.descriptionLanguage);
    assert.equal(await content.getAttribute('dir'), expected.descriptionLanguage === 'ar' ? 'rtl' : 'ltr');
    assert(await page.evaluate(html => {
      const container = document.createElement('div'); container.innerHTML = html;
      return document.querySelector('.product-description-content').innerHTML === container.innerHTML;
    }, expected.descriptionHtml), 'Every sanitized source paragraph, list and table must render');
    assert.equal(await page.locator('.source-description-note').count(), expected.originalDescription ? 1 : 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await content.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${item.name}.png`) });
    assert.deepEqual(errors, []); checks++;
    await context.close();
  }
  console.info(JSON.stringify({ passed: true, persistentProductPages: checks, desktopAndMobile: true, completeSourceHtml: true,
    localeAndDirection: true, originalLanguageNotice: true, horizontalOverflow: false, customerOrdersCreated: 0 }));
}
main().catch(error => { console.error(JSON.stringify({ failure: 'PRODUCT_DETAILS_BROWSER_CHECK_FAILED', stage, type: error.name, code: error.code || null })); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await disconnectDatabase();
});
