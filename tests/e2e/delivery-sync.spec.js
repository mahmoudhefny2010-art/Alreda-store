const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { translate } = require('../../src/config/storefront-i18n');
const { adminText } = require('../../src/config/admin-i18n');

for (const locale of ['en', 'ar']) for (const width of [1440, 390]) {
  test(`top-bar delivery save submits prices rather than language ${locale} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const configuration = { mode: 'CITY', flatFee: 0, zones: [{ city: 'Cairo', cityAr: 'القاهرة', fee: 40, enabled: true }, { city: 'Giza', cityAr: 'الجيزة', fee: 60, enabled: true }] };
    const html = await ejs.renderFile(path.resolve('src/views/layouts/admin.ejs'), { locale, direction: locale === 'ar' ? 'rtl' : 'ltr', title: 'Delivery prices',
      t: key => translate(locale, key), a: key => adminText(locale, key), adminPath: '/admin/delivery', adminPermissions: ['orders'],
      customer: { name: 'Synthetic administrator' }, contentView: '../admin/delivery', configuration, saved: false, usingDatabase: true });
    await page.route('**/synthetic-delivery-sync', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('/synthetic-delivery-sync');
    await page.locator('[data-zone-fee]').first().fill('77');
    await page.locator('[data-zone-fee]').nth(1).fill('88');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/delivery-sync-${locale}-${width}.png`, fullPage: true });
    await page.route('**/admin/delivery', route => route.fulfill({ body: 'Synthetic save only' }));
    const [request] = await Promise.all([page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/admin/delivery')),
      page.locator('.admin-topbar button[form="delivery-settings-form"]').click()]);
    const sent = JSON.parse(new URLSearchParams(request.postData()).get('configuration'));
    expect(sent.zones.map(zone => zone.fee)).toEqual([77, 88]);
  });
}
