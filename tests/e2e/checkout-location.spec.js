const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { translate, cityName } = require('../../src/config/storefront-i18n');
const formatPrice = require('../../src/utils/formatPrice');
const productId = 'a836d7d7-65f9-4c40-9bc4-0b76581e35cc';

async function openCheckout(page, locale = 'en') {
  await page.route('**/assets/**', route => route.fulfill({ path: path.resolve('src/public', new URL(route.request().url()).pathname.slice('/assets/'.length)) }));
  await page.route('**/api/checkout/location', route => route.fulfill({ json: { address: locale === 'ar' ? '٥ شارع تجريبي، القاهرة، مصر' : '5 Synthetic Street, Cairo, Egypt' } }));
  const details = await ejs.renderFile(path.resolve('src/views/storefront/checkout.ejs'), { locale, t: key => translate(locale, key), formatPrice, cityName,
    customer: { name: 'Synthetic Buyer', email: 'buyer@example.invalid' }, requestKey: 'cccb792c-ec0f-4c47-80b8-f8d86f1f383b',
    products: [{ id: productId, name: 'Bathroom accessories — Gold / Double', name_ar: 'إكسسوارات الحمام — ذهبي / مزدوج', price_egp: 500, stock_quantity: 5 }],
    cartQuantities: { [productId]: 2 }, policy: { shippingRates: { Cairo: 50, Giza: 70 }, shippingLabels: { Cairo: 'القاهرة', Giza: 'الجيزة' } } });
  await page.route('**/synthetic-checkout', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"></head><body>${details}</body></html>` }));
  await page.goto('/synthetic-checkout');
}
async function fillAddress(page) {
  await page.locator('[name="phone"]').fill('01000000000');
  await page.locator('[name="address"]').fill('Synthetic street, building 5, apartment 10');
}

for (const locale of ['en', 'ar']) for (const width of [1440, 390]) {
  test(`checkout layout and requested location ${locale} ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.0444, longitude: 31.2357, accuracy: 10 });
    await openCheckout(page, locale);
    await expect(page.locator('[data-location-result]')).toBeHidden();
    await expect(page.locator('[name="name"]')).toHaveValue('Synthetic Buyer');
    const money = value => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(value);
    await expect(page.locator('#checkout-total')).toHaveText(money(1050));
    await page.locator('[name="city"]').selectOption('Giza');
    await expect(page.locator('#checkout-total')).toHaveText(money(1070));
    await page.locator('[data-pick-location]').click();
    await expect(page.locator('[data-location-result]')).toBeVisible();
    await expect(page.locator('[name="address"]')).toHaveValue(locale === 'ar' ? '٥ شارع تجريبي، القاهرة، مصر' : '5 Synthetic Street, Cairo, Egypt');
    await expect(page.locator('[data-location-value]')).toHaveCount(0);
    await expect(page.locator('[name="city"]')).toHaveValue('Giza');
    await fillAddress(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/checkout-location-${locale}-${width}.png`, fullPage: true });
    let payload;
    await page.route('**/api/orders', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { state: 'pending_verification', confirmed: false } }); });
    await page.locator('[type="submit"]').click();
    await expect.poll(() => payload?.shipping.location).toEqual({ latitude: 30.0444, longitude: 31.2357, accuracyM: 10 });
    expect(payload.shipping.address).toContain('building 5'); expect(payload.expectedTotalEgp).toBe(1070);
    await expect(page.locator('#checkout-form')).toBeVisible();
    await expect(page.locator('#checkout-status')).toHaveText(translate(locale, 'orderPendingVerification'));
  });
}

test('denied location permission leaves manual checkout available without coordinates', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (success, error) => error({ code: 1 }) } }); });
  await openCheckout(page);
  await page.locator('[data-pick-location]').click();
  await expect(page.locator('[data-location-status]')).toContainText('Location permission was not granted');
  await expect(page.locator('[data-location-result]')).toBeHidden();
  await fillAddress(page);
  let payload;
  await page.route('**/api/orders', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { confirmed: false } }); });
  await page.locator('[type="submit"]').click();
  await expect.poll(() => Boolean(payload)).toBe(true);
  expect(payload.shipping).not.toHaveProperty('location');
});

test('removing the location prevents it from being sent with the order', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: 30, longitude: 31 });
  await openCheckout(page); await page.locator('[data-pick-location]').click();
  await expect(page.locator('[data-location-result]')).toBeVisible();
  await page.locator('[data-remove-location]').click();
  await expect(page.locator('[data-location-result]')).toBeHidden();
  await fillAddress(page);
  let payload;
  await page.route('**/api/orders', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { confirmed: false } }); });
  await page.locator('[type="submit"]').click();
  await expect.poll(() => Boolean(payload)).toBe(true); expect(payload.shipping).not.toHaveProperty('location');
});

test('location timeout releases checkout and allows manual address entry', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (success, error) => error({ code: 3 }) } }); });
  await openCheckout(page); await page.locator('[data-pick-location]').click();
  await expect(page.locator('[data-location-status]')).toContainText('Your location could not be found');
  await expect(page.locator('[type="submit"]')).toBeEnabled();
  await expect(page.locator('[data-pick-location]')).toBeEnabled();
});

test('location runs only after clicking and checkout waits for the selected location', async ({ page }) => {
  await page.addInitScript(() => {
    window.syntheticLocationRequests = 0;
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: success => { window.syntheticLocationRequests++; window.resolveSyntheticLocation = () => success({ coords: { latitude: 30, longitude: 31, accuracy: 15 } }); } } });
  });
  await openCheckout(page);
  expect(await page.evaluate(() => window.syntheticLocationRequests)).toBe(0);
  await page.locator('[data-pick-location]').click();
  await expect(page.locator('[type="submit"]')).toBeDisabled();
  await page.evaluate(() => window.resolveSyntheticLocation());
  await expect(page.locator('[type="submit"]')).toBeEnabled();
  await expect(page.locator('[name="address"]')).toHaveValue('5 Synthetic Street, Cairo, Egypt');
});

test('a free address service outage preserves the GPS pin and allows a written address', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: 30, longitude: 31 });
  await openCheckout(page);
  await page.route('**/api/checkout/location', route => route.fulfill({ status: 503, json: { code: 'ADDRESS_LOOKUP_UNAVAILABLE' } }));
  await page.locator('[data-pick-location]').click();
  await expect(page.locator('[data-location-status]')).toContainText('written address could not be found');
  await expect(page.locator('[type="submit"]')).toBeEnabled();
  await fillAddress(page);
  let payload;
  await page.route('**/api/orders', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { confirmed: false } }); });
  await page.locator('[type="submit"]').click();
  await expect.poll(() => payload?.shipping.location?.latitude).toBe(30);
  expect(payload.shipping.address).toContain('building 5');
});

test('address lookup does not overwrite edits made while it is pending', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: 30, longitude: 31 });
  await openCheckout(page);
  let pending;
  await page.route('**/api/checkout/location', route => { pending = route; });
  await page.locator('[data-pick-location]').click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator('[name="address"]').fill('My manually edited address');
  await pending.fulfill({ json: { address: 'Suggested approximate address' } });
  await expect(page.locator('[data-location-status]')).toContainText('Your edited address has been kept');
  await expect(page.locator('[name="address"]')).toHaveValue('My manually edited address');
});
