const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { readCloudinaryConfig } = require('../config/cloudinary');
const { createCloudinaryService } = require('./cloudinary.service');
const { assertManagedPublicId } = require('../utils/mediaPath');
const recordSchema = z.object({ publicId: z.string(), assetId: z.string().min(1), secureUrl: z.url(), version: z.number().int().positive(),
  resourceType: z.literal('image'), width: z.number().int().positive(), height: z.number().int().positive() }).passthrough();
const manifestSchema = z.object({ schemaVersion: z.literal(1), cloudName: z.string(), rootFolder: z.string(), assets: z.record(z.string(), recordSchema) });
function createMediaDelivery({ source = process.env, manifest: suppliedManifest } = {}) {
  const config = readCloudinaryConfig(source);
  let assets = {};
  if (config.enabled) {
    let candidate = suppliedManifest;
    if (!candidate) {
      try { candidate = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/cloudinary-media.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid Cloudinary media manifest', { cause: error }); }
    }
    if (candidate) {
      const result = manifestSchema.safeParse(candidate);
      if (!result.success || result.data.cloudName !== config.cloudName || result.data.rootFolder !== config.rootFolder) throw new Error('Invalid Cloudinary media manifest');
      assets = result.data.assets;
      for (const record of Object.values(assets)) {
        assertManagedPublicId(record.publicId, config.rootFolder);
        const url = new URL(record.secureUrl);
        if (url.origin !== 'https://res.cloudinary.com' || !url.pathname.startsWith(`/${config.cloudName}/image/upload/`)) throw new Error('Invalid Cloudinary media manifest');
      }
    }
  }
  const service = createCloudinaryService({ config, client: require('cloudinary').v2 });
  const assetUrl = (key, fallback, profile = 'product-card') => assets[key] ? service.getOptimizedImageUrl(assets[key], profile) : fallback;
  function applyCatalog(catalog) {
    return { ...catalog, products: catalog.products.map(product => ({ ...product,
      gallery: product.gallery.map(image => {
        const asset = assets[`product:${product.sourceId}:${image.sourceId}`];
        if (!asset) return image;
        const cardSrc = service.getOptimizedImageUrl(asset, 'product-card');
        const displaySrc = service.getOptimizedImageUrl(asset, 'product-detail');
        return { ...image, cloudinary: asset, src: asset.secureUrl, cardSrc, displaySrc, thumbSrc: service.getOptimizedImageUrl(asset, 'thumbnail'),
          srcSet: asset.width > 640 ? `${cardSrc} 640w, ${displaySrc} ${Math.min(asset.width, 1200)}w` : `${displaySrc} ${asset.width}w` };
      }),
    })), collections: catalog.collections.map(category => ({ ...category,
      image: assetUrl(`collection:${category.sourceId}`, category.image, 'category-card') })) };
  }
  return { assetUrl, applyCatalog, cloudName: config.enabled ? config.cloudName : null };
}
module.exports = { createMediaDelivery };
