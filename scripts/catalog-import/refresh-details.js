const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { z } = require('zod');
const { product: sourceProduct, fetchPublic, root, directory, writeJson } = require('./shared');
const { productDescription } = require('../../src/utils/productDescription');
const feed = z.object({ products: z.array(sourceProduct).max(250) });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function fetchProducts(prefix) {
  const result = [];
  const seen = new Set();
  for (let page = 1; page <= 100; page++) {
    const rows = feed.parse(JSON.parse(await fetchPublic(`${prefix}products.json?limit=250&page=${page}`, { refresh: true }))).products;
    if (!rows.length) return result;
    for (const row of rows) {
      if (seen.has(row.id)) throw new Error('DETAIL_SOURCE_DUPLICATE');
      seen.add(row.id); result.push(row);
    }
  }
  throw new Error('DETAIL_SOURCE_PAGINATION_LIMIT');
}

function buildDetailPlan(catalog, source, arabic) {
  source = z.array(sourceProduct).parse(source);
  arabic = z.array(sourceProduct).parse(arabic);
  const originals = new Map(source.map(item => [item.id, item]));
  const translations = new Map(arabic.map(item => [item.id, item]));
  if (originals.size !== source.length || translations.size !== arabic.length) throw new Error('DETAIL_SOURCE_DUPLICATE');
  if (new Set(catalog.products.map(item => item.sourceId)).size !== catalog.products.length
    || originals.size !== catalog.products.length || translations.size !== originals.size) throw new Error('DETAIL_SOURCE_COVERAGE_CHANGED');
  const changes = catalog.products.map(item => {
    const primary = originals.get(item.sourceId); const localized = translations.get(item.sourceId);
    if (!primary || !localized || primary.handle !== item.slug || localized.handle !== item.slug) throw new Error('DETAIL_PRODUCT_IDENTITY_MISMATCH');
    const sourceDescriptions = { description: primary.body_html || '', description_ar: localized.body_html || '' };
    if (item.translationMethod === 'manual' && item.manualSourceDescriptionsHash !== digest(sourceDescriptions)) throw new Error('DETAIL_MANUAL_SOURCE_CHANGED_REVIEW_REQUIRED');
    const candidate = item.translationMethod === 'manual'
      ? { descriptionHtml: item.descriptionHtml, descriptionArHtml: item.descriptionArHtml }
      : { descriptionHtml: sourceDescriptions.description, descriptionArHtml: sourceDescriptions.description_ar };
    if (!productDescription(candidate, 'en').html) throw new Error('DETAIL_SOURCE_EMPTY');
    // Import descriptions only. Changed prices, stock, galleries and options need
    // their existing dedicated workflows, never an implicit destructive resync.
    return { sourceId: item.sourceId, slug: item.slug, before: {
      description: item.descriptionHtml || '', description_ar: item.descriptionArHtml || '',
    }, after: { description: candidate.descriptionHtml, description_ar: candidate.descriptionArHtml } };
  });
  return { changes, sourceHash: digest({ source, arabic }), sourceProducts: source.length,
    sourceVariants: source.reduce((sum, row) => sum + row.variants.length, 0),
    sourceImages: source.reduce((sum, row) => sum + row.images.length, 0),
    changedSnapshotDescriptions: changes.filter(row => digest(row.before) !== digest(row.after)).length };
}

async function applyDetailPlan(client, plan, { execute = false } = {}) {
  return client.$transaction(async tx => {
    if (!execute) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    else await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('alreda-product-details', 0))::text`;
    const rows = await tx.products.findMany({ where: { source_id: { in: plan.changes.map(item => item.sourceId) } },
      select: { id: true, source_id: true, slug: true, description: true, description_ar: true } });
    if (rows.length !== plan.changes.length) throw new Error('DETAIL_DATABASE_COVERAGE_CHANGED');
    let changed = 0;
    const databaseRows = new Map(rows.map(row => [row.source_id, row]));
    // Validate the entire plan before changing the first row.
    for (const change of plan.changes) {
      const row = databaseRows.get(change.sourceId);
      if (!row || row.slug !== change.slug) throw new Error('DETAIL_DATABASE_IDENTITY_MISMATCH');
      for (const field of ['description', 'description_ar']) {
        if (row[field] && row[field] !== change.before[field] && row[field] !== change.after[field]) throw new Error('DETAIL_DATABASE_CONTENT_CONFLICT');
      }
    }
    for (const change of plan.changes) {
      const row = databaseRows.get(change.sourceId);
      if (row.description === change.after.description && row.description_ar === change.after.description_ar) continue;
      changed++;
      if (execute) await tx.products.update({ where: { id: row.id }, data: change.after });
    }
    return { matchedDatabaseProducts: rows.length, changedDatabaseDescriptions: changed, executed: execute };
  }, { isolationLevel: 'Serializable', timeout: 90000, maxWait: 15000 });
}

async function main(args = process.argv.slice(2)) {
  require('dotenv').config({ quiet: true });
  const execute = args.length === 1 && args[0] === '--execute';
  if (args.length && !execute) throw new Error('DETAIL_USE_EXECUTE_OR_NO_ARGUMENTS');
  const snapshotPath = path.join(root, 'src/config/catalog.json');
  const snapshotText = await fs.readFile(snapshotPath, 'utf8');
  const catalog = JSON.parse(snapshotText);
  const source = await fetchProducts('/');
  const arabic = await fetchProducts('/ar/');
  const plan = buildDetailPlan(catalog, source, arabic);
  const capturedAt = new Date().toISOString();
  await writeJson(path.join(directory, 'details-refresh/source.json'), { capturedAt, source, arabic });
  const { getPrismaClient, disconnectDatabase } = require('../../src/config/prisma');
  let database;
  try {
    const client = getPrismaClient();
    if (execute) {
      // Backup contains product descriptions only, never customer records/secrets.
      const previous = await client.products.findMany({ select: { source_id: true, slug: true, description: true, description_ar: true } });
      await writeJson(path.join(directory, `details-refresh/backup-${Date.now()}.json`), { capturedAt, previous });
    }
    database = await applyDetailPlan(client, plan, { execute });
    // Verify through the same database-backed repository the product pages use.
    const repository = require('../../src/services/catalog.repository');
    repository.invalidateDatabaseCatalog();
    const saved = await repository.getDatabaseCatalog();
    if (!saved.persistent) throw new Error('DETAIL_PERSISTENT_VERIFICATION_REQUIRED');
    const mismatches = plan.changes.filter(change => {
      const product = saved.products.get(change.sourceId);
      return !product || product.slug !== change.slug || (execute && (
        product.descriptionHtml !== change.after.description || product.descriptionArHtml !== change.after.description_ar));
    });
    if (mismatches.length) throw new Error('DETAIL_POSTCOMMIT_VERIFICATION_FAILED');
    if (execute && plan.changedSnapshotDescriptions) {
      if (await fs.readFile(snapshotPath, 'utf8') !== snapshotText) throw new Error('DETAIL_SNAPSHOT_CONCURRENT_CHANGE');
      await fs.writeFile(path.join(directory, `details-refresh/catalog-before-${Date.now()}.json`), snapshotText);
      const updated = { ...catalog, products: catalog.products.map((item, index) => ({ ...item,
        descriptionHtml: plan.changes[index].after.description, descriptionArHtml: plan.changes[index].after.description_ar })) };
      await writeJson(`${snapshotPath}.tmp`, updated); await fs.rename(`${snapshotPath}.tmp`, snapshotPath);
    }
    const products = plan.changes.map(item => ({ descriptionHtml: item.after.description, descriptionArHtml: item.after.description_ar }));
    const originalFallbacks = locale => products.filter(item => productDescription(item, locale).originalLanguage).length;
    const report = { capturedAt, source: 'https://alredastore.com/', mode: execute ? 'execute' : 'plan', sourceHash: plan.sourceHash,
      sourceProducts: plan.sourceProducts, sourceVariants: plan.sourceVariants, sourceImages: plan.sourceImages,
      changedSnapshotDescriptions: plan.changedSnapshotDescriptions, ...database,
      verifiedDatabaseRetrieval: true, readableDescriptions: products.filter(item => productDescription(item).html).length,
      originalFallbacksEnglish: originalFallbacks('en'), originalFallbacksArabic: originalFallbacks('ar'),
      preserves: ['stock', 'prices', 'orders', 'customer data', 'categories', 'Cloudinary image URLs', 'variants'] };
    await writeJson(path.join(root, 'docs/product-details-source-report.json'), report);
    console.info(JSON.stringify(report));
  } finally { await disconnectDatabase(); }
}
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ success: false, code: /^DETAIL_[A-Z_]+$/.test(error.message) ? error.message : 'DETAIL_REFRESH_FAILED' }));
  process.exitCode = 1;
});
module.exports = { buildDetailPlan, applyDetailPlan, fetchProducts };
