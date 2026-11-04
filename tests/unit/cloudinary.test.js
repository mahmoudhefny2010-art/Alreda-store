const sharp = require('sharp');
const { Writable } = require('node:stream');
const { readCloudinaryConfig } = require('../../src/config/cloudinary');
const { readEnvironment } = require('../../src/config/environment');
const { resolveMediaFolder, stableIdentifier } = require('../../src/utils/mediaPath');
const { createCloudinaryService } = require('../../src/services/cloudinary.service');
const { createMediaDelivery } = require('../../src/services/media-delivery.service');
const { mockCloudinary, source } = require('../helpers/cloudinary');
const { validateImage } = require('../../src/validators/media.validator');
const input = { entityId: 'product-1', sku: 'TH-001', altText: 'Towel holder', displayOrder: 2 };
const image = color => sharp({ create: { width: 64, height: 80, channels: 3, background: color } }).png().toBuffer();
function serviceFor(mock, extra = {}) {
  return createCloudinaryService({ ...mock, authorize: async context => context?.verifiedAdmin === true,
    journal: async () => {}, ...extra });
}
const admin = Object.freeze({ verifiedAdmin: true });
describe('Cloudinary configuration and paths', () => {
  it('allows an unconfigured store and rejects partial config without leaking its values', () => {
    expect(readCloudinaryConfig({}).enabled).toBe(false);
    expect(() => readEnvironment({ CLOUDINARY_API_SECRET: 'never-display-this' })).toThrow('CLOUDINARY_CLOUD_NAME');
    try { readCloudinaryConfig({ CLOUDINARY_API_SECRET: 'never-display-this' }); } catch (error) { expect(error.message).not.toContain('never-display-this'); }
    expect(() => readCloudinaryConfig({ ...source, CLOUDINARY_ROOT_FOLDER: '../outside' })).toThrow('CLOUDINARY_ROOT_FOLDER');
  });
  it.each([
    ['product-main', input, 'products/TH-001/main'], ['product-gallery', input, 'products/TH-001/gallery'],
    ['product-variant', { ...input, variantId: 'v-1' }, 'products/TH-001/variants'],
    ['category', { entityId: '1', slug: 'soap-dispensers' }, 'categories/soap-dispensers'],
    ['collection', { entityId: '1', slug: 'mirrors' }, 'collections/mirrors'],
    ['banner', { entityId: 'home', placement: 'homepage' }, 'banners/homepage'],
    ['banner', { entityId: 'offer', placement: 'promotions' }, 'banners/promotions'],
    ['banner', { entityId: 'winter', placement: 'seasonal' }, 'banners/seasonal'],
    ['branding', { entityId: 'logo', brandType: 'logos' }, 'branding/logos'],
    ['branding', { entityId: 'icon', brandType: 'icons' }, 'branding/icons'],
    ['page', { entityId: 'about', page: 'about' }, 'pages/about'], ['page', { entityId: 'contact', page: 'contact' }, 'pages/contact'],
    ['temporary', { entityId: 'import-1' }, 'temporary/imports'],
  ])('resolves %s into its required logical folder', (kind, target, expected) => {
    expect(resolveMediaFolder('alreda-store', kind, target)).toBe('alreda-store/' + expected);
  });
  it('uses stable source IDs when SKU is unknown and collision-resistant Unicode identifiers', () => {
    expect(resolveMediaFolder('alreda-store', 'product-main', { entityId: '123' })).toBe('alreda-store/products/source-123/main');
    expect(stableIdentifier('عين سحرية')).toBe(stableIdentifier('عين سحرية'));
    expect(stableIdentifier('عين سحرية')).not.toBe(stableIdentifier('كوالين'));
  });
  it.each(['../x', '/root', 'a\\b', '%2e%2e', 'a.b', 'a\nname'])('rejects unsafe identifier %s', value => {
    expect(() => stableIdentifier(value)).toThrow();
  });
});
describe('Cloudinary media operations (mock SDK only)', () => {
  it.each(['fixed', 'dynamic'])('uploads and deduplicates in %s folder mode without overwriting', async mode => {
    const mock = mockCloudinary(mode); const service = serviceFor(mock); const bytes = await image('red');
    const [first, concurrent] = await Promise.all([service.uploadProductMainImage(bytes, input, admin), service.uploadProductMainImage(bytes, input, admin)]);
    const repeated = await service.uploadProductMainImage(bytes, input, admin);
    expect(first.publicId).toBe(concurrent.publicId); expect(repeated.assetId).toBe(first.assetId);
    expect(mock.calls.upload).toHaveLength(1);
    expect(first).toMatchObject({ persisted: false, resourceType: 'image', displayOrder: 2, association: { entityId: 'product-1', variantId: null } });
    const options = mock.calls.upload[0];
    expect(options.overwrite).toBe(false); expect(options).not.toHaveProperty('transformation');
    if (mode === 'dynamic') expect(options.asset_folder).toBe('alreda-store/products/TH-001/main');
    else { expect(options.folder).toBe('alreda-store/products/TH-001/main'); expect(options).not.toHaveProperty('asset_folder'); }
  });
  it('detects the actual account folder mode once', async () => {
    const mock = mockCloudinary('fixed'); mock.config = readCloudinaryConfig({ ...source, CLOUDINARY_FOLDER_MODE: 'auto' });
    const service = serviceFor(mock);
    await service.uploadProductMainImage(await image('red'), input, admin);
    await service.uploadProductGalleryImage(await image('blue'), input, admin);
    expect(mock.calls.config).toBe(1); expect(mock.calls.upload.every(call => call.folder && !call.asset_folder)).toBe(true);
  });
  it.each(['uploadProductMainImage', 'uploadProductGalleryImage', 'uploadCategoryImage', 'uploadBannerImage', 'uploadBrandAsset', 'uploadCollectionImage', 'uploadProductVariantImage'])('validates and returns metadata for %s', async operation => {
    const mock = mockCloudinary(); const service = serviceFor(mock);
    const result = await service[operation](await image('red'), { ...input, slug: 'soap-holder', placement: 'homepage', brandType: 'logos', variantId: 'variant-1' }, admin);
    expect(result.publicId).toMatch(/^alreda-store\//); expect(result.secureUrl).toMatch(/^https:\/\/res.cloudinary.com\//);
    expect(result).toHaveProperty('contentHash'); expect(result.bytes).toBeGreaterThan(0);
  });
  it('refuses unauthorized and unconfigured uploads before calling the SDK', async () => {
    const mock = mockCloudinary(); const bytes = await image('red');
    await expect(serviceFor(mock).uploadProductMainImage(bytes, input, {})).rejects.toMatchObject({ code: 'MEDIA_FORBIDDEN' });
    await expect(createCloudinaryService({ ...mock }).uploadProductMainImage(bytes, input, admin)).rejects.toMatchObject({ code: 'MEDIA_FORBIDDEN' });
    await expect(serviceFor(mock, { config: readCloudinaryConfig({}) }).uploadProductMainImage(bytes, input, admin)).rejects.toMatchObject({ code: 'CLOUDINARY_NOT_CONFIGURED' });
    expect(mock.calls.upload).toHaveLength(0);
  });
  it('rejects disguised, truncated and oversized files before any SDK call', async () => {
    const mock = mockCloudinary(); const service = serviceFor(mock);
    for (const bytes of [Buffer.from('<svg><script>unsafe()</script></svg>'), Buffer.from('not an image'), (await image('red')).subarray(0, 40)]) {
      await expect(service.uploadProductMainImage(bytes, input, admin)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    }
    const restricted = serviceFor(mock, { config: { ...mock.config, maxUploadBytes: 10 } });
    await expect(restricted.uploadProductMainImage(await image('red'), input, admin)).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(mock.calls.upload).toHaveLength(0);
  });
  it.each(['jpeg', 'png', 'webp', 'avif'])('accepts real %s bytes when the installed decoder supports them', async format => {
    const bytes = await sharp({ create: { width: 32, height: 48, channels: 3, background: 'white' } }).toFormat(format).toBuffer();
    const result = await validateImage(bytes, mockCloudinary().config);
    expect(result).toMatchObject({ width: 32, height: 48, format });
  });
  it('rejects deletion outside the managed root or without permission before detaching anything', async () => {
    const mock = mockCloudinary(); const first = await serviceFor(mock).uploadProductMainImage(await image('red'), input, admin);
    const repository = { getImage: async () => ({ ...first, publicId: 'foreign-store/image' }), replaceImageAssociation: async () => {}, detachImage: vi.fn(), withUnreferencedAsset: vi.fn() };
    const service = serviceFor(mock, { repository });
    await expect(service.deleteImage('media-1', {})).rejects.toMatchObject({ code: 'MEDIA_FORBIDDEN' });
    await expect(service.deleteImage('media-1', admin)).rejects.toMatchObject({ code: 'UNMANAGED_ASSET' });
    expect(repository.detachImage).not.toHaveBeenCalled(); expect(mock.calls.delete).toHaveLength(0);
  });
  it('never forwards raw Cloudinary errors containing signed parameters', async () => {
    const mock = mockCloudinary();
    mock.client.uploader.upload_stream = (options, callback) => new Writable({ write(chunk, encoding, next) { next(); }, final(next) { callback({ message: 'secret-signature-and-key' }); next(); } });
    await expect(serviceFor(mock).uploadProductMainImage(await image('red'), input, admin)).rejects.toMatchObject({ message: 'CLOUDINARY_UPLOAD_FAILED' });
  });
  it('generates bounded automatic format/quality delivery URLs without secrets', async () => {
    const mock = mockCloudinary(); const service = serviceFor(mock);
    const asset = await service.uploadProductMainImage(await image('red'), input, admin);
    const url = service.getOptimizedImageUrl(asset, 'product-card');
    expect(url).toContain('f_auto'); expect(url).toContain('q_auto'); expect(url).toContain('w_640'); expect(url).toContain('c_limit');
    expect(url).not.toContain(source.CLOUDINARY_API_SECRET); expect(url).not.toContain('s--');
    expect(() => service.getOptimizedImageUrl({ ...asset, publicId: 'another-store/image' })).toThrow('UNMANAGED_ASSET');
    expect(() => service.getOptimizedImageUrl(asset, 'unsafe')).toThrow('INVALID_MEDIA_PROFILE');
  });
  it('associates uploads through an injected repository and records persistence failures', async () => {
    const mock = mockCloudinary(); const attachImage = vi.fn(async () => 'media-1'); const events = [];
    const service = serviceFor(mock, { repository: { attachImage }, journal: async event => events.push(event) });
    const result = await service.uploadProductMainImage(await image('red'), input, admin);
    expect(result.persisted).toBe(true); expect(result.id).toBe('media-1'); expect(attachImage).toHaveBeenCalledOnce();
    attachImage.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.uploadProductMainImage(await image('blue'), input, admin)).rejects.toMatchObject({ code: 'MEDIA_ASSOCIATION_FAILED' });
    expect(events.some(event => event.event === 'association_failed')).toBe(true); expect(mock.calls.delete).toHaveLength(0);
  });
  it('fails closed for delete/replace without a persistence adapter', async () => {
    const mock = mockCloudinary(); const service = serviceFor(mock);
    await expect(service.deleteImage('media-1', admin)).rejects.toMatchObject({ code: 'MEDIA_PERSISTENCE_NOT_READY' });
    await expect(service.replaceImage('media-1', await image('red'), admin)).rejects.toMatchObject({ code: 'MEDIA_PERSISTENCE_NOT_READY' });
    expect(mock.calls.delete).toHaveLength(0); expect(mock.calls.upload).toHaveLength(0);
  });
  it('uploads, updates the association, then deletes only the unreferenced old asset', async () => {
    const mock = mockCloudinary(); const first = await serviceFor(mock).uploadProductMainImage(await image('red'), input, admin);
    const steps = [];
    const repository = { getImage: async () => first,
      attachImage: async () => 'media-1', replaceImageAssociation: async () => steps.push('database-updated'), detachImage: async () => steps.push('database-detached'),
      withUnreferencedAsset: async (record, remove) => { steps.push('references-locked'); return remove(); } };
    const service = serviceFor(mock, { repository, journal: async event => steps.push(event.event) });
    const result = await service.replaceImage('media-1', await image('blue'), admin);
    expect(steps.indexOf('database-updated')).toBeGreaterThan(steps.indexOf('asset_uploaded'));
    expect(steps.indexOf('asset_delete_started')).toBeGreaterThan(steps.indexOf('database-updated'));
    expect(result.cleanup).toEqual({ deleted: true }); expect(mock.calls.delete).toEqual([[first.assetId]]);
  });
  it('retains shared assets and records pending cleanup when deletion fails', async () => {
    const mock = mockCloudinary(); const asset = await serviceFor(mock).uploadProductMainImage(await image('red'), input, admin); const events = [];
    const repository = { getImage: async () => asset, attachImage: async () => 'id', replaceImageAssociation: async () => {}, detachImage: vi.fn(async () => {}),
      withUnreferencedAsset: async () => ({ retained: true }) };
    const service = serviceFor(mock, { repository, journal: async event => events.push(event) });
    expect((await service.deleteImage('media-1', admin)).cleanup).toEqual({ retained: true }); expect(mock.calls.delete).toHaveLength(0);
    repository.withUnreferencedAsset = async (record, remove) => remove();
    mock.client.api.delete_resources_by_asset_ids = async () => { throw new Error('provider failure'); };
    expect((await service.deleteImage('media-1', admin)).cleanup).toEqual({ cleanupPending: true });
    expect(events.some(event => event.event === 'asset_cleanup_pending')).toBe(true);
  });
  it('deletes product assets only from the configured Cloudinary folder and reports retryable failures', async () => {
    const mock = mockCloudinary();
    const service = serviceFor(mock);
    mock.client.api.delete_resources_by_asset_ids = async ids => ({ deleted: { [ids[0]]: 'deleted' } });
    await expect(service.deleteCatalogAsset({ public_id: 'alreda-store/products/example/main/image', asset_id: 'asset-1' }, admin)).resolves.toEqual({ deleted: true });
    expect(mock.calls.delete).toEqual([]);
    await expect(service.deleteCatalogAsset({ public_id: 'foreign/products/example/image', asset_id: 'asset-1' }, admin)).rejects.toMatchObject({ code: 'UNMANAGED_ASSET' });
    mock.client.api.delete_resources_by_asset_ids = async () => { throw new Error('provider failure'); };
    await expect(service.deleteCatalogAsset({ public_id: 'alreda-store/products/example/main/image', asset_id: 'asset-1' }, admin)).resolves.toEqual({ deleted: false, code: 'CLOUDINARY_DELETE_FAILED' });
  });
  it('does not delete the old asset when the association update fails', async () => {
    const mock = mockCloudinary(); const old = await serviceFor(mock).uploadProductMainImage(await image('red'), input, admin); const events = [];
    const repository = { getImage: async () => old, replaceImageAssociation: async () => { throw new Error(); }, detachImage: async () => {}, withUnreferencedAsset: async () => {} };
    await expect(serviceFor(mock, { repository, journal: async event => events.push(event) }).replaceImage('media-1', await image('blue'), admin)).rejects.toMatchObject({ code: 'MEDIA_ASSOCIATION_FAILED' });
    expect(mock.calls.delete).toHaveLength(0); expect(events.some(event => event.event === 'replacement_association_failed')).toBe(true);
  });
  it('delivers manifest media only for its configured cloud and preserves local fallback', async () => {
    const mock = mockCloudinary(); const asset = await serviceFor(mock).uploadProductMainImage(await image('red'), input, admin);
    const manifest = { schemaVersion: 1, cloudName: mock.config.cloudName, rootFolder: mock.config.rootFolder, assets: { 'branding:logo': asset } };
    const delivery = createMediaDelivery({ source, manifest });
    expect(delivery.assetUrl('branding:logo', '/local.jpg')).toContain('res.cloudinary.com/alreda-test/');
    expect(delivery.assetUrl('unknown', '/local.jpg')).toBe('/local.jpg');
    expect(createMediaDelivery({ source: {}, manifest }).assetUrl('branding:logo', '/local.jpg')).toBe('/local.jpg');
    const publicDelivery = createMediaDelivery({ source: { MEDIA_PUBLIC_MANIFEST: 'true' }, manifest });
    expect(publicDelivery.assetUrl('branding:logo', '/local.jpg')).toContain('res.cloudinary.com/alreda-test/');
    expect(publicDelivery.assetUrl('branding:logo', '/local.jpg')).not.toContain(source.CLOUDINARY_API_SECRET);
    expect(() => createMediaDelivery({ source, manifest: { ...manifest, cloudName: 'foreign' } })).toThrow();
  });
});
