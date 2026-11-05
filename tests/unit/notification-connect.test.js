const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { createNotificationRoutes } = require('../../src/routes/notification.routes');
const { createApp } = require('../../src/app');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/public/js/onesignal-client.js'), 'utf8');

function client(hostname = '127.0.0.1', timers = { setTimeout: () => 1, clearTimeout: vi.fn() }) {
  const events = {};
  const status = { textContent: '' };
  const button = { addEventListener: (name, fn) => { events[name] = fn; } };
  const test = { hidden: true, addEventListener: (name, fn) => { events[`test:${name}`] = fn; } };
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  const window = { isSecureContext: true, location: { hostname }, Notification: { permission: 'granted' }, dispatchEvent: vi.fn() };
  const elements = { '[data-notification-status]': status, '[data-enable-notifications]': button, '[data-test-notifications]': test,
    '[data-welcome-dialog]': { dataset: { pushEnabled: 'Connected', pushPending: 'Connecting', pushFailed: 'Failed', pushBlocked: 'Blocked' } } };
  const append = vi.fn();
  const document = { currentScript: { dataset: { appId: 'test-app', userId: 'test-user', testSentLabel: 'Accepted', testErrorLabel: 'Test failed' } },
    querySelector: selector => elements[selector], createElement: () => ({}), head: { append } };
  vm.runInNewContext(source, { document, window, navigator: { serviceWorker: {} }, fetch, AbortSignal, Event, ...timers });
  let changed;
  const subscription = { id: null, optedIn: true, optIn: vi.fn(), addEventListener: (name, fn) => { changed = fn; } };
  const sdk = { init: vi.fn(), login: vi.fn(), Notifications: { permission: true, isPushSupported: () => true }, User: { PushSubscription: subscription } };
  return { window, status, button, test, sdk, subscription, fetch, events, append, init: () => window.OneSignalDeferred[0](sdk), changed: () => changed() };
}

describe('push connection lifecycle', () => {
  it.each(['init', 'login'])('bounds a stalled SDK %s and allows account retry', async phase => {
    vi.useFakeTimers();
    try {
      const c = client('127.0.0.1', { setTimeout, clearTimeout });
      let release;
      c.sdk[phase].mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const connection = c.init();
      await vi.advanceTimersByTimeAsync(12000);
      await connection;
      expect(c.window.AlredaNotifications.state).toBe('unavailable');
      expect(c.window.AlredaNotifications.errorCode).toBe(phase === 'init' ? 'SDK_INIT_FAILED' : 'ACCOUNT_CONNECTION_FAILED');
      expect(c.fetch).not.toHaveBeenCalled();
      release();
      await c.events.click();
      expect(c.window.AlredaNotifications.state).toBe('ready');
      expect(c.sdk.init).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it.each(['127.0.0.1', 'localhost', 'store.example'])('sets the localhost exception only for loopback (%s)', async hostname => {
    const c = client(hostname); await c.init();
    expect(c.sdk.init).toHaveBeenCalledWith(expect.objectContaining({ allowLocalhostAsSecureOrigin: hostname !== 'store.example', serviceWorkerPath: 'onesignal/OneSignalSDKWorker.js', serviceWorkerParam: { scope: '/onesignal/' } }));
  });
  it('updates the account after delayed subscription creation and only then offers a test', async () => {
    const c = client(); await c.init();
    await c.events.click();
    expect(c.status.textContent).toBe('Connecting'); expect(c.test.hidden).toBe(true);
    c.subscription.id = 'device-subscription'; c.changed(); await new Promise(resolve => setImmediate(resolve));
    expect(c.fetch).toHaveBeenCalledWith('/api/notifications/subscriptions', expect.objectContaining({ body: JSON.stringify({ subscriptionId: 'device-subscription' }) }));
    expect(c.status.textContent).toBe('Connected'); expect(c.test.hidden).toBe(false); expect(c.button.disabled).toBe(true);
    await c.events['test:click'](); expect(c.fetch.mock.calls[1][0]).toBe('/api/notifications/test'); expect(c.status.textContent).toBe('Accepted');
  });
  it('never claims connection when persistence fails', async () => {
    const c = client(); await c.init(); c.subscription.id = 'device-subscription'; c.fetch.mockResolvedValue({ ok: false });
    await c.events.click(); expect(c.status.textContent).toBe('Failed'); expect(c.test.hidden).toBe(true);
  });
  it('retries SDK download after a blocked or failed load', async () => {
    const c = client();
    c.append.mock.calls[0][0].onerror();
    expect(c.window.AlredaNotifications.errorCode).toBe('SDK_LOAD_FAILED');
    await c.events.click();
    expect(c.append).toHaveBeenCalledTimes(2);
    expect(c.window.AlredaNotifications.state).toBe('loading');
    await c.init();
    expect(c.window.AlredaNotifications.state).toBe('ready');
  });
  it('retries account connection without initializing the SDK twice', async () => {
    const c = client(); c.sdk.login.mockRejectedValueOnce(new Error('private provider detail'));
    await c.init();
    expect(c.window.AlredaNotifications.errorCode).toBe('ACCOUNT_CONNECTION_FAILED');
    expect(c.subscription.optIn).not.toHaveBeenCalled();
    await c.events.click();
    expect(c.sdk.init).toHaveBeenCalledTimes(1);
    expect(c.sdk.login).toHaveBeenCalledTimes(2);
    expect(c.window.AlredaNotifications.state).toBe('ready');
  });
  it('distinguishes expired sessions and safely retries persistence', async () => {
    const c = client(); await c.init(); c.subscription.id = 'device-subscription';
    c.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await c.events.click();
    expect(c.window.AlredaNotifications.errorCode).toBe('SIGN_IN_REQUIRED');
    expect(c.test.hidden).toBe(true);
    await c.events.click();
    expect(c.window.AlredaNotifications.state).toBe('enabled');
  });
  it('never saves a subscription before SDK account login completes', async () => {
    const c = client(); let finish;
    c.sdk.login.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const init = c.init(); await new Promise(resolve => setImmediate(resolve));
    c.subscription.id = 'device-subscription'; c.changed();
    expect(c.fetch).not.toHaveBeenCalled();
    finish(); await init;
    expect(c.fetch).toHaveBeenCalledTimes(1);
  });
  it('explains blocked permissions without trying to opt in', async () => {
    const c = client(); await c.init(); c.window.Notification.permission = 'denied'; await c.events.click();
    expect(c.status.textContent).toBe('Blocked'); expect(c.subscription.optIn).not.toHaveBeenCalled();
  });
  it('allows the API JSONP configuration script and serves a separate worker scope', async () => {
    const app = createApp({ authSettings: { ONESIGNAL_APP_ID: 'test-app' } });
    const response = await request(app).get('/onesignal/OneSignalSDKWorker.js').expect(200);
    const legacyPath = await request(app).get('/OneSignalSDKWorker.js?appId=test-app').expect(200);
    expect(response.headers['content-security-policy']).toMatch(/script-src 'self' https:\/\/cdn.onesignal.com https:\/\/api.onesignal.com;/);
    expect(response.headers['content-security-policy']).toMatch(/connect-src 'self' https:\/\/onesignal.com https:\/\/api.onesignal.com https:\/\/cdn.onesignal.com;/);
    expect(response.headers['service-worker-allowed']).toBe('/onesignal/');
    expect(legacyPath.headers['service-worker-allowed']).toBe('/onesignal/');
    expect(legacyPath.headers['cache-control']).toMatch(/no-cache/);
  });
});

function api({ signedIn = true } = {}) {
  const repository = { ownsSubscription: vi.fn().mockResolvedValue(true) };
  const provider = { enabled: true, send: vi.fn().mockResolvedValue({ messageId: 'accepted' }) };
  const rateRepository = { consumeAuthRateLimit: vi.fn().mockResolvedValue(true) };
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (signedIn) req.customer = { id: 'authenticated-user' }; next(); });
  app.use(createNotificationRoutes({ repository, provider, rateRepository, enabled: true, clock: () => 180000 }));
  const post = (body = { subscriptionId: 'device-subscription' }, origin = 'http://store.test') => request(app).post('/api/notifications/test').set('Host', 'store.test').set('Origin', origin).send(body);
  return { repository, provider, rateRepository, post };
}
describe('current-device test notification', () => {
  it('targets only an owned persistent subscription, validates the message and rate limits', async () => {
    const a = api(); await a.post().expect(202);
    expect(a.repository.ownsSubscription).toHaveBeenCalledWith('authenticated-user', 'device-subscription');
    expect(a.provider.send).toHaveBeenCalledWith(expect.objectContaining({ subscriptionIds: ['device-subscription'], deliveryKey: expect.stringMatching(/^[a-f0-9-]{36}$/), payload: { message: expect.objectContaining({ titleAr: 'متجر الرضا', url: '/' }) } }));
    expect(a.rateRepository.consumeAuthRateLimit).toHaveBeenCalledWith(expect.any(String), expect.any(Date), 1);
    a.rateRepository.consumeAuthRateLimit.mockResolvedValue(false); await a.post().expect(429); expect(a.provider.send).toHaveBeenCalledTimes(1);
  });
  it('rejects other customers, foreign origins, unauthenticated and arbitrary-recipient requests', async () => {
    const a = api(); a.repository.ownsSubscription.mockResolvedValue(false); await a.post().expect(404);
    await a.post(undefined, 'https://foreign.test').expect(403);
    await a.post({ subscriptionId: 'device-subscription', userId: 'another-user' }).expect(400);
    await api({ signedIn: false }).post().expect(401); expect(a.provider.send).not.toHaveBeenCalled();
  });
  it('does not claim acceptance when the provider fails', async () => {
    const a = api(); a.provider.send.mockRejectedValue(new Error('provider secret error')); const response = await a.post().expect(503);
    expect(response.body).toEqual({ error: 'TEST_NOTIFICATION_UNAVAILABLE' });
  });
});
