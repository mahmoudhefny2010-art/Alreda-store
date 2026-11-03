const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { translate, cityName } = require('../../src/config/storefront-i18n');
const formatPrice = require('../../src/utils/formatPrice');
const productId = 'a836d7d7-65f9-4c40-9bc4-0b76581e35cc';
const proofId = 'cecb792c-ec0f-4c47-80b8-f8d86f1f383b';
async function openCheckout(page, locale = 'en', enabled = true) {
  await page.route('**/assets/**', route => route.fulfill({ path: path.resolve('src/public', new URL(route.request().url()).pathname.slice('/assets/'.length)) }));
  const body = await ejs.renderFile(path.resolve('src/views/storefront/checkout.ejs'), {
    locale, t: key => translate(locale, key), formatPrice, cityName,
    customer: { name: 'Synthetic Buyer', email: 'buyer@example.invalid' }, requestKey: 'cccb792c-ec0f-4c47-80b8-f8d86f1f383b',
    products: [{ id: productId, name: 'Synthetic product', name_ar: 'منتج تجريبي', price_egp: 500, stock_quantity: 5 }],
    cartQuantities: { [productId]: 1 }, policy: { shippingRates: { Cairo: 50 }, shippingLabels: { Cairo: 'القاهرة' } },
    instapay: { enabled, phone: enabled ? '15550100100' : '', url: enabled ? 'https://example.invalid/transfer' : '', qrUrl: '' },
  });
  await page.route('**/synthetic-payment', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"></head><body>${body}</body></html>` }));
  await page.goto('/synthetic-payment');
}
const image = { name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
for (const locale of ['en', 'ar']) for (const width of [390, 1440]) {
  test(`confirmed receipt layout ${locale} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await openCheckout(page, locale);
    await page.locator('[name="phone"]').fill('01000000000'); await page.locator('[name="address"]').fill('Synthetic street building 5');
    await page.route('**/api/orders', route => route.fulfill({ json: { state: 'confirmed', confirmed: true, order: {
      reference: 'AS-SYNTHETIC-123456', paymentMethod: 'CASH_ON_DELIVERY', paymentStatus: 'UNPAID', subtotalEgp: 1500, shippingEgp: 50, totalEgp: 1550,
      items: [{ product_name: 'Bathroom Accessories — Black / Double', product_name_ar: 'إكسسوارات الحمام — أسود / مزدوج', quantity: 2, unit_price_egp: 500 }, { product_name: 'Bathroom Set — Gold', product_name_ar: 'طقم إكسسوارات الحمام — ذهبي', quantity: 1, unit_price_egp: 500 }],
    } } }));
    await page.locator('[type="submit"]').click();
    await expect(page.locator('.checkout-complete')).toBeVisible();
    await expect(page.locator('#checkout-status')).toHaveText(translate(locale, 'orderConfirmed'));
    await expect(page.locator('.order-receipt-item')).toHaveCount(2);
    await expect(page.locator('.order-receipt-payment')).toContainText(translate(locale, 'cashOnDelivery'));
    await expect(page.locator('.order-receipt-reference')).toContainText('AS-SYNTHETIC-123456');
    await expect(page.locator('#checkout-result')).toHaveCSS('border-bottom-left-radius', '16px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/order-receipt-${locale}-${width}.png`, fullPage: true });
  });
}
for (const locale of ['en', 'ar']) for (const width of [390, 1440]) {
  test(`InstaPay receipt and pending review ${locale} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 }); await openCheckout(page, locale);
    await page.locator('[name="phone"]').fill('01000000000'); await page.locator('[name="address"]').fill('Synthetic street building 5');
    await page.locator('[value="INSTAPAY"]').check();
    await expect(page.locator('[data-instapay-dialog]')).toBeVisible();
    await expect(page.locator('[data-payment-continue]')).toBeDisabled();
    await expect(page.locator('[type="submit"]')).toBeDisabled();
    await expect(page.locator('[data-instapay-dialog]')).toContainText('15550100100');
    await page.route('**/api/payments/instapay/proof', route => route.fulfill({ status: 201, json: { proofId } }));
    await page.locator('[data-payment-file]').setInputFiles(image);
    await expect(page.locator('[data-payment-continue]')).toBeEnabled();
    await page.screenshot({ path: `alreda-store-verification-screenshots/instapay-${locale}-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-payment-continue]').click();
    let payload;
    await page.route('**/api/orders', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { state: 'awaiting_admin_confirmation', confirmed: false, recorded: true, order: { reference: 'SYNTHETIC-1' } } }); });
    await page.locator('[type="submit"]').click();
    await expect(page.locator('#checkout-form')).toBeHidden();
    expect(payload.paymentProofId).toBe(proofId); expect(payload.paymentMethod).toBe('INSTAPAY');
    await expect(page.locator('#checkout-status')).toHaveText(await page.locator('[data-insta-messages]').getAttribute('data-awaiting'));
    await expect(page.locator('#check-order')).toBeVisible();
  });
}
test('InstaPay stays unavailable without receiving details; cash works without a receipt', async ({ page }) => {
  await openCheckout(page, 'en', false);
  await expect(page.locator('[value="INSTAPAY"]')).toBeDisabled();
  await expect(page.locator('[value="CASH_ON_DELIVERY"]')).toBeChecked();
  await expect(page.locator('[type="submit"]')).toBeEnabled();
});
test('failed receipt upload cannot enable InstaPay submission', async ({ page }) => {
  await openCheckout(page); await page.locator('[value="INSTAPAY"]').check();
  await page.route('**/api/payments/instapay/proof', route => route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }));
  await page.locator('[data-payment-file]').setInputFiles(image);
  await expect(page.locator('[data-payment-upload-status]')).toContainText('could not be uploaded');
  await expect(page.locator('[data-payment-continue]')).toBeDisabled();
  await page.locator('[data-close-instapay]').click(); await expect(page.locator('[type="submit"]')).toBeDisabled();
  await page.locator('[value="CASH_ON_DELIVERY"]').check(); await expect(page.locator('[type="submit"]')).toBeEnabled();
});

test('background order recovery is silent and does not clutter checkout', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('alreda.checkout.request-key', 'cccb792c-ec0f-4c47-80b8-f8d86f1f383b'));
  await page.route('**/api/orders/requests/*', route => route.fulfill({ json: { state: 'pending_verification', confirmed: false } }));
  await openCheckout(page);
  await expect(page.locator('[type="submit"]')).toBeEnabled();
  await expect(page.locator('#checkout-status')).toBeEmpty();
  await expect(page.locator('#check-order')).toBeHidden();
});

for (const locale of ['en', 'ar']) test(`uncertain submission shows a brief error without false success ${locale}`, async ({ page }) => {
  await openCheckout(page, locale);
  await page.locator('[name="phone"]').fill('01000000000');
  await page.locator('[name="address"]').fill('Synthetic street building 5');
  await page.route('**/api/orders', route => route.fulfill({ status: 202, json: { state: 'pending_verification', confirmed: false } }));
  await page.locator('[type="submit"]').click();
  await expect(page.locator('#checkout-status')).toHaveText(translate(locale, 'orderPendingVerification'));
  await expect(page.locator('#checkout-status')).not.toContainText('Checking');
  await expect(page.locator('#checkout-form')).toBeVisible();
  await expect(page.locator('#new-order')).toBeHidden();
  await expect(page.locator('#check-order')).toBeVisible();
});
