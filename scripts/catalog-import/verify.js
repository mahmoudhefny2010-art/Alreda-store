// Independent reconciliation against captured source fields, not rendered page counts.
function verify(catalog, source) {
  const errors = [];
  const input = new Map(source.products.map(product => [String(product.id), product]));
  const localized = new Map((source.arabicProducts || []).map(product => [String(product.id), product]));
  for (const product of catalog.products) {
    const original = input.get(product.sourceId);
    if (!original) { errors.push(`No source product: ${product.slug}`); continue; }
    if (product.name !== original.title || product.descriptionHtml !== (original.body_html || null)) errors.push(`Source content differs: ${product.slug}`);
    if (product.titleAr !== (localized.get(product.sourceId)?.title || null)) errors.push(`Arabic content differs: ${product.slug}`);
    const originals = [...original.images].sort((a, b) => (a.position || 0) - (b.position || 0));
    if (originals.length !== product.gallery.length || originals.some((image, index) => image.src !== product.gallery[index]?.source)) errors.push(`Source gallery differs: ${product.slug}`);
    if (original.variants.length !== product.variants.length) errors.push(`Source variant count differs: ${product.slug}`);
    for (const variant of product.variants) {
      const item = original.variants.find(row => String(row.id) === variant.id);
      if (!item || variant.priceAmount !== item.price || variant.compareAtAmount !== (item.compare_at_price || null)
        || variant.sku !== (item.sku || null) || variant.publicAvailable !== (item.available ?? null)) errors.push(`Source variant differs: ${product.slug}/${variant.id}`);
    }
  }
  if (input.size !== catalog.products.length) errors.push('Source product count differs');
  for (const category of catalog.collections) {
    const sourceIds = [...new Set(source.memberships[category.sourceSlug] || [])].map(String);
    if (sourceIds.length !== category.productIds.length || sourceIds.some(id => !category.productIds.includes(id))) errors.push(`Source membership differs: ${category.slug}`);
  }
  return { errors, productsCompared: catalog.products.length, variantsCompared: catalog.products.reduce((sum, product) => sum + product.variants.length, 0),
    galleryRelationshipsCompared: catalog.products.reduce((sum, product) => sum + product.gallery.length, 0), collectionsCompared: catalog.collections.length };
}
module.exports = { verify };
