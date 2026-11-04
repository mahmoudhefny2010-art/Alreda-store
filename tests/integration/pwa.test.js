const request = require('supertest');
const { createApp } = require('../../src/app');

describe('installable storefront shell', () => {
  const app = createApp({ environment: 'test', mediaSettings: {}, whatsappSettings: {}, databaseReadiness: async () => true });
  it('serves its manifest, offline fallback and root-scoped worker without caching private flows', async () => {
    const manifest = await request(app).get('/manifest.webmanifest').expect(200);
    expect(JSON.parse(manifest.text).name).toBe('Alreda Store');
    expect((await request(app).get('/offline.html').expect(200)).text).toContain('Offline');
    const worker = await request(app).get('/service-worker.js').expect(200);
    expect(worker.headers['service-worker-allowed']).toBe('/');
    expect(worker.text).toContain("url.pathname.startsWith('/checkout')");
    const oneSignal = await request(app).get('/onesignal/OneSignalSDKWorker.js').expect(200);
    expect(oneSignal.headers['service-worker-allowed']).toBe('/onesignal/');
    const legacyOneSignal = await request(app).get('/OneSignalSDKWorker.js?appId=local-test').expect(200);
    expect(legacyOneSignal.headers['service-worker-allowed']).toBe('/onesignal/');
    expect(legacyOneSignal.headers['cache-control']).toMatch(/no-cache/);
  });
});
