const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createCloudinaryClient } = require('../../src/config/cloudinary');
const { createCloudinaryService } = require('../../src/services/cloudinary.service');
const { resolveMediaFolder } = require('../../src/utils/mediaPath');
const { MediaError } = require('../../src/validators/media.validator');
const root = path.resolve(__dirname, '../..');
const stateFile = path.join(root, 'data/media/cloudinary-import.json');
const manifestFile = path.join(root, 'src/config/cloudinary-media.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function buildMediaJobs(catalog) {
  const jobs = [];
  for (const product of catalog.products) {
    const sku = product.variants.find(variant => variant.sku)?.sku || undefined;
    product.gallery.forEach((image, index) => {
      const variant = product.variants.find(variant => variant.imageId === image.sourceId);
      const kind = index === 0 ? 'product-main' : variant ? 'product-variant' : 'product-gallery';
      jobs.push({ key: `product:${product.sourceId}:${image.sourceId}`, kind, localPath: image.src, contentHash: image.sha256,
        sourceProductUrl: product.sourceUrl, sourceImageUrl: image.source, localProductId: product.sourceId, sourceImageId: image.sourceId,
        input: { entityId: product.sourceId, ...(sku ? { sku } : {}), ...(kind === 'product-variant' ? { variantId: variant.id } : {}),
          altText: image.alt, displayOrder: index }, variantIds: product.variants.filter(variant => variant.imageId === image.sourceId).map(variant => variant.id) });
    });
  }
  for (const category of catalog.collections) if (category.originalImage) jobs.push({ key: `collection:${category.sourceId}`, kind: 'collection',
    localPath: category.originalImage, sourceImageUrl: category.sourceImage, sourceProductUrl: category.sourceUrl,
    input: { entityId: category.sourceId, slug: category.slug, altText: category.name, displayOrder: 0 } });
  jobs.push({ key: 'banner:homepage', kind: 'banner', localPath: '/assets/images/bathroom-hero.jpg', sourceImageUrl: 'https://alredastore.com/cdn/shop/files/IMG_4198.jpg', input: { entityId: 'homepage-hero', placement: 'homepage', device: 'desktop' } },
    { key: 'branding:logo', kind: 'branding', localPath: '/assets/images/alreda-delight-logo.jpg', sourceImageUrl: 'https://alredastore.com/cdn/shop/files/WhatsApp_Image_2025-02-23_at_18.24.42_d65c970f.jpg', input: { entityId: 'delight-logo', brandType: 'logos' } },
    { key: 'branding:whatsapp', kind: 'branding', localPath: '/assets/images/whatsapp-transparent.png', input: { entityId: 'whatsapp', brandType: 'icons' } });
  return jobs;
}
async function writeAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.pending', JSON.stringify(data, null, 2) + '\n');
  await fs.rename(file + '.pending', file);
}
async function migrateCatalogMedia(catalog, { execute = false, service: providedService, config: suppliedConfig, retries = 2,
  output = stateFile, manifestPath = manifestFile, refreshExisting = false, onProgress = () => {} } = {}) {
  const defaults = suppliedConfig ? null : createCloudinaryClient();
  const config = suppliedConfig || defaults.config;
  const jobs = buildMediaJobs(catalog);
  const context = Object.freeze({ job: 'authorized-catalog-media-migration' });
  const service = providedService || createCloudinaryService({ config, client: defaults?.client || require('cloudinary').v2, authorize: async actor => actor === context });
  const counts = { jobs: jobs.length, missingSourceImages: catalog.collections.filter(category => !category.originalImage).length,
    productsWithoutSku: catalog.products.filter(product => !product.variants.some(variant => variant.sku)).length,
    uploadedOrReused: 0, failures: [], databaseImported: false, dryRun: !execute };
  // A dry run makes no SDK/network calls and never activates Cloudinary delivery.
  if (!execute) {
    counts.folderCounts = {};
    for (const job of jobs) {
      const folder = resolveMediaFolder(config.rootFolder, job.kind, job.input);
      counts.folderCounts[folder] = (counts.folderCounts[folder] || 0) + 1;
    }
    await writeAtomic(output.replace(/\.json$/, '-plan.json'), counts);
    return counts;
  }
  if (!config.enabled) throw new MediaError('CLOUDINARY_NOT_CONFIGURED', 503);
  let state = { schemaVersion: 1, cloudName: config.cloudName, rootFolder: config.rootFolder, assets: {} };
  let oldBytes;
  try {
    oldBytes = await fs.readFile(manifestPath);
    state = JSON.parse(oldBytes);
    const ownership = JSON.parse(await fs.readFile(output, 'utf8'));
    if (ownership.manifestHash !== digest(oldBytes)) throw new Error();
  } catch (error) { if (error.code !== 'ENOENT' || oldBytes) throw new MediaError('CLOUDINARY_MANIFEST_CONFLICT', 409); }
  if (state.cloudName !== config.cloudName || state.rootFolder !== config.rootFolder) throw new MediaError('CLOUDINARY_MANIFEST_CONFLICT', 409);
  // Recover completed jobs after an interrupted run; their original bytes are still checked below.
  let checkpoint;
  try { checkpoint = JSON.parse(await fs.readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new MediaError('CLOUDINARY_MANIFEST_CONFLICT', 409); }
  if (checkpoint?.state?.cloudName === config.cloudName && checkpoint.state.rootFolder === config.rootFolder) {
    state.assets = { ...state.assets, ...checkpoint.state.assets };
  }
  const methods = { 'product-main': 'uploadProductMainImage', 'product-gallery': 'uploadProductGalleryImage', 'product-variant': 'uploadProductVariantImage',
    collection: 'uploadCollectionImage', banner: 'uploadBannerImage', branding: 'uploadBrandAsset' };
  for (const [index, job] of jobs.entries()) {
    const filename = path.resolve(root, 'src/public', job.localPath.replace(/^\/assets\//, ''));
    const allowed = path.resolve(root, 'src/public/images') + path.sep;
    try {
      if (!job.localPath.startsWith('/assets/images/') || !filename.startsWith(allowed)) throw new MediaError('INVALID_LOCAL_MEDIA_PATH');
      const bytes = await fs.readFile(filename);
      if (job.contentHash && job.contentHash !== digest(bytes)) throw new MediaError('IMAGE_CHECKSUM_MISMATCH');
      let asset;
      const previous = state.assets[job.key];
      const expectedHash = digest(bytes);
      const folder = resolveMediaFolder(config.rootFolder, job.kind, job.input);
      if (!refreshExisting && previous && previous.contentHash === expectedHash && previous.publicId === `${folder}/${expectedHash}`
        && previous.folder === folder && /^[a-zA-Z0-9_-]{1,200}$/.test(previous.assetId) && previous.resourceType === 'image'
        && previous.width > 0 && previous.height > 0 && previous.version > 0 && previous.secureUrl?.startsWith(`https://res.cloudinary.com/${config.cloudName}/image/upload/`)) asset = previous;
      for (let attempt = 0; !asset && attempt <= retries; attempt++) {
        try { asset = await service[methods[job.kind]](bytes, job.input, context); break; }
        catch (error) {
          if (attempt === retries || !['CLOUDINARY_UPLOAD_FAILED', 'CLOUDINARY_UNAVAILABLE'].includes(error.code)) throw error;
          await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
        }
      }
      state.assets[job.key] = { ...asset, sourceProductUrl: job.sourceProductUrl || null, sourceImageUrl: job.sourceImageUrl || null,
        localProductId: job.localProductId || null, sourceImageId: job.sourceImageId || null, variantIds: job.variantIds || [], source: 'catalog-import' };
      counts.uploadedOrReused++;
    } catch (error) {
      counts.failures.push({ key: job.key, code: error instanceof MediaError ? error.code : 'MEDIA_IMPORT_FAILED' });
      if (['CLOUDINARY_ACCESS_DENIED', 'CLOUDINARY_RATE_LIMITED', 'CLOUDINARY_FOLDER_MODE_UNAVAILABLE'].includes(error.code)) {
        for (const remaining of jobs.slice(index + 1)) counts.failures.push({ key: remaining.key, code: 'NOT_ATTEMPTED_AFTER_ACCOUNT_RESTRICTION' });
        await writeAtomic(output, { ...counts, state, manifestHash: oldBytes ? digest(oldBytes) : null });
        break;
      }
    }
    if ((index + 1) % 20 === 0 || index === jobs.length - 1) {
      await writeAtomic(output, { ...counts, state, manifestHash: oldBytes ? digest(oldBytes) : null });
      onProgress({ completed: index + 1, total: jobs.length, failed: counts.failures.length });
    }
  }
  if (!counts.failures.length) {
    // Generated manifest contains identifiers/delivery URLs only, never credentials or signed parameters.
    await writeAtomic(manifestPath, state);
    const manifestHash = digest(await fs.readFile(manifestPath));
    await writeAtomic(output, { ...counts, state, manifestHash });
  }
  return counts;
}
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  migrateCatalogMedia(require('../../src/config/catalog.json'), { execute: process.argv.includes('--execute'),
    refreshExisting: process.argv.includes('--refresh-existing'),
    onProgress: progress => console.info(JSON.stringify(progress)),
  }).then(result => { console.info(JSON.stringify({ jobs: result.jobs, uploadedOrReused: result.uploadedOrReused, failures: result.failures.length, dryRun: result.dryRun, databaseImported: false })); if (result.failures.length) process.exitCode = 1; })
    .catch(error => { console.error('Cloudinary media migration stopped:', error instanceof MediaError ? error.code : 'CHECK_MEDIA_CONFIGURATION'); process.exitCode = 1; });
}
module.exports = { buildMediaJobs, migrateCatalogMedia };
