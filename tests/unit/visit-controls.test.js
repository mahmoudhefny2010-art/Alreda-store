const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../../src/public/js', name), 'utf8');

function pwa({ installed = false } = {}) {
  const listeners = {}; const register = vi.fn().mockResolvedValue({});
  const window = { isSecureContext: true, matchMedia: () => ({ matches: installed }), dispatchEvent: vi.fn(), addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(source('pwa-register.js'), { window, navigator: { serviceWorker: { register } }, document: { readyState: 'complete' }, Event });
  return { api: window.AlredaInstall, listeners, register };
}
describe('optional store installation', () => {
  it('never opens a native install prompt without an explicit request', async () => {
    const test = pwa(); const prompt = vi.fn(); const preventDefault = vi.fn();
    test.listeners.beforeinstallprompt({ preventDefault, prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    expect(preventDefault).toHaveBeenCalledOnce(); expect(prompt).not.toHaveBeenCalled();
    expect(test.api.state).toBe('available'); expect(test.register).toHaveBeenCalledOnce();
    expect(await test.api.prompt()).toMatchObject({ status: 'requested' });
    expect(prompt).toHaveBeenCalledOnce(); expect(test.api.state).not.toBe('installed');
    test.listeners.appinstalled(); expect(test.api.state).toBe('installed');
  });
  it('offers manual instructions when no event exists and consumes an event only once', async () => {
    const test = pwa(); expect(await test.api.prompt()).toMatchObject({ status: 'manual' });
    const prompt = vi.fn(); test.listeners.beforeinstallprompt({ preventDefault: vi.fn(), prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    expect(await test.api.prompt()).toMatchObject({ status: 'dismissed' });
    expect(await test.api.prompt()).toMatchObject({ status: 'manual' }); expect(prompt).toHaveBeenCalledOnce();
  });
  it('does not offer installation to an already installed app', async () => {
    const test = pwa({ installed: true }); expect(await test.api.prompt()).toMatchObject({ status: 'installed' });
  });
});

function loader() {
  const classes = new Set(); const listeners = {}; const documentListeners = {};
  const document = { documentElement: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } }, addEventListener: (name, fn) => { documentListeners[name] = fn; } };
  const timers = new Map(); let next = 0;
  vm.runInNewContext(source('page-loading.js'), { document, window: { dispatchEvent: vi.fn(), addEventListener: (name, fn) => { listeners[name] = fn; } }, Event,
    location: { href: 'https://store.example/products', origin: 'https://store.example', protocol: 'https:', pathname: '/products', search: '' }, URL,
    setTimeout: (fn, delay) => { timers.set(++next, { fn, delay }); return next; }, clearTimeout: id => timers.delete(id) });
  return { classes, listeners, documentListeners, timers };
}
describe('recoverable page loading overlay', () => {
  it('keeps the first page visible before DOM readiness', () => {
    const test = loader();
    expect(test.classes.has('is-page-loading')).toBe(false);
    test.documentListeners.DOMContentLoaded();
    expect(test.classes.has('is-page-loading')).toBe(false);
    expect(test.timers.size).toBe(0);
  });
  it('shows feedback for internal navigation, then recovers and never holds indefinitely', () => {
    const test = loader(); expect(test.classes.has('is-page-loading')).toBe(false);
    test.documentListeners.click({ button: 0, target: { closest: selector => selector === 'a[href]' ? { href: 'https://store.example/cart', hasAttribute: () => false } : null } });
    expect(test.classes.has('is-page-loading')).toBe(true);
    expect([...test.timers.values()][0].delay).toBe(8000); [...test.timers.values()][0].fn();
    expect(test.classes.has('is-page-loading')).toBe(false);
    const second = loader(); second.listeners.pageshow(); expect(second.classes.size).toBe(0);
    const third = loader(); third.listeners.load(); expect(third.classes.size).toBe(0);
  });
  it('allows a user to dismiss loading and excludes hash, external and modified navigation', () => {
    const test = loader();
    test.documentListeners.click({ target: { closest: selector => selector === '[data-loader-dismiss]' ? {} : null } });
    expect(test.classes.size).toBe(0);
    for (const href of ['https://store.example/products#top', 'https://other.example/']) {
      test.documentListeners.click({ button: 0, target: { closest: selector => selector === 'a[href]' ? { href, hasAttribute: () => false } : null } });
      expect(test.classes.size).toBe(0);
    }
    test.documentListeners.click({ button: 0, ctrlKey: true, target: { closest: () => null } }); expect(test.classes.size).toBe(0);
  });
});

function notifications({ permission = 'default', saveOk = true, delayedId = false, supported = true } = {}) {
  const window = { isSecureContext: true, Notification: { permission }, dispatchEvent: vi.fn() };
  const fetch = vi.fn().mockResolvedValue({ ok: saveOk }); let script;
  const sdk = { init: vi.fn(), login: vi.fn(), Notifications: { permission: permission === 'granted', isPushSupported: () => supported,
    requestPermission: vi.fn(async () => { sdk.Notifications.permission = true; window.Notification.permission = 'granted'; }) },
    User: { PushSubscription: { id: null, optIn: vi.fn(async () => { if (!delayedId) sdk.User.PushSubscription.id = 'synthetic-subscription'; }), addEventListener: vi.fn() } } };
  const document = { currentScript: { dataset: { appId: 'synthetic', userId: 'synthetic-user' } }, querySelector: () => null,
    createElement: () => ({}), head: { append: value => { script = value; } } };
  vm.runInNewContext(source('onesignal-client.js'), { window, document, navigator: { serviceWorker: {} }, fetch, Event, AbortSignal, setTimeout: () => 1, clearTimeout: () => {} });
  return { api: window.AlredaNotifications, sdk, fetch, start: () => window.OneSignalDeferred[0](sdk), script: () => script };
}
describe('explicit notification setup', () => {
  it('disables automatic permission prompts and confirms only after server registration', async () => {
    const test = notifications(); await test.start();
    expect(test.sdk.Notifications.requestPermission).not.toHaveBeenCalled();
    expect(test.sdk.init.mock.calls[0][0].promptOptions.slidedown.prompts[0].autoPrompt).toBe(false);
    expect(await test.api.enable()).toMatchObject({ status: 'enabled' });
    expect(test.fetch).toHaveBeenCalledWith('/api/notifications/subscriptions', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(test.api.state).toBe('enabled');
  });
  it('never reports enabled when the server rejects the subscription', async () => {
    const test = notifications({ saveOk: false }); await test.start();
    expect(await test.api.enable()).toMatchObject({ status: 'failed' }); expect(test.api.state).not.toBe('enabled');
  });
  it('handles blocked permissions and unsupported browsers without prompting', async () => {
    for (const options of [{ permission: 'denied' }, { supported: false }]) {
      const test = notifications(options); await test.start();
      expect((await test.api.enable()).status).toMatch(/blocked|unsupported/);
      expect(test.sdk.Notifications.requestPermission).not.toHaveBeenCalled(); expect(test.fetch).not.toHaveBeenCalled();
    }
  });
  it('distinguishes loading, a pending device subscription and SDK failure', async () => {
    const test = notifications({ delayedId: true }); expect(await test.api.enable()).toMatchObject({ status: 'loading' });
    await test.start(); expect(await test.api.enable()).toMatchObject({ status: 'pending' }); expect(test.fetch).not.toHaveBeenCalled();
    const failed = notifications(); failed.script().onerror();
    expect(failed.api.errorCode).toBe('SDK_LOAD_FAILED');
    expect(await failed.api.enable()).toMatchObject({ status: 'loading' });
  });
});
