/* global document, window, getComputedStyle, innerWidth */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('playwright');
const { translate } = require('../../src/config/storefront-i18n');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'test-results/visit-ui'); fs.mkdirSync(output, { recursive: true });
let server; let browser; let stage = 'startup';
const sdkBody = `(window.OneSignalDeferred || []).forEach(fn => { const sdk = {
  init: async options => { window.testInitOptions = options; }, login: async () => {},
  Notifications: { permission: false, isPushSupported: () => true, requestPermission: async () => { window.testPermissionCalls = (window.testPermissionCalls || 0) + 1; sdk.Notifications.permission = true; } },
  User: { PushSubscription: { id: null, optIn: async () => { sdk.User.PushSubscription.id = 'synthetic-subscription-id'; }, addEventListener: () => {} } }, logout: async () => {}
}; fn(sdk); });`;
async function main() {
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(root, 'src/views'));
  app.use('/assets', express.static(path.join(root, 'src/public'))); app.use(express.static(path.join(root, 'src/public')));
  app.get(['/', '/next', '/checkout'], (req, res) => {
    const locale = req.query.lang === 'ar' ? 'ar' : 'en';
    res.render('layouts/storefront', { title: translate(locale, 'collectionsTitle'), locale, direction: locale === 'ar' ? 'rtl' : 'ltr',
      returnTo: req.originalUrl, t: key => translate(locale, key), year: 2026, contentView: '../storefront/home', collectionGroups: [], categories: [],
      googleAuthEnabled: true, customer: req.query.signed ? { id: 'synthetic-user', name: 'Synthetic Customer', google_id: 'synthetic-google' } : null,
      onesignalAppId: 'synthetic-app', notificationPreferences: { transactional_enabled: true, marketing_enabled: false }, whatsapp: { enabled: false } });
  });
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let registrations = 0; let saveFails = false;
  async function context(options = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
    await ctx.route('https://cdn.onesignal.com/**', route => route.fulfill({ contentType: 'application/javascript', body: sdkBody }));
    await ctx.route('**/api/notifications/subscriptions', route => { registrations++; return route.fulfill({ status: saveFails ? 503 : 201, contentType: 'application/json', body: '{}' }); });
    await ctx.route('**/api/notifications/preferences', route => route.fulfill({ contentType: 'application/json', body: '{"saved":true}' }));
    return ctx;
  }
  stage = 'guest-first-visit';
  const guestContext = await context(); const guest = await guestContext.newPage();
  await guest.goto(origin); const welcome = guest.locator('#welcome-dialog'); await welcome.waitFor({ state: 'visible' });
  assert.equal(await welcome.locator('.button[href^="/auth/google"]').count(), 1);
  await welcome.locator('[data-welcome-later]').click(); assert(await welcome.locator('[data-welcome-help]').isVisible());
  await welcome.locator('[data-welcome-done]').click(); await guest.reload();
  await guest.waitForTimeout(850); assert(!(await welcome.isVisible()));
  await guest.locator('[data-open-welcome]').click(); assert(await welcome.locator('[data-welcome-help]').isVisible());
  await guest.keyboard.press('Escape'); assert(!(await welcome.isVisible()));
  assert(await guest.locator('[data-open-welcome]').evaluate(el => document.activeElement === el));
  stage = 'resume-after-sign-in';
  await guest.evaluate(() => sessionStorage.setItem('alreda-welcome-notification-intent', 'yes'));
  await guestContext.grantPermissions(['notifications'], { origin });
  await guest.goto(`${origin}/?signed=1`); await welcome.waitFor({ state: 'visible' });
  assert.equal(await guest.evaluate(() => window.testPermissionCalls || 0), 0);
  assert.equal(await guest.evaluate(() => sessionStorage.getItem('alreda-welcome-notification-intent')), null);
  await welcome.locator('[data-welcome-close]').click(); assert(!(await welcome.isVisible()));

  stage = 'authenticated-setup';
  const authContext = await context(); await authContext.grantPermissions(['notifications'], { origin });
  const page = await authContext.newPage(); const errors = []; page.on('pageerror', () => errors.push('script-error'));
  await page.goto(`${origin}/?signed=1`); const dialog = page.locator('#welcome-dialog'); await dialog.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.testPermissionCalls || 0), 0);
  assert.equal(await page.evaluate(() => window.testInitOptions.promptOptions.slidedown.prompts[0].autoPrompt), false);
  await dialog.locator('[data-welcome-notifications]').click();
  await page.waitForFunction(() => window.AlredaNotifications.state === 'enabled'); assert.equal(registrations, 1);
  assert.equal(await page.evaluate(() => window.testPermissionCalls), 1);
  await page.evaluate(() => {
    window.testInstallCalls = 0; const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.testInstallCalls++; }; event.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(event);
  });
  assert.equal(await page.evaluate(() => window.testInstallCalls), 0);
  await dialog.locator('[data-welcome-install]').click(); await page.waitForFunction(() => window.testInstallCalls === 1);
  assert.notEqual(await page.evaluate(() => window.AlredaInstall.state), 'installed');
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  assert(await dialog.locator('[data-welcome-install]').isDisabled());
  await page.screenshot({ path: path.join(output, 'desktop.png') });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  assert(!(await dialog.isVisible())); assert.deepEqual(errors, []);

  stage = 'arabic-iphone';
  const iphoneContext = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
  const iphone = await iphoneContext.newPage(); await iphone.goto(`${origin}/?lang=ar`);
  const ar = iphone.locator('#welcome-dialog'); await ar.waitFor({ state: 'visible' });
  await iphone.screenshot({ path: path.join(output, 'mobile-ar.png') });
  await ar.locator('[data-welcome-later]').click(); assert(await ar.locator('[data-install-ios]').isVisible()); assert(!(await ar.locator('[data-install-browser]').isVisible()));
  assert(await iphone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await iphone.screenshot({ path: path.join(output, 'mobile-ar-help.png') });

  stage = 'registration-failure';
  const failureContext = await context(); await failureContext.grantPermissions(['notifications'], { origin });
  const failure = await failureContext.newPage(); await failure.goto(`${origin}/?signed=1`);
  const failureDialog = failure.locator('#welcome-dialog'); await failureDialog.waitFor({ state: 'visible' }); saveFails = true;
  await failureDialog.locator('[data-welcome-notifications]').click(); await failure.waitForFunction(() => window.AlredaNotifications.state === 'failed');
  assert(await failureDialog.locator('[data-welcome-help]').isVisible()); assert.notEqual(await failure.evaluate(() => window.AlredaNotifications.state), 'enabled'); saveFails = false;

  stage = 'stalled-resource';
  const stalledContext = await context({ viewport: { width: 320, height: 700 }, reducedMotion: 'reduce' });
  let held;
  await stalledContext.route('**/bathroom-hero.jpg', route => { held = route; });
  const stalled = await stalledContext.newPage(); await stalled.goto(origin, { waitUntil: 'domcontentloaded' });
  await stalled.locator('.page-loader').waitFor({ state: 'visible' });
  assert.equal(await stalled.locator('.page-loader-spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
  await stalled.locator('[data-loader-dismiss]').click(); assert(!(await stalled.locator('.page-loader').isVisible()));
  await held.continue(); await stalled.waitForLoadState('load');

  stage = 'sdk-unavailable';
  const brokenContext = await context(); await brokenContext.route('https://cdn.onesignal.com/**', route => route.abort());
  const broken = await brokenContext.newPage(); await broken.goto(`${origin}/?signed=1`);
  const brokenDialog = broken.locator('#welcome-dialog'); await brokenDialog.waitFor({ state: 'visible' });
  await brokenDialog.locator('[data-welcome-close]').click(); await broken.locator('[data-dialog="account-dialog"]').click();
  await broken.locator('[data-notification-preferences] input[name="transactional"]').uncheck();
  await broken.waitForFunction(() => document.querySelector('[data-notification-status]').textContent.length > 0);
  assert.notEqual(await broken.evaluate(() => window.AlredaNotifications.state), 'enabled');

  stage = 'no-javascript';
  const noJsContext = await browser.newContext({ javaScriptEnabled: false }); const noJs = await noJsContext.newPage(); await noJs.goto(origin);
  assert(!(await noJs.locator('.page-loader').isVisible())); assert(!(await noJs.locator('#welcome-dialog').isVisible()));
  const checkoutContext = await context(); const checkout = await checkoutContext.newPage(); await checkout.goto(`${origin}/checkout`); await checkout.waitForTimeout(850);
  assert(!(await checkout.locator('#welcome-dialog').isVisible()));
  console.info(JSON.stringify({ passed: true, firstVisitOnce: true, notNowShowsInstructions: true, footerReopen: true, noAutomaticPermissions: true,
    nativeInstallUserGesture: true, noFalseInstallConfirmation: true, notificationSaveFailureHandled: true, arabicIosHelp: true,
    recoverableLoader: true, reducedMotion: true, noJavaScriptFallback: true, checkoutNotInterrupted: true, realAccountsChanged: 0 }));
}
main().catch(error => { console.error(JSON.stringify({ failed: true, stage, type: error.name, message: error.message.slice(0, 400) })); process.exitCode = 1; })
  .finally(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
