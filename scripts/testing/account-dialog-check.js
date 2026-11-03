/* global document, innerWidth, innerHeight, getComputedStyle */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const ejs = require('ejs');
const { chromium } = require('playwright');
const { translate } = require('../../src/config/storefront-i18n');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'test-results/account-dialog');
fs.mkdirSync(output, { recursive: true });
let server; let browser;
async function main() {
  const app = express(); app.use('/assets', express.static(path.join(root, 'src/public')));
  app.get('/', async (req, res) => {
    const locale = req.query.lang === 'ar' ? 'ar' : 'en';
    const header = await ejs.renderFile(path.join(root, 'src/views/partials/header.ejs'), {
      title: 'Account layout fixture', locale, returnTo: '/', t: key => translate(locale, key),
      customer: req.query.guest ? null : { name: 'Synthetic Customer With A Long Name For Responsive Layout Verification', google_id: 'synthetic', role: req.query.admin === 'primary' ? 'admin' : 'customer', user_roles: req.query.admin === 'assigned' ? [{ role: 'admin' }] : [] },
      googleAuthEnabled: true, onesignalAppId: 'synthetic-notification-app',
      notificationPreferences: { transactional_enabled: true, marketing_enabled: false }, categories: [],
    });
    res.send(`<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"></head><body class="storefront-body">${header}<script src="/assets/js/main.js"></script><script src="/assets/js/onesignal-client.js" data-app-id="synthetic" data-user-id="synthetic" data-saved-label="Saved" data-error-label="Error"></script></body></html>`);
  });
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cases = [{ name: 'desktop-en', width: 1280, locale: 'en', admin: 'primary' }, { name: 'mobile-ar', width: 390, locale: 'ar', admin: 'assigned' }, { name: 'small-mobile-en', width: 320, locale: 'en', admin: '' }];
  let saved = 0;
  for (const sample of cases) {
    const context = await browser.newContext({ viewport: { width: sample.width, height: 844 } });
    await context.route('https://cdn.onesignal.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '(window.OneSignalDeferred || []).forEach(fn => fn({ init: async () => {}, login: async () => {}, Notifications: { permission: false, requestPermission: async () => {} }, User: { PushSubscription: { id: null, optIn: async () => {} } }, logout: async () => {} }));' }));
    await context.route('**/api/notifications/preferences', route => {
      assert.deepEqual(route.request().postDataJSON(), { transactional: true, marketing: true }); saved++;
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', () => errors.push('browser-error'));
    await page.goto(`${origin}/?lang=${sample.locale}&admin=${sample.admin}`, { waitUntil: 'networkidle' });
    const trigger = page.locator('[data-dialog="account-dialog"]'); await trigger.click();
    const dialog = page.locator('#account-dialog'); assert(await dialog.isVisible());
    const workspace = dialog.locator('.account-workspace-link');
    assert.equal(await workspace.count(), sample.admin ? 1 : 0);
    if (sample.admin) {
      assert.equal(await workspace.getAttribute('href'), '/admin');
      assert.equal(await workspace.innerText(), `${translate(sample.locale, 'accountOpenAdmin')}\n↗`);
    }
    const sizes = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const boxes = [...element.querySelectorAll('input[type="checkbox"]')].map(input => input.getBoundingClientRect().width);
      return { fits: rect.width <= innerWidth && rect.height <= innerHeight && rect.width <= 420, overflows: element.scrollWidth > element.clientWidth,
        boxes, rtl: getComputedStyle(element).direction === 'rtl' };
    });
    assert(sizes.fits && !sizes.overflows); assert.deepEqual(sizes.boxes, [20, 20]); assert.equal(sizes.rtl, sample.locale === 'ar');
    await dialog.locator('input[name="marketing"]').focus(); await page.keyboard.press('Space');
    assert(await dialog.locator('input[name="marketing"]').isChecked());
    assert.equal(await dialog.locator('[data-notification-preferences] button[type="submit"]').count(), 0);
    await page.waitForFunction(() => document.querySelector('[data-notification-status]').textContent === 'Saved');
    await page.screenshot({ path: path.join(output, `${sample.name}.png`) });
    assert.equal(await dialog.locator('[data-sign-out]').getAttribute('action'), '/auth/logout');
    await page.keyboard.press('Escape'); assert(!(await dialog.isVisible())); assert(await trigger.evaluate(el => el === document.activeElement));
    await trigger.click(); await dialog.locator('.dialog-top button').click(); assert(!(await dialog.isVisible()));
    assert.deepEqual(errors, []); await context.close();
  }
  const guest = await browser.newPage(); await guest.goto(`${origin}/?guest=1`); await guest.locator('[data-dialog="account-dialog"]').click();
  assert.equal(await guest.locator('#account-dialog .google-sign-in').getAttribute('href'), '/auth/google');
  assert.equal(await guest.locator('#account-dialog .account-workspace-link').count(), 0);
  console.info(JSON.stringify({ passed: true, responsiveLayouts: cases.length, keyboardAndFocus: true, checkboxWidth: 20,
    syntheticPreferenceRequests: saved, guestSignIn: true, realAccountChanges: 0 }));
}
main().catch(error => { console.error(JSON.stringify({ failed: true, type: error.name, code: error.code || null })); process.exitCode = 1; })
  .finally(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
