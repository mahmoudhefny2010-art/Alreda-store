/* global self, caches */
'use strict';
const CACHE = 'alreda-static-v2';
const OFFLINE_URL = '/offline.html';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('alreda-static-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/checkout') || url.pathname.startsWith('/admin')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
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
