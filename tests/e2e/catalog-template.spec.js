const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { getProductFromData } = require('../../src/services/product.service');
const { productCard } = require('../../src/utils/productPreview');
const { translate } = require('../../src/config/storefront-i18n');
const source = require('../../src/config/catalog.json').products.find(item => /Bathroom Accessories 89 Black/i.test(item.name));

for (const width of [1440, 390]) {
  test(`new products inherit the shared gallery and card layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    // An unknown product identity proves the template does not depend on imported IDs.
    const record = { ...structuredClone(source), id: undefined, sourceId: 'new-template-fixture', slug: 'new-template-fixture', name: 'New bathroom accessories', titleEn: 'New bathroom accessories', collectionIds: [] };
    const data = { bySlug: new Map([[record.slug, record]]), categories: [], byCategory: new Map(), catalog: { products: [record] }, products: new Map([[record.sourceId, record]]) };
    const locals = { ...getProductFromData(data, record.slug), locale: 'en', checkoutEnabled: false, t: key => translate('en', key) };
    locals.category = { name: 'Bathroom Accessories — Individual Pieces', href: '/collections/individual-pieces' };
    const details = await ejs.renderFile(path.resolve(__dirname, '../../src/views/storefront/product-details.ejs'), locals);
    const cards = await ejs.renderFile(path.resolve(__dirname, '../../src/views/partials/product-grid.ejs'), { products: [productCard(source, ''), productCard(record, '')], t: locals.t });
    await page.route('**/synthetic-template', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/pages/product-details.css"></head><body class="storefront-body">${details}<section class="container">${cards}</section></body></html>` }));
    await page.goto('/synthetic-template');
    const frame = page.locator('.product-main-image').first();
    const image = page.locator('#product-main-photo');
    await image.evaluate(node => node.decode());
    await expect(image).toHaveCSS('object-fit', 'contain');
    await expect(frame).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const box = await frame.boundingBox();
    expect(box.width).toBeLessThanOrEqual(420);
    expect(box.height).toBeLessThanOrEqual(420);
    expect(Math.abs(box.width / box.height - 1)).toBeLessThan(0.02);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.breadcrumbs a').nth(1)).toHaveAttribute('href', '/collections/individual-pieces');
    if (width === 390) {
      const crumbs = await page.locator('.breadcrumbs li').evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, width: node.getBoundingClientRect().width })));
      expect(Math.abs(crumbs[0].top - crumbs[1].top)).toBeLessThan(1);
      expect(crumbs[2].top).toBeGreaterThan(crumbs[1].top);
      await expect(page.locator('.breadcrumbs a').nth(1)).toHaveCSS('text-overflow', 'ellipsis');
      await page.locator('.breadcrumbs').screenshot({ path: 'alreda-store-verification-screenshots/breadcrumbs-mobile.png' });
    }
    const media = await page.locator('.product-card-link').evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, height: node.clientHeight })));
    expect(Math.abs(media[0].height - media[1].height)).toBeLessThanOrEqual(1);
    await page.locator('.product-gallery').screenshot({ path: `alreda-store-verification-screenshots/shared-gallery-${width}.png` });
    await page.locator('[data-gallery-src]').nth(1).click();
    await expect(page.locator('[data-gallery-src]').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Enlarge product image' }).click();
    await expect(page.locator('.product-lightbox')).toBeVisible();
  });
}
