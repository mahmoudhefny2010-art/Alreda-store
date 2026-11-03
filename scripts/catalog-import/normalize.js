const { z } = require('zod');
const { product, collection, origin } = require('./shared');
const aliases = require('../../src/config/collection-preview.json');
const sanitizeHtml = require('sanitize-html');
function normalize(input) {
  const raw = z.object({ capturedAt: z.string(), currency: z.literal('EGP'), source: z.string(), products: z.array(product), collections: z.array(collection),
    arabicProducts: z.array(product).default([]), arabicCollections: z.array(collection).default([]),
    memberships: z.record(z.string(), z.array(z.string())), sitemap: z.any().optional(), navigationLinks: z.array(z.string()).default([]),
    publicCollectionCounts: z.record(z.string(), z.number().nullable()).default({}),
  }).parse(input);
  const arProducts = new Map(raw.arabicProducts.map(row => [row.id, row]));
  const arCollections = new Map(raw.arabicCollections.map(row => [row.id, row]));
  const products = new Map();
  const duplicates = [];
  const collections = raw.collections.map(row => {
    const alias = aliases.find(item => decodeURIComponent(item.sourceSlug) === row.handle && item.group !== 'legacy');
    return { sourceId: row.id, sourceSlug: row.handle, slug: alias?.slug || row.handle, name: row.title,
      titleEn: row.title, titleAr: arCollections.get(row.id)?.title || null,
      descriptionHtml: row.description || null, descriptionArHtml: arCollections.get(row.id)?.description || null,
      sourceUrl: `${origin}/collections/${encodeURIComponent(row.handle)}`, parentId: null,
      sourceImage: row.image?.src || null, image: null, productIds: [...new Set(raw.memberships[row.handle] || [])],
      sourceCount: row.products_count ?? null, publicHtmlCount: raw.publicCollectionCounts[row.handle] ?? null, group: alias?.group || 'additional' };
  });
  for (const row of raw.products) {
    if (products.has(row.id)) { duplicates.push(row.id); continue; }
    const arabic = arProducts.get(row.id);
    const gallery = row.images.map((image, index) => ({ sourceId: image.id || `${row.id}-${index + 1}`, source: image.src,
      src: null, alt: image.alt || row.title, position: image.position ?? index + 1,
      width: image.width || null, height: image.height || null, variantIds: image.variant_ids || [] })).sort((a, b) => a.position - b.position);
    const specifications = [...(row.body_html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => {
      const cells = [...match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => sanitizeHtml(cell[1], { allowedTags: [], allowedAttributes: {} }).trim());
      return cells.length === 2 ? { label: cells[0], value: cells[1] } : null;
    }).filter(Boolean);
    products.set(row.id, { sourceId: row.id, slug: row.handle, name: row.title, titleEn: row.title, titleAr: arabic?.title || null,
      sourceUrl: `${origin}/products/${encodeURIComponent(row.handle)}`, vendor: row.vendor || null, productType: row.product_type || null,
      descriptionHtml: row.body_html || null, descriptionArHtml: arabic?.body_html || null, specifications,
      collectionIds: collections.filter(category => category.productIds.includes(row.id)).map(category => category.sourceId),
      tags: Array.isArray(row.tags) ? row.tags : (row.tags || '').split(',').map(tag => tag.trim()).filter(Boolean),
      updatedAt: row.updated_at || null, currency: raw.currency, gallery, options: row.options,
      publicationStatus: raw.source === 'public-storefront' || row.published_at ? 'published' : 'unknown',
      optionsAr: arabic?.options || null,
      variants: row.variants.map(variant => ({ id: variant.id, title: variant.title, titleAr: arabic?.variants.find(item => item.id === variant.id)?.title || null,
        priceAmount: variant.price, compareAtAmount: variant.compare_at_price || null,
        sku: variant.sku || null, publicAvailable: variant.available ?? null, inventoryQuantity: null,
        imageId: variant.featured_image?.id || gallery.find(image => image.variantIds.includes(variant.id))?.sourceId || null,
        options: [variant.option1, variant.option2, variant.option3].slice(0, row.options.length).map(value => value || ''),
      })) });
  }
  // Retain old URLs as aliases only; never invent a new collection membership.
  const legacyAliases = aliases.filter(item => item.group === 'legacy').map(item => ({ slug: item.slug,
    targetSlug: collections.find(category => category.sourceSlug === decodeURIComponent(item.sourceSlug))?.slug })).filter(item => item.targetSlug);
  return { schemaVersion: 1, capturedAt: raw.capturedAt, currency: raw.currency, source: raw.source, collections, products: [...products.values()],
    legacyAliases, duplicates, sitemap: raw.sitemap || null, navigationLinks: raw.navigationLinks, hierarchy: null };
}
module.exports = { normalize };
