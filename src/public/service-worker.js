/* global self, caches */
'use strict';
const CACHE = 'alreda-static-v4';
const OFFLINE_URL = '/offline.html';
const OFFLINE_ICON_URL = '/assets/images/pwa/icon-192.png';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([OFFLINE_URL, OFFLINE_ICON_URL])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('alreda-static-') && key !== CACHE).map(key => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/checkout') || url.pathname.startsWith('/admin')) return;
  if (request.mode === 'navigate') {
    // Navigation preload starts the request while the browser starts this worker.
    event.respondWith((async () => {
      try { return await event.preloadResponse || await fetch(request); }
      catch { return caches.match(OFFLINE_URL); }
    })());
    return;
  }
  if (!/^\/assets\/(?:css|js|images|fonts)\//.test(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(request);
    // CSS/JS must pick up deployed changes; use the saved copy only offline.
    if (/^\/assets\/(?:css|js)\//.test(url.pathname)) {
      try { const response = await fetch(request); if (response.ok) { await cache.put(request, response.clone()); return response; } return hit || response; }
      catch { if (hit) return hit; return Response.error(); }
    }
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  }));
});
