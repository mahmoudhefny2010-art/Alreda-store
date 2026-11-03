const { z } = require('zod');
const { createCloudinaryClient } = require('../config/cloudinary');
const { MediaError, mediaInputSchema, entityId, validateImage } = require('../validators/media.validator');
const { resolveMediaFolder, assertManagedPublicId } = require('../utils/mediaPath');
const { recordMediaEvent } = require('../repositories/media-journal.repository');
const profiles = Object.freeze({ thumbnail: 160, 'product-card': 640, 'product-detail': 1200,
  'category-card': 640, 'homepage-banner': 1920, 'mobile-banner': 768 });
const responseSchema = z.object({ public_id: z.string(), asset_id: z.string().min(1).max(200), secure_url: z.url(),
  resource_type: z.literal('image'), type: z.literal('upload').optional(), width: z.number().int().positive(), height: z.number().int().positive(),
  format: z.enum(['jpg', 'jpeg', 'png', 'webp', 'avif']), bytes: z.number().int().positive(), version: z.number().int().positive(),
  asset_folder: z.string().optional(), context: z.object({ custom: z.record(z.string(), z.string()) }).optional(),
});
function createCloudinaryService({ config, client, repository = null, authorize = async () => false, journal = recordMediaEvent } = {}) {
  if (!config || !client) { const defaults = createCloudinaryClient(); config ||= defaults.config; client ||= defaults.client; }
  const credentials = () => {
    if (!config.enabled) throw new MediaError('CLOUDINARY_NOT_CONFIGURED', 503);
    return { cloud_name: config.cloudName, api_key: config.apiKey, api_secret: config.apiSecret, secure: true, timeout: 60000 };
  };
  function providerFailure(error, fallback = 'CLOUDINARY_UPLOAD_FAILED') {
    const status = error?.http_code || error?.error?.http_code;
    if (status === 401 || status === 403) return new MediaError('CLOUDINARY_ACCESS_DENIED', 503);
    if (status === 429 || status === 420) return new MediaError('CLOUDINARY_RATE_LIMITED', 503);
    return new MediaError(fallback, 502);
  }
  async function permit(context, operation, target) {
    if (!(await authorize(context, operation, target))) throw new MediaError('MEDIA_FORBIDDEN', 403);
  }
  let modePromise;
  async function folderMode() {
    if (config.folderMode !== 'auto') return config.folderMode;
    if (!modePromise) modePromise = client.api.config({ ...credentials(), settings: true }).then(result => {
      const mode = result.folder_mode || result.settings?.folder_mode;
      if (!['fixed', 'dynamic'].includes(mode)) throw new MediaError('CLOUDINARY_FOLDER_MODE_UNKNOWN', 503);
      return mode;
    }).catch(error => { modePromise = null; throw providerFailure(error, 'CLOUDINARY_FOLDER_MODE_UNAVAILABLE'); });
    return modePromise;
  }
  function normalizeResponse(result, publicId, folder, mode, contentHash) {
    const parsed = responseSchema.safeParse(result);
    if (!parsed.success) throw new MediaError('CLOUDINARY_INVALID_RESPONSE', 502);
    const value = parsed.data;
    const url = new URL(value.secure_url);
    if (value.public_id !== publicId || url.origin !== 'https://res.cloudinary.com'
      || !url.pathname.startsWith(`/${config.cloudName}/image/upload/`) || (mode === 'dynamic' && value.asset_folder !== folder)) throw new MediaError('CLOUDINARY_INVALID_RESPONSE', 502);
    return { provider: 'cloudinary', publicId, assetId: value.asset_id, secureUrl: value.secure_url, resourceType: 'image',
      width: value.width, height: value.height, format: value.format, bytes: value.bytes, version: value.version, folder, contentHash };
  }
  const inFlight = new Map();
  const uploaded = new Map();
  async function uploadAsset(kind, buffer, source, context) {
    const input = mediaInputSchema.parse(source);
    await permit(context, 'upload', { kind, ...input });
    const options = credentials();
    const folder = resolveMediaFolder(config.rootFolder, kind, input);
    const image = await validateImage(buffer, config);
    const publicId = `${folder}/${image.contentHash}`;
    if (!inFlight.has(publicId)) {
      const pending = (async () => {
        const mode = await folderMode();
        if (uploaded.has(publicId)) return uploaded.get(publicId);
        const naming = mode === 'dynamic' ? { public_id: publicId, asset_folder: folder, use_asset_folder_as_public_id_prefix: false }
          : { public_id: image.contentHash, folder };
        let result;
        try {
          result = await new Promise((resolve, reject) => {
            const stream = client.uploader.upload_stream({ ...options, ...naming, resource_type: 'image', type: 'upload',
              overwrite: false, unique_filename: false, use_filename: false, disable_promise: true, context: { content_sha256: image.contentHash } },
            (error, response) => error ? reject(error) : resolve(response));
            stream.on('error', reject); stream.end(buffer);
          });
        } catch (error) { throw providerFailure(error); }
        try {
          // A concurrent external importer may have won the same deterministic ID.
          if (result.existing) {
            result = await client.api.resource(publicId, { ...options, resource_type: 'image', type: 'upload', context: true });
            if (result.context?.custom?.content_sha256 !== image.contentHash) throw new Error();
          }
          const asset = normalizeResponse(result, publicId, folder, mode, image.contentHash);
          await journal({ event: 'asset_uploaded', publicId: asset.publicId, assetId: asset.assetId });
          uploaded.set(publicId, asset);
          return asset;
        } catch {
          await journal({ event: 'upload_reconciliation_required', publicId, code: 'RESPONSE_OR_JOURNAL_FAILURE' });
          throw new MediaError('CLOUDINARY_RECONCILIATION_REQUIRED', 502);
        }
      })();
      inFlight.set(publicId, pending);
    }
    let asset;
    const pending = inFlight.get(publicId);
    try { asset = await pending; } finally { if (inFlight.get(publicId) === pending) inFlight.delete(publicId); }
    return { ...asset, kind, target: input, association: { entityId: input.entityId, variantId: input.variantId || null },
      altText: input.altText, displayOrder: input.displayOrder };
  }
  async function upload(kind, buffer, input, context) {
    const record = await uploadAsset(kind, buffer, input, context);
    if (!repository) return { ...record, persisted: false };
    try { return { ...record, id: await repository.attachImage(record, context), persisted: true }; }
    catch { await journal({ event: 'association_failed', publicId: record.publicId, assetId: record.assetId }); throw new MediaError('MEDIA_ASSOCIATION_FAILED', 503); }
  }
  function requireRepository() {
    if (!repository || !['getImage', 'replaceImageAssociation', 'detachImage', 'withUnreferencedAsset'].every(method => typeof repository[method] === 'function')) throw new MediaError('MEDIA_PERSISTENCE_NOT_READY', 503);
  }
  async function cleanup(record) {
    assertManagedPublicId(record.publicId, config.rootFolder);
    try {
      // The repository must lock ALL association creation/removal for this asset through this callback.
      return await repository.withUnreferencedAsset(record, async () => {
        await journal({ event: 'asset_delete_started', publicId: record.publicId, assetId: record.assetId });
        const result = await client.api.delete_resources_by_asset_ids([record.assetId], { ...credentials(), invalidate: true });
        if (!['deleted', 'not_found'].includes(result.deleted?.[record.assetId])) throw new Error();
        await journal({ event: 'asset_deleted', publicId: record.publicId, assetId: record.assetId });
        return { deleted: true };
      });
    } catch { await journal({ event: 'asset_cleanup_pending', publicId: record.publicId, assetId: record.assetId }); return { cleanupPending: true }; }
  }
  async function ownedImage(id, context, operation) {
    await permit(context, operation);
    requireRepository();
    const record = await repository.getImage(entityId.parse(id), context);
    if (!record) throw new MediaError('MEDIA_NOT_FOUND', 404);
    await permit(context, operation, record.association);
    assertManagedPublicId(record.publicId, config.rootFolder);
    z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).parse(record.assetId);
    if (record.provider !== 'cloudinary' || record.resourceType !== 'image') throw new MediaError('UNMANAGED_ASSET', 403);
    return record;
  }
  async function replaceImage(id, buffer, context) {
    const previous = await ownedImage(id, context, 'replace');
    const replacement = await uploadAsset(previous.kind, buffer, previous.target, context);
    try { await repository.replaceImageAssociation(id, previous.assetId, replacement, context); }
    catch { await journal({ event: 'replacement_association_failed', publicId: replacement.publicId, assetId: replacement.assetId, mediaId: id }); throw new MediaError('MEDIA_ASSOCIATION_FAILED', 503); }
    const result = previous.assetId === replacement.assetId ? { retained: true } : await cleanup(previous);
    return { ...replacement, id, persisted: true, cleanup: result };
  }
  async function deleteImage(id, context) {
    const previous = await ownedImage(id, context, 'delete');
    credentials();
    await repository.detachImage(id, previous.assetId, context);
    return { detached: true, cleanup: await cleanup(previous) };
  }
  async function deleteCatalogAsset(record, context) {
    await permit(context, 'delete', { kind: 'product', publicId: record?.public_id });
    const publicId = assertManagedPublicId(z.string().min(1).max(240).parse(record?.public_id), config.rootFolder);
    const assetId = record?.asset_id ? z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).parse(record.asset_id) : null;
    try {
      const result = assetId
        ? await client.api.delete_resources_by_asset_ids([assetId], { ...credentials(), invalidate: true })
        : await client.api.delete_resources([publicId], { ...credentials(), resource_type: 'image', type: 'upload', invalidate: true });
      const deleted = result.deleted?.[assetId || publicId];
      if (!['deleted', 'not_found'].includes(deleted)) throw new Error('CLOUDINARY_DELETE_FAILED');
      await journal({ event: 'asset_deleted', publicId, ...(assetId ? { assetId } : {}) });
      return { deleted: true };
    } catch {
      await journal({ event: 'asset_cleanup_pending', publicId, ...(assetId ? { assetId } : {}), code: 'CLOUDINARY_DELETE_FAILED' });
      return { deleted: false, code: 'CLOUDINARY_DELETE_FAILED' };
    }
  }
  function getOptimizedImageUrl(record, profile = 'product-detail') {
    if (!config.enabled) throw new MediaError('CLOUDINARY_NOT_CONFIGURED', 503);
    if (!Object.hasOwn(profiles, profile)) throw new MediaError('INVALID_MEDIA_PROFILE');
    const publicId = assertManagedPublicId(record.publicId, config.rootFolder);
    const version = z.number().int().positive().parse(record.version);
    return client.url(publicId, { cloud_name: config.cloudName, secure: true, resource_type: 'image', type: 'upload', sign_url: false,
      version, width: profiles[profile], crop: 'limit', quality: 'auto', fetch_format: 'auto' });
  }
  return { uploadProductMainImage: (buffer, input, context) => upload('product-main', buffer, input, context),
    uploadProductGalleryImage: (buffer, input, context) => upload('product-gallery', buffer, input, context),
    uploadProductVariantImage: (buffer, input, context) => upload('product-variant', buffer, input, context),
    uploadCategoryImage: (buffer, input, context) => upload('category', buffer, input, context),
    uploadCollectionImage: (buffer, input, context) => upload('collection', buffer, input, context),
    uploadBannerImage: (buffer, input, context) => upload('banner', buffer, input, context),
    uploadBrandAsset: (buffer, input, context) => upload('branding', buffer, input, context),
    uploadPageImage: (buffer, input, context) => upload('page', buffer, input, context),
    uploadTemporaryImage: (buffer, input, context) => upload('temporary', buffer, input, context),
    replaceImage, deleteImage, deleteCatalogAsset, getOptimizedImageUrl };
}
module.exports = { createCloudinaryService, profiles };
