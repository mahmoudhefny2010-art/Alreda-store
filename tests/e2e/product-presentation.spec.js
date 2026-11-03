const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { typeOptions } = require('../../src/config/catalog-types');
const { translateCatalogText } = require('../../src/services/catalog-translation.service');
const { productCard } = require('../../src/utils/productPreview');
const { translate } = require('../../src/config/storefront-i18n');

async function syntheticPage(page, html) {
  await page.route('**/synthetic-options', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/pages/admin-catalog.css"></head><body>${html}</body></html>` }));
  await page.route('**/synthetic-photo-*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#ccc"/></svg>' }));
  await page.goto('/synthetic-options');
}
test('admin types, gallery selections and bidirectional translation work without overwriting manual edits', async ({ page }) => {
  const presentation = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin/product-presentation.ejs'), { editing: null, locale: 'en', typeOptions });
  const bilingual = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin/bilingual-field.ejs'), { a: key => key, prefix: 'test', key: 'name', value: '', arValue: '', multiline: false, required: false });
  await syntheticPage(page, `<div class="admin-management"><form class="admin-form">${bilingual}<input name="priceEgp" value="500"><input name="stock" value="99"><input data-color-stock value="99"><input type="hidden" data-color-variants value='[{"color":"Black"},{"color":"Gold"}]'><input type="hidden" data-image-urls value="/synthetic-photo-one.svg&#10;/synthetic-photo-two.svg">${presentation}</form></div>`);
  await page.route('**/api/admin/catalog/translate', route => { const body = route.request().postDataJSON(); return route.fulfill({ json: translateCatalogText(body.text, body.source, body.rich) }); });
  for (const file of ['admin-presentation.js', 'admin-translation.js']) await page.addScriptTag({ path: path.resolve(__dirname, '../../src/public/js', file) });
  await page.locator('#test-name').fill('Black');
  await expect(page.locator('#test-name-ar')).toHaveValue('أسود');
  await page.locator('#test-name-ar').fill('ترجمة يدوية');
  await page.locator('#test-name').fill('Gold');
  await expect(page.locator('.catalog-translation-status').first()).toContainText('Translation filled');
  await expect(page.locator('#test-name-ar')).toHaveValue('ترجمة يدوية');
  await page.locator('#test-name').fill('');
  await page.locator('#test-name-ar').fill('أسود');
  await expect(page.locator('#test-name')).toHaveValue('Black');
  await page.locator('[data-manage-types]').check();
  await expect(page.locator('[data-types-empty]')).toBeVisible();
  await page.locator('[data-image-choices="hoverImage"] button').first().click();
  await expect(page.locator('[data-presentation-image="hoverImage"]')).toHaveValue('/synthetic-photo-one.svg');
  await expect(page.locator('[data-presentation-preview="hoverImage"]')).toHaveAttribute('src', '/synthetic-photo-one.svg');
  await page.locator('[data-add-type]').click();
  await expect(page.locator('[data-types-empty]')).toBeHidden();
  await page.locator('.catalog-type-row').first().getByLabel('Stock', { exact: true }).fill('5');
  await expect(page.locator('[data-types-summary]')).toContainText('5 units');
  await expect(page.locator('[name="stock"]')).toHaveValue('5');
  await expect(page.locator('[name="stock"]')).toHaveJSProperty('readOnly', true);
  await expect(page.locator('[data-color-stock]')).toBeDisabled();
  await expect(page.locator('[data-stock-breakdown]').first()).toHaveText('Black: 3 · Gold: 2');
  await page.locator('[data-type-preset]').selectOption('1');
  await page.locator('[data-add-type]').click();
  await expect(page.locator('.catalog-type-row')).toHaveCount(2);
  await page.locator('.catalog-type-row').first().getByLabel('Type price (EGP)', { exact: true }).fill('500');
  await page.locator('.catalog-type-row').nth(1).getByLabel('Type price (EGP)', { exact: true }).fill('700');
  await page.locator('[data-presentation-image="hoverImage"]').selectOption('/synthetic-photo-two.svg');
  const saved = JSON.parse(await page.locator('[data-presentation-value]').inputValue());
  expect(saved.hoverImage).toBe('/synthetic-photo-two.svg');
  expect(saved.types.map(type => type.en)).toEqual(['Single', 'Double']);
  expect(saved.types.map(type => type.priceEgp)).toEqual([500, 700]);
  expect(saved.types[0].ar).toBe('مفرد');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'alreda-store-verification-screenshots/admin-product-options-mobile.png', fullPage: true });
  await page.locator('[data-manage-types]').uncheck();
  await expect(page.locator('[data-color-stock]')).toBeEnabled();
  await expect(page.locator('[name="stock"]')).toHaveJSProperty('readOnly', false);
});

test('guided editor supports Arabic, automatic previews and a clear empty state', async ({ page }) => {
  const presentation = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin/product-presentation.ejs'), { editing: null, locale: 'ar', typeOptions });
  await page.setViewportSize({ width: 390, height: 844 });
  await syntheticPage(page, `<div class="admin-management" dir="rtl"><form class="admin-form"><input name="priceEgp" value="500"><input type="hidden" data-image-urls value="">${presentation}</form></div>`);
  await page.addScriptTag({ path: path.resolve(__dirname, '../../src/public/js/admin-presentation.js') });
  await expect(page.locator('[data-preview-empty="hoverImage"]')).toBeVisible();
  await expect(page.locator('[data-presentation-preview="hoverImage"]')).toBeHidden();
  await page.locator('[data-manage-types]').check();
  await expect(page.locator('[data-types-empty]')).toContainText('لم تضف أنواعًا');
  await page.locator('[data-add-type]').click();
  await expect(page.locator('.presentation-type-name')).toHaveText('مفرد');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'alreda-store-verification-screenshots/admin-product-options-arabic.png', fullPage: true });
});

const record = { name: 'Bathroom Set', titleEn: 'Bathroom Set', slug: 'synthetic-set', options: [{ name: 'Color', values: ['Black', 'Gold'] }],
  gallery: [{ sourceId: '1', src: '/synthetic-photo-one.svg' }, { sourceId: '2', src: '/synthetic-photo-two.svg' }],
  variants: [{ id: 'black', title: 'Black', options: ['Black'], imageId: '1', priceAmount: '500.00' }, { id: 'gold', title: 'Gold', options: ['Gold'], imageId: '2', priceAmount: '500.00' }],
  catalogDetails: { presentation: { hoverImage: '/synthetic-photo-two.svg', mobileImage: '/synthetic-photo-one.svg' } } };
test('card stock notice follows the selected color without treating other colors as sold out', async ({ page }) => {
  const item = { ...structuredClone(record), id: 'a6c56b98-f00b-4b4b-8b03-3af6a37a9204', stock_quantity: 5, isAvailable: true };
  item.variants[0].inventoryQuantity = 0; item.variants[0].publicAvailable = false;
  item.variants[1].inventoryQuantity = 5; item.variants[1].publicAvailable = true;
  const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/partials/product-card.ejs'), { product: productCard(item, ''), t: key => translate('en', key) });
  await syntheticPage(page, `<div style="max-width:320px;margin:20px">${html}</div>`);
  await page.addScriptTag({ path: path.resolve(__dirname, '../../src/public/js/product-card.js') });
  const notice = page.locator('[data-card-stock]');
  await expect(notice).toBeVisible(); await expect(notice).toHaveText('Out of stock');
  await page.getByRole('button', { name: 'Color: Gold', exact: true }).click();
  await expect(notice).toBeHidden();
  await page.getByRole('button', { name: 'Color: Black', exact: true }).click();
  await expect(notice).toBeVisible(); await expect(notice).toHaveText('Out of stock');
});
for (const mobile of [false, true]) {
  test(`card photo selection and full-set framing on ${mobile ? 'mobile' : 'desktop'}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/partials/product-card.ejs'), { product: productCard(record, ''), t: key => translate('en', key) });
    await syntheticPage(page, `<div style="max-width:320px;margin:20px">${html}</div>`);
    await page.addScriptTag({ path: path.resolve(__dirname, '../../src/public/js/product-card.js') });
    const image = page.locator('.product-card-link img');
    await expect(image).toHaveJSProperty('complete', true);
    if (mobile) {
      await expect(image).toHaveCSS('object-fit', 'contain');
      await expect(image).toHaveJSProperty('currentSrc', new URL('/synthetic-photo-one.svg', page.url()).href);
    } else {
      await page.locator('.product-card-link').hover(); await expect(image).toHaveAttribute('src', '/synthetic-photo-two.svg');
      await page.mouse.move(900, 700); await expect(image).toHaveAttribute('src', '/synthetic-photo-one.svg');
    }
    await page.getByRole('button', { name: 'Color: Gold', exact: true }).click();
    await expect(image).toHaveAttribute('src', '/synthetic-photo-two.svg');
    await expect(image).toHaveJSProperty('currentSrc', new URL('/synthetic-photo-two.svg', page.url()).href);
    await page.screenshot({ path: `alreda-store-verification-screenshots/product-set-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await context.close();
  });
}
