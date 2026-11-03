const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { customerOrderPresentation } = require('../../src/services/customer-orders.service');
const { translate } = require('../../src/config/storefront-i18n');
const current = { id: randomUUID(), order_number: 'AS-SYNTHETIC-123', status: 'CONFIRMED', payment_method: 'CASH_ON_DELIVERY', payment_status: 'UNPAID', created_at: new Date('2026-11-03T12:00:00Z'), total_egp: 1050, subtotal_egp: 1000, delivery_fee_egp: 50,
  order_items: [{ product_name: 'Bathroom Accessories — Black / Double', product_name_ar: 'إكسسوارات الحمام — أسود / مزدوج', quantity: 2, unit_price_egp: 500, line_total_egp: 1000 }] };
for (const locale of ['en', 'ar']) for (const width of [390, 1440]) {
  test(`customer history and receipt ${locale} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.route('**/assets/**', route => route.fulfill({ path: path.resolve('src/public', new URL(route.request().url()).pathname.slice('/assets/'.length)) }));
    const presentation = customerOrderPresentation(locale);
    const render = async (order, history) => {
      const body = await ejs.renderFile(path.resolve('src/views/storefront/customer-orders.ejs'), { ...presentation, locale, t: key => translate(locale, key), number: value => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en').format(value), order, history });
      return `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"></head><body>${body}</body></html>`;
    };
    await page.route('**/account/orders', async route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: await render(null, { current: [current], past: [{ ...current, id: randomUUID(), status: 'DELIVERED' }], page: 1, hasNext: true }) }));
    await page.route(`**/account/orders/${current.id}`, async route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: await render(current, null) }));
    await page.goto('/account/orders');
    await expect(page.locator('.order-history-section')).toHaveCount(2);
    await expect(page.locator('.order-history-card')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/customer-orders-${locale}-${width}.png`, fullPage: true });
    await page.locator('.order-history-card').first().click();
    await expect(page.locator('.order-receipt-reference')).toContainText(current.order_number);
    await expect(page.locator('#checkout-result')).toHaveCSS('border-bottom-left-radius', '16px');
    await expect(page.locator('.order-receipt-item')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/customer-order-detail-${locale}-${width}.png`, fullPage: true });
  });
}
