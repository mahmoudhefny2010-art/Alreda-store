'use strict';
(() => {
  const root = document.documentElement;
  let timeout;
  function finish() { root.classList.remove('is-page-loading'); clearTimeout(timeout); window.dispatchEvent(new Event('alreda:page-ready')); }
  function start() { root.classList.add('is-page-loading'); clearTimeout(timeout); timeout = setTimeout(finish, 8000); }
  // On a slow mobile connection, show the existing branded loader briefly on first visit.
  const connection = typeof navigator === 'undefined' ? undefined : navigator.connection;
  let firstLoadSeen = false;
  try { firstLoadSeen = sessionStorage.getItem('alreda:first-load-seen') === '1'; } catch { /* Storage is optional. */ }
  const isSlowMobile = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches
    && !firstLoadSeen
    && (connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType));
  if (isSlowMobile) {
    try { sessionStorage.setItem('alreda:first-load-seen', '1'); } catch { /* Storage is optional. */ }
    start();
    setTimeout(finish, 2400);
  }
  // Keep the first paint visible. The overlay is only for an in-page navigation.
  if (!isSlowMobile) document.addEventListener('DOMContentLoaded', finish, { once: true });
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
