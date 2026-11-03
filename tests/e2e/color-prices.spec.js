const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { getProductFromData } = require('../../src/services/product.service');
const { translate } = require('../../src/config/storefront-i18n');
const source = require('../../src/config/catalog.json').products[0];
for (const width of [1440, 390]) {
  test(`admin optional color prices inherit regular price at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/synthetic-admin-colors', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/pages/admin-catalog.css"></head><body><div data-admin-catalog class="admin-management"><form class="admin-form"><label>Regular price<input name="priceEgp" value="500"></label><input data-image-urls type="hidden" value=""><fieldset data-catalog-color-picker><legend>Choose a color</legend><button type="button" data-color-choice data-color-en="Black">Black</button><button type="button" data-color-choice data-color-en="Gold">Gold</button><input data-color-variants type="hidden" value='[{"color":"Black","stock":5,"priceEgp":null},{"color":"Gold","stock":5,"priceEgp":725}]'><div data-color-image-list></div></fieldset></form></div><script src="/assets/js/admin-catalog.js"></script></body></html>` }));
    await page.goto('/synthetic-admin-colors');
    const black = page.getByLabel('Color price (EGP, optional): Black', { exact: true });
    const gold = page.getByLabel('Color price (EGP, optional): Gold', { exact: true });
    await expect(black).toHaveValue('');
    await expect(black).toHaveAttribute('placeholder', '500');
    await expect(gold).toHaveValue('725');
    await black.fill('600');
    expect(JSON.parse(await page.locator('[data-color-variants]').inputValue())[0].priceEgp).toBe(600);
    await gold.fill('');
    expect(JSON.parse(await page.locator('[data-color-variants]').inputValue())[1].priceEgp).toBeNull();
    await page.getByLabel('Regular price', { exact: true }).fill('550');
    await expect(gold).toHaveAttribute('placeholder', '550');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/admin-color-prices-${width}.png`, fullPage: true });
  });
  for (const optionName of ['Color', 'Type']) {
  test(`${optionName} buttons and photos select the matching price and cart variant at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const values = optionName === 'Color' ? ['Black', 'Gold'] : ['Single', 'Double'];
    const record = { ...structuredClone(source), id: 'ac4b1d94-c393-435b-9990-a4b979386286', sourceId: 'synthetic-colors', slug: 'synthetic-colors',
      isAvailable: true, stock_quantity: 10, collectionIds: [], options: [{ name: optionName, values }],
      gallery: values.map(value => value.toLowerCase()).map(color => ({ sourceId: color, src: `/synthetic-${color}.svg`, displaySrc: `/synthetic-${color}.svg`, thumbSrc: `/synthetic-${color}.svg`, srcSet: '', alt: color })),
      variants: values.map((color, i) => ({ id: color, databaseId: i ? 'a836d7d7-65f9-4c40-9bc4-0b76581e35cc' : 'cccb792c-ec0f-4c47-80b8-f8d86f1f383b', title: color, options: [color], imageId: color.toLowerCase(), priceAmount: i ? '725.00' : '500.00', inventoryQuantity: 5, publicAvailable: true })) };
    const data = { bySlug: new Map([[record.slug, record]]), categories: [], byCategory: new Map(), catalog: { products: [record] }, products: new Map([[record.sourceId, record]]) };
    const locals = { ...getProductFromData(data, record.slug), locale: 'en', checkoutEnabled: true, t: key => translate('en', key) };
    const details = await ejs.renderFile(path.resolve('src/views/storefront/product-details.ejs'), locals);
    await page.route('**/synthetic-*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#ddd"/></svg>' }));
    await page.route('**/synthetic-color-prices', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/pages/product-details.css"></head><body>${details}<dialog data-cart-dialog data-added-text="Added"><ul data-cart-items></ul><p data-cart-status></p><p data-cart-total></p><a data-cart-checkout href="/checkout">Checkout</a></dialog><script src="/assets/js/cart.js" defer></script></body></html>` }));
    let payload;
    await page.route('**/api/cart/items', route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { cart_items: [] } }); });
    await page.goto('/synthetic-color-prices');
    await expect(page.locator('[data-variant-price]')).toContainText('500.00');
    await page.getByRole('radio', { name: values[1], exact: true }).check();
    await expect(page.locator('[data-variant-price]')).toContainText('725.00');
    await expect(page.locator('#product-main-photo')).toHaveAttribute('data-original-src', `/synthetic-${values[1].toLowerCase()}.svg`);
    await page.locator(`[data-gallery-src="/synthetic-${values[0].toLowerCase()}.svg"]`).click();
    await expect(page.getByRole('radio', { name: values[0], exact: true })).toBeChecked();
    await expect(page.locator('[data-variant-price]')).toContainText('500.00');
    await page.locator(`[data-gallery-src="/synthetic-${values[1].toLowerCase()}.svg"]`).click();
    await expect(page.locator('[data-variant-price]')).toContainText('725.00');
    await page.locator('.detail-add').click();
    await expect.poll(() => payload?.variantId).toBe(record.variants[1].databaseId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  }
}
