'use strict';
(() => {
  let deferred;
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installed = standalone.matches || navigator.standalone === true;
  const changed = () => window.dispatchEvent(new Event('alreda:install-state'));
  window.AlredaInstall = {
    get state() { return installed ? 'installed' : deferred ? 'available' : 'manual'; },
    async prompt() {
      if (installed) return { status: 'installed' };
      if (!deferred) return { status: 'manual' };
      const event = deferred; deferred = null; changed();
      try {
        await event.prompt();
        const choice = await event.userChoice;
        return { status: choice.outcome === 'accepted' ? 'requested' : 'dismissed' };
      } catch { return { status: 'failed' }; }
    },
  };
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event; changed(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; changed(); });
  standalone.addEventListener?.('change', event => { if (event.matches) { installed = true; changed(); } });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    const register = () => navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
    if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
  }
})();
