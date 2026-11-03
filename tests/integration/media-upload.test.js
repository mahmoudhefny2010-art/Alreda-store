const request = require('supertest');
const express = require('express');
const sharp = require('sharp');
const { createUploadMiddleware } = require('../../src/middleware/upload.middleware');
const { readCloudinaryConfig } = require('../../src/config/cloudinary');
const { createApp } = require('../../src/app');
const { source } = require('../helpers/cloudinary');
function uploadApp(options = {}) {
  const app = express();
  // Synthetic test authorization only. Production must inject verified session permissions.
  app.post('/upload', createUploadMiddleware({ config: readCloudinaryConfig({ ...source, ...options }), authorizeAdmin: req => req.get('x-test-admin') === 'yes' }),
    (req, res) => res.json({ count: req.files.length, dimensions: req.files.map(file => [file.validatedImage.width, file.validatedImage.height]) }));
  app.use((error, req, res, next) => { void next; res.status(error.status || 500).json({ code: error.code || 'UPLOAD_FAILED' }); });
  return app;
}
const image = () => sharp({ create: { width: 32, height: 48, channels: 3, background: 'red' } }).png().toBuffer();
describe('future admin upload boundary', () => {
  it('requires an explicit verified-admin policy and rejects unauthenticated multipart before parsing', async () => {
    expect(() => createUploadMiddleware()).toThrow('ADMIN_AUTHORIZER_REQUIRED');
    await request(uploadApp()).post('/upload').field('role', 'admin').attach('images', await image(), 'photo.png').expect(403).expect({ code: 'ADMIN_REQUIRED' });
  });
  it('accepts validated real image bytes without using filenames as storage paths', async () => {
    const response = await request(uploadApp()).post('/upload').set('x-test-admin', 'yes').attach('images', await image(), '../../unsafe-name.png').expect(200);
    expect(response.body).toEqual({ count: 1, dimensions: [[32, 48]] });
  });
  it('rejects MIME-spoofed files, unsupported types and empty submissions', async () => {
    await request(uploadApp()).post('/upload').set('x-test-admin', 'yes').attach('images', Buffer.from('<script>unsafe</script>'), { filename: 'fake.png', contentType: 'image/png' }).expect(400);
    await request(uploadApp()).post('/upload').set('x-test-admin', 'yes').attach('images', await image(), { filename: 'fake.jpg', contentType: 'image/jpeg' }).expect(400);
    await request(uploadApp()).post('/upload').set('x-test-admin', 'yes').attach('images', Buffer.from('<svg/>'), { filename: 'vector.svg', contentType: 'image/svg+xml' }).expect(400);
    await request(uploadApp()).post('/upload').set('x-test-admin', 'yes').expect(400);
  });
  it('enforces configurable file counts and byte limits', async () => {
    const bytes = await image();
    await request(uploadApp({ MEDIA_MAX_IMAGE_COUNT: '1' })).post('/upload').set('x-test-admin', 'yes').attach('images', bytes, 'one.png').attach('images', bytes, 'two.png').expect(400);
    await request(uploadApp({ MEDIA_MAX_UPLOAD_BYTES: '1024' })).post('/upload').set('x-test-admin', 'yes').attach('images', Buffer.alloc(2048), 'big.png').expect(413);
  });
  it('does not mount any public upload or destructive media endpoint in the actual application', async () => {
    const app = createApp({ environment: 'test' });
    await request(app).post('/admin/media').send({ role: 'admin' }).expect(404);
    await request(app).delete('/admin/media/example').expect(404);
  });
  it('allows only the configured Cloudinary image namespace and exposes no credentials', async () => {
    const manifest = { schemaVersion: 1, cloudName: source.CLOUDINARY_CLOUD_NAME, rootFolder: 'alreda-store', assets: {
      'branding:logo': { publicId: 'alreda-store/branding/logos/example', assetId: 'asset-1', version: 1, resourceType: 'image', width: 64, height: 64,
        secureUrl: 'https://res.cloudinary.com/alreda-test/image/upload/v1/alreda-store/branding/logos/example.png' },
    } };
    const response = await request(createApp({ environment: 'test', mediaSettings: source, mediaManifest: manifest })).get('/').expect(200);
    expect(response.headers['content-security-policy']).toContain('https://res.cloudinary.com/alreda-test/');
    expect(response.text).toContain('res.cloudinary.com/alreda-test/image/upload/');
    expect(response.text).not.toContain(source.CLOUDINARY_API_SECRET);
    expect(response.text).not.toContain('CLOUDINARY_API_SECRET');
  });
});
