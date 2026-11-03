'use strict';
(() => {
  const dialog = document.querySelector('[data-welcome-dialog]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const title = dialog.querySelector('#welcome-title');
  const intro = dialog.querySelector('[data-welcome-intro]');
  const help = dialog.querySelector('[data-welcome-help]');
  const status = dialog.querySelector('[data-welcome-status]');
  const key = 'alreda-welcome-v1';
  let opener;
  let autoTimer;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  dialog.querySelector('[data-install-ios]').hidden = !ios;
  dialog.querySelector('[data-install-browser]').hidden = ios;
  function seen() {
    for (const name of ['localStorage', 'sessionStorage']) {
      try { if (window[name].getItem(key) === 'seen') return true; } catch { /* Storage may be blocked. */ }
    }
    return document.cookie.split(';').some(value => value.trim() === `${key}=seen`);
  }
  function remember() {
    try { localStorage.setItem(key, 'seen'); return; } catch { /* Try a less persistent fallback. */ }
    try { sessionStorage.setItem(key, 'seen'); return; } catch { /* Use a non-sensitive UI cookie. */ }
    try { document.cookie = `${key}=seen; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* Browsing still works. */ }
  }
  function viewHelp(value, keepStatus = false) {
    intro.hidden = value; help.hidden = !value;
    title.textContent = value ? dialog.dataset.helpTitle : dialog.dataset.title;
    if (!keepStatus) status.textContent = '';
    title.focus(); dialog.scrollTop = 0;
  }
  function open(value, trigger) {
    if (document.querySelector('dialog[open]') && !dialog.open) return;
    opener = trigger || document.activeElement;
    viewHelp(value);
    if (!dialog.open) dialog.showModal();
    remember(); syncInstall();
    if (window.AlredaNotifications?.state === 'enabled') pushStatus('enabled');
  }
  dialog.querySelector('[data-welcome-later]').addEventListener('click', () => viewHelp(true));
  dialog.querySelector('[data-welcome-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); });
  dialog.querySelector('[data-welcome-done]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-welcome-setup]').addEventListener('click', () => viewHelp(false));
  dialog.querySelector('[data-install-help]').addEventListener('click', () => viewHelp(true));
  document.querySelectorAll('[data-open-welcome]').forEach(button => {
    button.hidden = false; button.addEventListener('click', () => open(true, button));
  });
  const installButton = dialog.querySelector('[data-welcome-install]');
  function syncInstall() {
    const installed = window.AlredaInstall?.state === 'installed';
    installButton.disabled = installed;
    if (installed) { status.textContent = dialog.dataset.installComplete; installButton.textContent = dialog.dataset.installedLabel; }
  }
  window.addEventListener('alreda:install-state', syncInstall);
  installButton.addEventListener('click', async () => {
    const result = await (window.AlredaInstall?.prompt() || Promise.resolve({ status: 'manual' }));
    if (result.status === 'manual') { viewHelp(true); return; }
    if (result.status === 'dismissed' || result.status === 'failed') viewHelp(true);
    const labels = { installed: 'installComplete', requested: 'installRequested', dismissed: 'installDismissed', failed: 'installFailed' };
    status.textContent = dialog.dataset[labels[result.status]] || '';
  });
  const notificationButton = dialog.querySelector('[data-welcome-notifications]');
  const intentKey = 'alreda-welcome-notification-intent';
  dialog.querySelector('[data-welcome-sign-in]')?.addEventListener('click', () => {
    try { sessionStorage.setItem(intentKey, 'yes'); } catch { /* The account button remains available after login. */ }
  });
  function pushStatus(value) {
    const labels = { loading: 'pushLoading', blocked: 'pushBlocked', unsupported: 'pushUnsupported', unavailable: 'pushFailed', failed: 'pushFailed', pending: 'pushPending', enabled: 'pushEnabled' };
      status.textContent = window.AlredaNotifications?.message || dialog.dataset[labels[value]] || '';
    if (notificationButton) {
      notificationButton.disabled = value === 'enabled';
      if (value === 'enabled') notificationButton.textContent = dialog.dataset.enabledLabel;
    }
  }
  notificationButton?.addEventListener('click', async () => {
    notificationButton.disabled = true;
    try {
      const result = await (window.AlredaNotifications?.enable() || Promise.resolve({ status: 'unavailable' }));
      if (['blocked', 'unsupported', 'unavailable', 'failed'].includes(result.status)) viewHelp(true);
      pushStatus(result.status);
    } catch { viewHelp(true); pushStatus('failed'); }
    finally { notificationButton.disabled = window.AlredaNotifications?.state === 'enabled'; }
  });
  window.addEventListener('alreda:notifications-state', () => {
    if (dialog.open && ['pending', 'enabled'].includes(window.AlredaNotifications?.state)) pushStatus(window.AlredaNotifications.state);
  });
  function autoOpen() {
    let resume = false;
    try { resume = Boolean(notificationButton) && sessionStorage.getItem(intentKey) === 'yes'; } catch { /* Optional UI state only. */ }
    if (seen() && !resume || /^\/(?:checkout|auth|admin)(?:\/|$)/.test(location.pathname)) return;
    if (document.querySelector('dialog[open]') || document.documentElement.classList.contains('is-page-loading')) return;
    if (resume) { try { sessionStorage.removeItem(intentKey); } catch { /* No permission is requested automatically. */ } }
    open(false);
  }
  const schedule = () => { clearTimeout(autoTimer); autoTimer = setTimeout(autoOpen, 600); };
  if (document.readyState !== 'loading') schedule(); else document.addEventListener('DOMContentLoaded', schedule, { once: true });
  window.addEventListener('alreda:page-ready', schedule);
  document.addEventListener('close', schedule, true);
  window.addEventListener('pagehide', () => clearTimeout(autoTimer));
})();
