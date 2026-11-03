const { createHash } = require('node:crypto');
const { z } = require('zod');
const { mediaInputSchema, MediaError } = require('../validators/media.validator');
function stableIdentifier(value) {
  if (typeof value !== 'string' || !/^[\p{L}\p{N} _-]{1,200}$/u.test(value)) throw new MediaError('INVALID_MEDIA_IDENTIFIER');
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;
  const readable = value.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'id';
  return `${readable}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}
function resolveMediaFolder(root, kind, source) {
  const input = mediaInputSchema.parse(source);
  z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/).parse(root);
  let tail;
  if (['product-main', 'product-gallery', 'product-variant'].includes(kind)) {
    if (kind === 'product-variant' && !input.variantId) throw new MediaError('VARIANT_ID_REQUIRED');
    const key = input.sku ? stableIdentifier(input.sku) : `source-${stableIdentifier(input.entityId)}`;
    tail = `products/${key}/${{ 'product-main': 'main', 'product-gallery': 'gallery', 'product-variant': 'variants' }[kind]}`;
  } else if (['category', 'collection'].includes(kind)) {
    if (!input.slug) throw new MediaError('MEDIA_SLUG_REQUIRED');
    tail = `${kind === 'category' ? 'categories' : 'collections'}/${stableIdentifier(input.slug)}`;
  } else if (kind === 'banner' && input.placement) tail = `banners/${input.placement}`;
  else if (kind === 'branding' && input.brandType) tail = `branding/${input.brandType}`;
  else if (kind === 'page' && input.page) tail = `pages/${input.page}`;
  else if (kind === 'temporary') tail = 'temporary/imports';
  else throw new MediaError('INVALID_MEDIA_TARGET');
  return `${root}/${tail}`;
}
function assertManagedPublicId(publicId, root) {
  if (typeof publicId !== 'string' || !publicId.startsWith(`${root}/`) || !/^[a-zA-Z0-9_/-]+$/.test(publicId)
    || publicId.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new MediaError('UNMANAGED_ASSET', 403);
  return publicId;
}
module.exports = { stableIdentifier, resolveMediaFolder, assertManagedPublicId };
