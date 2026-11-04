const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { prepareVercel } = require('../../scripts/deployment/prepare-vercel');

it('serves public resources without authenticating a supplied session', async () => {
  const repository = { findSession: vi.fn() };
  const app = createApp({ environment: 'test', authSettings: {}, mediaSettings: {}, whatsappSettings: {}, authRepository: repository });
  for (const url of ['/assets/js/main.js', '/manifest.webmanifest', '/service-worker.js', '/OneSignalSDKWorker.js']) {
    await request(app).get(url).set('Cookie', `alreda_session=${'a'.repeat(43)}`).expect(200);
  }
  expect(repository.findSession).not.toHaveBeenCalled();
});

it('builds CDN paths without copying local product caches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alreda-vercel-assets-'));
  const source = path.join(root, 'src/public');
  for (const filename of ['js/main.js', 'images/products/unused.jpg', 'onesignal/OneSignalSDKWorker.js', 'manifest.webmanifest', 'offline.html', 'service-worker.js']) {
    await fs.mkdir(path.dirname(path.join(source, filename)), { recursive: true });
    await fs.writeFile(path.join(source, filename), filename);
  }
  await prepareVercel(root);
  expect(await fs.readFile(path.join(root, 'public/assets/js/main.js'), 'utf8')).toBe('js/main.js');
  expect(await fs.readFile(path.join(root, 'public/OneSignalSDKWorker.js'), 'utf8')).toBe('onesignal/OneSignalSDKWorker.js');
  await expect(fs.stat(path.join(root, 'public/assets/images/products/unused.jpg'))).rejects.toThrow();
  for (const filename of ['manifest.webmanifest', 'offline.html', 'service-worker.js', 'onesignal/OneSignalSDKWorker.js']) {
    await expect(fs.stat(path.join(root, 'public/assets', filename))).rejects.toThrow();
  }
});
