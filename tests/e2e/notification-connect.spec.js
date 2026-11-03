const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { translate } = require('../../src/config/storefront-i18n');
for (const width of [1440, 390]) {
  test(`connects a delayed device and requests an account-only test at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const locale = width === 390 ? 'ar' : 'en';
    const locals = { t: key => translate(locale, key), locale, returnTo: '/', title: 'Collections', categories: [],
      customer: { id: 'synthetic-user', name: 'Synthetic notification customer', google_id: 'synthetic', role: 'customer' },
      onesignalAppId: 'synthetic-app', notificationPreferences: {}, googleAuthEnabled: true };
    const header = await ejs.renderFile(path.resolve('src/views/partials/header.ejs'), locals);
    const visit = await ejs.renderFile(path.resolve('src/views/partials/visit-ui.ejs'), locals);
    const posts = [];
    await page.route('**/api/notifications/**', async route => { posts.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() }); await route.fulfill({ status: 201, contentType: 'application/json', body: '{"accepted":true}' }); });
    await page.route('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      const listeners = []; const subscription = { id: null, optedIn: false,
        addEventListener: (name, fn) => listeners.push(fn),
        optIn: async () => { setTimeout(() => { subscription.id = 'synthetic-device'; subscription.optedIn = true; listeners.forEach(fn => fn()); }, 100); } };
      const sdk = { init: async () => {}, login: async () => {}, Notifications: { permission: false,
        requestPermission: async () => { sdk.Notifications.permission = true; }, isPushSupported: () => true }, User: { PushSubscription: subscription } };
      window.OneSignalDeferred.forEach(fn => fn(sdk));` }));
    await page.route('**/synthetic-push-connect', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><script src="/assets/js/onesignal-client.js" defer data-app-id="synthetic-app" data-user-id="synthetic-user" data-test-sent-label="Accepted by provider" data-test-error-label="Test failed"></script></head><body>${header}${visit}</body></html>` }));
    await page.goto('/synthetic-push-connect');
    await page.waitForFunction(() => window.AlredaNotifications?.state === 'ready');
    await page.evaluate(() => { document.querySelector('.page-loader').remove(); document.querySelector('#account-dialog').showModal(); });
    const testButton = page.locator('[data-test-notifications]'); await expect(testButton).toBeHidden();
    await page.locator('[data-enable-notifications]').click();
    await expect(testButton).toBeVisible();
    await expect(page.locator('[data-enable-notifications]')).toBeDisabled();
    await testButton.click();
    await expect(page.locator('[data-notification-status]')).toHaveText('Accepted by provider');
    expect(posts).toEqual([{ path: '/api/notifications/subscriptions', body: { subscriptionId: 'synthetic-device' } }, { path: '/api/notifications/test', body: { subscriptionId: 'synthetic-device' } }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/push-connected-${width}.png` });
  });
}
