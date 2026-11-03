const { z } = require('zod');
const { money, handle } = require('./shared');
const local = z.string().regex(/^\/assets\/images\/(products|collections)\/[a-f0-9]{64}(?:-\d+)?\.(jpg|png|webp|avif|gif)$/);
const normalizedSchema = z.object({ schemaVersion: z.literal(1), capturedAt: z.string(), currency: z.literal('EGP'), source: z.string(),
  products: z.array(z.object({ sourceId: z.string(), slug: handle, name: z.string().min(1),
    gallery: z.array(z.object({ src: local.nullable(), cardSrc: local.optional(), displaySrc: local.optional(), sourceId: z.string() }).passthrough()),
    collectionIds: z.array(z.string()), variants: z.array(z.object({ id: z.string().regex(/^\d+$/), priceAmount: money, compareAtAmount: money.nullable(), publicAvailable: z.boolean().nullable() }).passthrough()).min(1),
  }).passthrough()),
  collections: z.array(z.object({ sourceId: z.string(), slug: handle, name: z.string(), productIds: z.array(z.string()), image: local.nullable() }).passthrough()),
}).passthrough();
function validate(catalog) {
  normalizedSchema.parse(catalog);
  const errors = [];
  for (const [kind, rows, key] of [['product IDs', catalog.products, 'sourceId'], ['product slugs', catalog.products, 'slug'],
    ['collection IDs', catalog.collections, 'sourceId'], ['collection slugs', catalog.collections, 'slug']]) {
    if (new Set(rows.map(row => row[key])).size !== rows.length) errors.push(`Duplicate ${kind}`);
  }
  const productIds = new Set(catalog.products.map(product => product.sourceId));
  const collectionIds = new Set(catalog.collections.map(category => category.sourceId));
  const variantIds = new Set();
  for (const product of catalog.products) {
    if (product.gallery.some(image => !image.src)) errors.push(`Missing downloaded gallery image: ${product.slug}`);
    for (const variant of product.variants) {
      if (variantIds.has(variant.id)) errors.push(`Duplicate variant ID: ${variant.id}`);
      variantIds.add(variant.id);
      if (variant.imageId && !product.gallery.some(image => image.sourceId === variant.imageId)) errors.push(`Unresolved variant image: ${product.slug}/${variant.id}`);
    }
    if (product.collectionIds.some(id => !collectionIds.has(id))) errors.push(`Unknown collection: ${product.slug}`);
    if (product.collectionIds.some(id => !catalog.collections.find(category => category.sourceId === id)?.productIds.includes(product.sourceId))) errors.push(`Inconsistent collection membership: ${product.slug}`);
  }
  for (const category of catalog.collections) {
    if (category.productIds.some(id => !productIds.has(id))) errors.push(`Unknown member: ${category.slug}`);
    if (category.productIds.some(id => productIds.has(id) && !catalog.products.find(product => product.sourceId === id).collectionIds.includes(category.sourceId))) errors.push(`Inconsistent product membership: ${category.slug}`);
    if (category.sourceImage && !category.image) errors.push(`Missing collection image: ${category.slug}`);
    if (category.publicHtmlCount !== null && category.publicHtmlCount !== category.productIds.length) errors.push(`Public HTML count differs: ${category.slug}`);
    // The source metadata count can include items not published in the public storefront.
    // Keep discrepancies in the reconciliation report rather than fabricating missing records.
  }
  return errors;
}
module.exports = { validate, normalizedSchema };
