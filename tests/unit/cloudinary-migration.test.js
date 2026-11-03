const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildMediaJobs, migrateCatalogMedia } = require('../../scripts/catalog-import/cloudinary');
const { mockCloudinary } = require('../helpers/cloudinary');
const { createCloudinaryService } = require('../../src/services/cloudinary.service');
const catalog = require('../../src/config/catalog.json');
const sample = { ...catalog, products: [catalog.products[0]], collections: [] };
describe('Cloudinary catalog migration preparation', () => {
  it('retains every image, its source mapping and all variant associations without inventing missing pictures', () => {
    const jobs = buildMediaJobs(catalog);
    expect(jobs.filter(job => job.key.startsWith('product:'))).toHaveLength(catalog.products.reduce((sum, product) => sum + product.gallery.length, 0));
    expect(jobs.filter(job => job.kind === 'collection')).toHaveLength(catalog.collections.filter(collection => collection.originalImage).length);
    const first = jobs.find(job => job.localProductId === catalog.products[0].sourceId);
    expect(first.kind).toBe('product-main'); expect(first.sourceImageUrl).toBe(catalog.products[0].gallery[0].source);
    expect(jobs.some(job => job.kind === 'product-variant')).toBe(true);
    expect(jobs.find(job => job.key === 'banner:homepage').sourceImageUrl).toBe('https://alredastore.com/cdn/shop/files/IMG_4198.jpg');
    expect(jobs.find(job => job.key === 'branding:logo').sourceImageUrl).toBe('https://alredastore.com/cdn/shop/files/WhatsApp_Image_2025-02-23_at_18.24.42_d65c970f.jpg');
  });
  it('dry-runs without network calls and resumes an executed mock import without duplicate uploads', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alreda-cloudinary-'));
    const output = path.join(directory, 'report.json'); const manifestPath = path.join(directory, 'manifest.json');
    const mock = mockCloudinary();
    const service = createCloudinaryService({ ...mock, authorize: async () => true, journal: async () => {} });
    try {
      const dry = await migrateCatalogMedia(sample, { config: mock.config, service, output, manifestPath });
      expect(dry.dryRun).toBe(true); expect(mock.calls.upload).toHaveLength(0);
      const first = await migrateCatalogMedia(sample, { execute: true, config: mock.config, service, output, manifestPath });
      expect(first.failures).toEqual([]); expect(first.databaseImported).toBe(false);
      const calls = mock.calls.upload.length;
      const second = await migrateCatalogMedia(sample, { execute: true, config: mock.config, service, output, manifestPath });
      expect(second.failures).toEqual([]); expect(mock.calls.upload).toHaveLength(calls);
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      const asset = manifest.assets[`product:${sample.products[0].sourceId}:${sample.products[0].gallery[0].sourceId}`];
      expect(asset).toMatchObject({ localProductId: sample.products[0].sourceId, sourceProductUrl: sample.products[0].sourceUrl });
      expect(await fs.readFile(manifestPath, 'utf8')).not.toContain(mock.config.apiSecret);
      await fs.appendFile(manifestPath, ' ');
      await expect(migrateCatalogMedia(sample, { execute: true, config: mock.config, service, output, manifestPath })).rejects.toMatchObject({ code: 'CLOUDINARY_MANIFEST_CONFLICT' });
    } finally {
      // Only the explicitly named temporary test files are removed.
      for (const file of ['report.json', 'report-plan.json', 'manifest.json']) await fs.unlink(path.join(directory, file)).catch(() => {});
      await fs.rmdir(directory);
    }
  });
  it('records a failed upload and never activates an incomplete manifest', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alreda-cloudinary-fail-'));
    const output = path.join(directory, 'report.json'); const manifestPath = path.join(directory, 'manifest.json');
    const mock = mockCloudinary();
    const { MediaError } = require('../../src/validators/media.validator');
    const fail = async () => { throw new MediaError('INVALID_IMAGE'); };
    const service = Object.fromEntries(['uploadProductMainImage', 'uploadProductGalleryImage', 'uploadProductVariantImage', 'uploadCollectionImage', 'uploadBrandAsset', 'uploadBannerImage'].map(method => [method, fail]));
    try {
      const report = await migrateCatalogMedia(sample, { execute: true, config: mock.config, service, output, manifestPath, retries: 0 });
      expect(report.failures.length).toBe(report.jobs);
      await expect(fs.access(manifestPath)).rejects.toThrow();
    } finally { await fs.unlink(output); await fs.rmdir(directory); }
  });
  it('stops the batch after an account rate restriction instead of retrying other assets', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alreda-cloudinary-limit-'));
    const output = path.join(directory, 'report.json'); const manifestPath = path.join(directory, 'manifest.json');
    const { MediaError } = require('../../src/validators/media.validator');
    const fail = vi.fn(async () => { throw new MediaError('CLOUDINARY_RATE_LIMITED', 503); });
    try {
      const result = await migrateCatalogMedia(sample, { execute: true, config: mockCloudinary().config, service: { uploadProductMainImage: fail }, output, manifestPath });
      expect(fail).toHaveBeenCalledOnce(); expect(result.failures).toHaveLength(result.jobs);
      expect(result.failures.slice(1).every(failure => failure.code === 'NOT_ATTEMPTED_AFTER_ACCOUNT_RESTRICTION')).toBe(true);
    } finally { await fs.unlink(output); await fs.rmdir(directory); }
  });
});
