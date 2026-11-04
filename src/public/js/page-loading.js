'use strict';
(() => {
  const root = document.documentElement;
  let timeout;
  function finish() { root.classList.remove('is-page-loading'); clearTimeout(timeout); window.dispatchEvent(new Event('alreda:page-ready')); }
  function start() { root.classList.add('is-page-loading'); clearTimeout(timeout); timeout = setTimeout(finish, 8000); }
  // Keep the first paint visible. The overlay is only for an in-page navigation.
  document.addEventListener('DOMContentLoaded', finish, { once: true });
  window.addEventListener('load', finish, { once: true });
  window.addEventListener('pageshow', finish);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-loader-dismiss]')) { finish(); return; }
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.protocol !== location.protocol || url.pathname === location.pathname && url.search === location.search) return;
    start();
  });
})();
