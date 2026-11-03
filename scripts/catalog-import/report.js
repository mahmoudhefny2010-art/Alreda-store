const { fs, path, root, directory, writeJson } = require('./shared');
function summarize(catalog, downloads, errors, importedProducts = 0) {
  const decodeHandle = value => decodeURIComponent(new URL(value).pathname.split('/').pop());
  const sourceProducts = new Set((catalog.sitemap?.products || []).map(decodeHandle));
  const sourceCollections = new Set((catalog.sitemap?.collections || []).map(decodeHandle));
  const missingSitemapProducts = [...sourceProducts].filter(slug => !catalog.products.some(product => product.slug === slug));
  const missingSitemapCollections = [...sourceCollections].filter(slug => !catalog.collections.some(category => category.sourceSlug === slug));
  const missingArabicProducts = (catalog.sitemap?.arabicProducts || []).map(decodeHandle).filter(slug => !catalog.products.some(product => product.slug === slug && product.titleAr));
  const missingArabicCollections = (catalog.sitemap?.arabicCollections || []).map(decodeHandle).filter(slug => !catalog.collections.some(category => category.sourceSlug === slug && category.titleAr));
  const reviews = catalog.products.map(product => ({ slug: product.slug, missing: [
    !product.descriptionHtml && 'description', !product.vendor && 'brand', !product.productType && 'product type',
    !product.gallery.length && 'images', !product.collectionIds.length && 'collection membership',
    product.variants.some(variant => !variant.sku) && 'one or more SKUs', !product.titleAr && 'Arabic title',
    product.variants.some(variant => variant.publicAvailable === null) && 'public availability',
  ].filter(Boolean) })).filter(product => product.missing.length);
  return { capturedAt: catalog.capturedAt, source: catalog.source, databaseImported: false, databaseStatus: 'PostgreSQL/Prisma Phase 2 not implemented',
    collectionsDiscovered: catalog.collections.length, uniqueProductsDiscovered: catalog.products.length,
    inventoryFile: 'src/config/catalog.json',
    collectionInventory: catalog.collections.map(category => ({ sourceId: category.sourceId, slug: category.slug, title: category.name,
      sourceUrl: category.sourceUrl, publishedProducts: category.productIds.length, hasSourceImage: Boolean(category.sourceImage) })),
    variantsDiscovered: catalog.products.reduce((sum, product) => sum + product.variants.length, 0),
    productImageRelationships: catalog.products.reduce((sum, product) => sum + product.gallery.length, 0),
    uniqueImagesDiscovered: downloads.discoveredImages, imagesDownloaded: downloads.downloadedImages, originalBytes: downloads.originalBytes,
    uniqueStoredOriginalFiles: downloads.uniqueStoredOriginalFiles ?? null,
    productsActivatedInLocalStorefront: importedProducts, productsWithMissingInformation: reviews.length,
    failedDownloads: downloads.failures, importErrors: errors, duplicateSourceRecords: catalog.duplicates,
    productsRequiringManualReview: reviews, missingSitemapProducts, missingSitemapCollections, missingArabicProducts, missingArabicCollections,
    missingFieldCounts: Object.fromEntries([...new Set(reviews.flatMap(product => product.missing))].map(field => [field, reviews.filter(product => product.missing.includes(field)).length])),
    collectionsWithoutSourceImages: catalog.collections.filter(category => !category.sourceImage).map(category => category.slug),
    collectionCountDiscrepancies: catalog.collections.filter(category => category.sourceCount !== null && category.sourceCount !== category.productIds.length)
      .map(category => ({ slug: category.slug, metadataCount: category.sourceCount, publicProducts: category.productIds.length, publicHtmlCount: category.publicHtmlCount,
        resolvedAgainstPublicHtml: category.publicHtmlCount === category.productIds.length })),
    sitemapProducts: sourceProducts.size, sitemapCollections: sourceCollections.size,
    reconciledPublicSnapshot: Boolean(catalog.sitemap) && !errors.length && !downloads.failures.length && !missingSitemapProducts.length && !missingSitemapCollections.length && !missingArabicProducts.length && !missingArabicCollections.length,
    limitations: ['Public snapshot only; unpublished/admin-only products cannot be inventoried.', 'Public availability is not warehouse stock quantity.',
      'No verified parent-category hierarchy; parentId remains null.', 'No authorized Admin export/API credentials were supplied; public English/Arabic feeds were used.',
      'Specifications retained from source rich descriptions; missing fields are not invented.'] };
}
async function report(result) {
  await writeJson(path.join(directory, 'report.json'), result);
  await writeJson(path.join(root, 'docs/catalog-migration-report.json'), result);
  const markdown = `# Alreda catalog migration report\n\nSnapshot: ${result.capturedAt}\n\n| Measure | Count |\n| --- | ---: |\n${[
    ['Collections', result.collectionsDiscovered], ['Unique products', result.uniqueProductsDiscovered], ['Variants', result.variantsDiscovered],
    ['Product/image relationships', result.productImageRelationships], ['Unique images discovered', result.uniqueImagesDiscovered], ['Images downloaded and validated', result.imagesDownloaded],
    ['Unique stored original image files (content deduplicated)', result.uniqueStoredOriginalFiles],
    ['Products activated in local storefront', result.productsActivatedInLocalStorefront], ['Products imported into PostgreSQL', 0],
    ['Products with missing source fields', result.productsWithMissingInformation], ['Download failures', result.failedDownloads.length],
    ['Validation/import errors', result.importErrors.length], ['Duplicate source records', result.duplicateSourceRecords.length],
    ['Missing sitemap products', result.missingSitemapProducts.length], ['Missing sitemap collections', result.missingSitemapCollections.length],
  ].map(([label, count]) => `| ${label} | ${count} |`).join('\n')}\n\nPublic snapshot reconciled: **${result.reconciledPublicSnapshot ? 'yes' : 'no'}**. This does not claim coverage of unpublished/admin-only inventory.\n\n${result.limitations.map(value => '- ' + value).join('\n')}\n\nDetailed failures, missing-field reviews and source reconciliation: [catalog-migration-report.json](catalog-migration-report.json). Database status: ${result.databaseStatus}.\n`;
  const issues = `\n## Source fields requiring review\n\n${Object.entries(result.missingFieldCounts).map(([field, count]) => `- ${count} products: missing ${field}.`).join('\n')}\n\nCollections without a source image (${result.collectionsWithoutSourceImages.length}): ${result.collectionsWithoutSourceImages.join(', ')}. No replacement imagery was invented.\n\nProducts without source collection membership: ${result.productsRequiringManualReview.filter(product => product.missing.includes('collection membership')).map(product => product.slug).join(', ') || 'none'}. They remain visible in All products.\n\nCollection counter discrepancies: ${result.collectionCountDiscrepancies.map(category => `${category.slug}: metadata ${category.metadataCount}, published feed ${category.publicProducts}, public HTML ${category.publicHtmlCount} (${category.resolvedAgainstPublicHtml ? 'public listing reconciled' : 'requires review'})`).join('; ') || 'none'}.\n`;
  const inventory = `\n## Collection inventory\n\n| Source collection | Public products | Source image |\n| --- | ---: | --- |\n${result.collectionInventory.map(category => `| ${category.title.replaceAll('|', '\\|')} | ${category.publishedProducts} | ${category.hasSourceImage ? 'yes' : 'not supplied'} |`).join('\n')}\n\nComplete product/variant/gallery inventory: [catalog.json](../src/config/catalog.json). Captured source inventory is retained locally in data/imports/alreda/discovered.json.\n`;
  await fs.writeFile(path.join(root, 'docs/catalog-migration-report.md'), markdown + issues + inventory);
}
module.exports = { summarize, report };
