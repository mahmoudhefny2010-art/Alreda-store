const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { defaults } = require('../../src/config/push-messages');
async function openFixture(page, view, locals) {
  const body = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin', `${view}.ejs`), locals);
  await page.route('**/synthetic-store-settings', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${locals.locale}" dir="${locals.locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/pages/admin-operations.css"></head><body class="admin-body">${body}</body></html>` }));
  await page.goto('/synthetic-store-settings');
}
for (const width of [1440, 390]) {
  test(`delivery editor saves flat/per-area prices at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const configuration = { mode: 'CITY', flatFee: 25, zones: [{ city: 'Cairo', cityAr: 'القاهرة', fee: 40, enabled: true }, { city: 'Giza', cityAr: 'الجيزة', fee: 0, enabled: false }] };
    await openFixture(page, 'delivery', { locale: width === 390 ? 'ar' : 'en', configuration, saved: false, usingDatabase: true });
    const mode = page.locator('[data-delivery-mode]');
    await mode.selectOption('FLAT'); await page.locator('[data-flat-fee]').fill('35');
    await page.locator('[data-zone-enabled]').nth(1).check();
    expect(JSON.parse(await page.locator('[data-delivery-configuration]').inputValue())).toMatchObject({ mode: 'FLAT', flatFee: 35 });
    await expect(page.locator('[data-zone-fee]').first()).toBeDisabled();
    await mode.selectOption('CITY'); await page.locator('[data-zone-fee]').first().fill('55');
    await page.locator('[data-add-zone]').click();
    await page.locator('[data-delivery-zone]').last().locator('[data-remove-zone]').click();
    await expect(page.locator('[data-delivery-zone]')).toHaveCount(2);
    await page.locator('[data-add-zone]').click();
    const row = page.locator('[data-delivery-zone]').last();
    await row.locator('[data-zone-city]').fill('New Cairo'); await row.locator('[data-zone-ar]').fill('القاهرة الجديدة'); await row.locator('[data-zone-fee]').fill('70');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/delivery-editor-${width}.png`, fullPage: true });
    await page.route('**/admin/delivery', route => route.fulfill({ body: 'Synthetic save only' }));
    const [request] = await Promise.all([page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/admin/delivery')), page.locator('button[type=submit]').click()]);
    const saved = JSON.parse(new URLSearchParams(request.postData()).get('configuration'));
    expect(saved.zones[0].fee).toBe(55); expect(saved.zones[2].city).toBe('New Cairo');
  });
}
test('deletes a saved delivery area and keeps one area available', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const configuration = { mode: 'CITY', flatFee: 0, zones: [{ city: 'Cairo', cityAr: 'القاهرة', fee: 40, enabled: true }, { city: 'Giza', cityAr: 'الجيزة', fee: 50, enabled: true }] };
  await openFixture(page, 'delivery', { locale: 'en', configuration, saved: false, usingDatabase: true });
  await page.locator('[data-delivery-zone]').first().locator('[data-remove-zone]').click();
  await expect(page.locator('[data-delivery-zone]')).toHaveCount(1);
  await expect(page.locator('[data-remove-zone]')).toBeDisabled();
  expect(JSON.parse(await page.locator('[data-delivery-configuration]').inputValue()).zones.map(zone => zone.city)).toEqual(['Giza']);
});
test('Arabic push composer previews content and requires a separate queue action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, 'push-controls', { locale: 'ar', templates: Object.entries(defaults).map(([eventType, message]) => ({ eventType, enabled: true, message })),
    requestKey: 'a836d7d7-65f9-4c40-9bc4-0b76581e35cc', audienceCounts: { ALL: 2, ACTIVE_CART: 1, CUSTOMERS_WITH_ORDERS: 1 }, pushEnabled: true, queuedCampaign: null, templateSaved: false });
  let posts = 0;
  await page.route('**/admin/notifications/campaigns', route => { posts++; return route.fulfill({ body: 'Synthetic queue only' }); });
  const form = page.locator('[data-campaign-form]');
  await form.locator('[data-push-preset]').selectOption('OFFER');
  await form.locator('[data-push-audience] option[value="ALL"]').evaluate(option => { option.dataset.recipientCount = '0'; option.parentElement.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(form.locator('button[type=submit]')).toBeDisabled();
  await form.locator('[data-message-field="bodyAr"]').fill('اكتشف عروضنا الجديدة اليوم.');
  await form.locator('[data-push-audience]').selectOption('ACTIVE_CART');
  await expect(form.locator('[data-push-preview-body]')).toHaveText('اكتشف عروضنا الجديدة اليوم.');
  await form.locator('button[type=submit]').click();
  await expect(page.locator('[data-push-review]')).toBeVisible(); expect(posts).toBe(0);
  await page.locator('[data-cancel-push]').click(); expect(posts).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'alreda-store-verification-screenshots/push-composer-arabic-mobile.png', fullPage: true });
  await form.locator('button[type=submit]').click();
  const [request] = await Promise.all([page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/campaigns')), page.locator('[data-confirm-push]').click()]);
  const value = JSON.parse(new URLSearchParams(request.postData()).get('configuration'));
  expect(value.audience).toBe('ACTIVE_CART'); expect(value.message.bodyAr).toBe('اكتشف عروضنا الجديدة اليوم.'); expect(posts).toBe(1);
});
