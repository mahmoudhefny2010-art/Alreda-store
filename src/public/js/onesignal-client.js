'use strict';
(() => {
  const script = document.currentScript;
  const appId = script?.dataset.appId;
  const userId = script?.dataset.userId;
  let OneSignal;
  let sdkInstance;
  let initialized = false;
  let initialization;
  let connecting = false;
  let sdkScript;
  let busy = false;
  const controller = { state: 'loading', enable };
  window.AlredaNotifications = controller;
  function publish(value, reason = '') {
    controller.state = value;
    controller.errorCode = reason;
    const reasons = { SDK_LOAD_FAILED: 'sdkErrorLabel', SDK_INIT_FAILED: 'sdkErrorLabel', ACCOUNT_CONNECTION_FAILED: 'accountErrorLabel', SUBSCRIPTION_SAVE_FAILED: 'subscriptionErrorLabel', SIGN_IN_REQUIRED: 'signInErrorLabel', DEVICE_CONNECTION_FAILED: 'deviceErrorLabel' };
    controller.message = script.dataset[reasons[reason]] || '';
    window.dispatchEvent(new Event('alreda:notifications-state'));
    const status = document.querySelector('[data-notification-status]');
    const welcome = document.querySelector('[data-welcome-dialog]');
    const keys = { enabled: 'pushEnabled', pending: 'pushPending', blocked: 'pushBlocked', loading: 'pushLoading', unsupported: 'pushUnsupported', unavailable: 'pushFailed', failed: 'pushFailed' };
    if (status && keys[value]) status.textContent = controller.message || welcome?.dataset[keys[value]] || script.dataset.errorLabel;
    const test = document.querySelector('[data-test-notifications]');
    if (test) test.hidden = value !== 'enabled';
    const button = document.querySelector('[data-enable-notifications]');
    if (button) button.disabled = value === 'enabled';
  }
  if (!appId || !userId || !('serviceWorker' in navigator) || !window.isSecureContext) { publish('unavailable'); return; }
  async function registerSubscription(subscriptionId) {
    const response = await fetch('/api/notifications/subscriptions', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscriptionId }), signal: AbortSignal.timeout(6000) }).catch(() => { throw new Error('SUBSCRIPTION_SAVE_FAILED'); });
    if (!response.ok) throw new Error(response.status === 401 ? 'SIGN_IN_REQUIRED' : 'SUBSCRIPTION_SAVE_FAILED');
    publish('enabled');
  }
  async function enable() {
    if (!OneSignal) {
      // Recover a failed SDK download or account connection on the next click.
      if (!connecting && controller.state !== 'loading') {
        if (sdkInstance) await connect(sdkInstance); else loadSdk();
      }
      return { status: OneSignal ? 'ready' : controller.state };
    }
    if (busy) return { status: 'pending' };
    if (OneSignal.Notifications.isPushSupported?.() === false) return { status: 'unsupported' };
    if (window.Notification?.permission === 'denied') { publish('blocked'); return { status: 'blocked' }; }
    busy = true;
    try {
      // Called directly from a user's click, never on page load or scrolling.
      if (!OneSignal.Notifications.permission) await OneSignal.Notifications.requestPermission();
      if (!OneSignal.Notifications.permission) {
        const status = window.Notification?.permission === 'denied' ? 'blocked' : 'unavailable';
        publish(status); return { status };
      }
      await OneSignal.User.PushSubscription.optIn();
      const id = OneSignal.User.PushSubscription.id;
      if (!id || OneSignal.User.PushSubscription.optedIn === false) { publish('pending'); return { status: 'pending' }; }
      await registerSubscription(id);
      return { status: 'enabled' };
    } catch (error) { publish('failed', ['SIGN_IN_REQUIRED', 'SUBSCRIPTION_SAVE_FAILED'].includes(error.message) ? error.message : 'DEVICE_CONNECTION_FAILED'); return { status: 'failed' }; }
    finally { busy = false; }
  }
  const accountButton = document.querySelector('[data-enable-notifications]');
  accountButton?.addEventListener('click', async () => {
    accountButton.disabled = true;
    try {
      const result = await enable();
      const status = document.querySelector('[data-notification-status]');
      const welcome = document.querySelector('[data-welcome-dialog]');
      const keys = { enabled: 'pushEnabled', pending: 'pushPending', blocked: 'pushBlocked', loading: 'pushLoading', unsupported: 'pushUnsupported', unavailable: 'pushFailed', failed: 'pushFailed' };
      if (status) status.textContent = controller.message || welcome?.dataset[keys[result.status]] || (result.status === 'ready' ? script.dataset.readyLabel || '' : script.dataset.errorLabel);
    } finally { accountButton.disabled = controller.state === 'enabled'; }
  });
  const testButton = document.querySelector('[data-test-notifications]');
  testButton?.addEventListener('click', async () => {
    testButton.disabled = true;
    const status = document.querySelector('[data-notification-status]');
    try {
      const subscriptionId = OneSignal?.User.PushSubscription.id;
      if (!subscriptionId || controller.state !== 'enabled') throw new Error('NOT_CONNECTED');
      const response = await fetch('/api/notifications/test', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscriptionId }), signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('TEST_NOT_ACCEPTED');
      if (status) status.textContent = script.dataset.testSentLabel;
    } catch { if (status) status.textContent = script.dataset.testErrorLabel; }
    finally { testButton.disabled = false; }
  });
  const preferences = document.querySelector('[data-notification-preferences]');
  if (preferences) {
    const form = preferences;
    const status = form.querySelector('[data-notification-status]');
    const read = () => ({ transactional: form.elements.transactional.checked, marketing: form.elements.marketing.checked });
    let confirmed = read();
    let revision = 0;
    let saving = false;
    form.addEventListener('submit', event => event.preventDefault());
    form.addEventListener('change', async event => {
      if (event.target !== form.elements.transactional && event.target !== form.elements.marketing) return;
      revision++;
      if (saving) return;
      saving = true;
      form.setAttribute('aria-busy', 'true');
      try {
        let processed;
        do {
          processed = revision;
          const value = read();
          status.textContent = '';
          try {
            // Serialize writes so rapid changes cannot be saved out of order.
            const response = await fetch('/api/notifications/preferences', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(6000) });
            if (!response.ok) throw new Error('PREFERENCES_NOT_SAVED');
            confirmed = value;
            if (processed === revision) status.textContent = script.dataset.savedLabel;
          } catch {
            if (processed === revision) {
              form.elements.transactional.checked = confirmed.transactional;
              form.elements.marketing.checked = confirmed.marketing;
              status.textContent = script.dataset.errorLabel;
            }
          }
        } while (processed !== revision);
      } finally {
        saving = false;
        form.setAttribute('aria-busy', 'false');
      }
    });
  }
  document.querySelector('[data-sign-out]')?.addEventListener('submit', async event => {
    if (!OneSignal) return;
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const id = OneSignal.User.PushSubscription.id;
      if (id) await fetch('/api/notifications/subscriptions', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscriptionId: id }), signal: AbortSignal.timeout(1500) });
    } catch { /* Server-side session logout proceeds even when push is unavailable. */ }
    await Promise.race([OneSignal.logout().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
    form.submit();
  });
  let timeout;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  async function boundedConnection(operation) {
    let deadline;
    try {
      return await Promise.race([operation, new Promise((resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('CONNECTION_TIMED_OUT')), 12000);
      })]);
    } finally { clearTimeout(deadline); }
  }
  async function connect(sdk) {
    if (connecting) return;
    connecting = true;
    sdkInstance = sdk;
    publish('loading');
    let phase = 'SDK_INIT_FAILED';
    try {
      if (!initialized) {
        // Reuse an in-flight initialization on retry: the SDK must only initialize once.
        if (!initialization) initialization = Promise.resolve(sdk.init({ appId, allowLocalhostAsSecureOrigin: ['localhost', '127.0.0.1', '[::1]'].includes(window.location?.hostname), serviceWorkerPath: '/onesignal/OneSignalSDKWorker.js', serviceWorkerParam: { scope: '/onesignal/' },
          notifyButton: { enable: false }, promptOptions: { slidedown: { prompts: [{ type: 'push', autoPrompt: false }] } } })).catch(error => { initialization = null; throw error; });
        await boundedConnection(initialization);
        initialized = true;
        // Install the listener early, but persist only after account login completes.
        sdk.User.PushSubscription.addEventListener?.('change', () => {
          if (OneSignal && sdk.Notifications.permission && sdk.User.PushSubscription.optedIn !== false && sdk.User.PushSubscription.id) registerSubscription(sdk.User.PushSubscription.id).catch(error => publish('failed', error.message === 'SIGN_IN_REQUIRED' ? error.message : 'SUBSCRIPTION_SAVE_FAILED'));
        });
      }
      phase = 'ACCOUNT_CONNECTION_FAILED';
      await boundedConnection(sdk.login(userId)); OneSignal = sdk; clearTimeout(timeout);
      publish(window.Notification?.permission === 'denied' ? 'blocked' : 'ready');
      phase = 'SUBSCRIPTION_SAVE_FAILED';
      if (sdk.Notifications.permission && sdk.User.PushSubscription.optedIn !== false && sdk.User.PushSubscription.id) await registerSubscription(sdk.User.PushSubscription.id);
    } catch (error) { clearTimeout(timeout); publish('unavailable', error.message === 'SIGN_IN_REQUIRED' ? error.message : phase); }
    finally { connecting = false; }
  }
  window.OneSignalDeferred.push(connect);
  function loadSdk() {
    publish('loading');
    sdkScript?.remove?.();
    timeout = setTimeout(() => { if (!OneSignal && !connecting) publish('unavailable', 'SDK_LOAD_FAILED'); }, 15000);
    sdkScript = document.createElement('script');
    sdkScript.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'; sdkScript.async = true;
    sdkScript.onerror = () => { clearTimeout(timeout); publish('unavailable', 'SDK_LOAD_FAILED'); };
    document.head.append(sdkScript);
  }
  loadSdk();
})();
