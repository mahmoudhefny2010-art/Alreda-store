const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { z } = require('zod');
const sanitizeHtml = require('sanitize-html');
const sanitizeDescription = require('../../src/utils/sanitizeProductDescription');
const { localizeCatalogText } = require('../../src/utils/localizeCatalogText');
const { productName } = require('../../src/config/storefront-i18n');
const dictionary = require('./manual-description-translations.json');
const { root, directory, writeJson } = require('./shared');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function translateDescription(html, locale) {
  return sanitizeDescription(sanitizeHtml(sanitizeDescription(html || ''), {
    allowedTags: ['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td'], allowedAttributes: {},
    textFilter(text) {
      const manual = Object.hasOwn(dictionary[locale], text) ? dictionary[locale][text] : undefined;
      return manual === undefined ? localizeCatalogText(text, locale) : escape(manual);
    },
  }));
}

function untranslatedArabicWords(html) {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/&(?:[a-z]+|#\d+);/gi, ' ');
  const technicalCodes = new Set(['ABS', 'IPX1', 'CE', 'SUS', 'LED', 'SK-14028', 'MJ1', 'KH300', 'OG1', 'K1', 'S2', 'S6', 'X']);
  return [...new Set(text.match(/[A-Za-z][A-Za-z0-9-]*/g) || [])].filter(word => !technicalCodes.has(word));
}

function buildTranslations(catalog) {
  const products = catalog.products.map(record => {
    let titleAr = localizeCatalogText(productName(record, 'ar'), 'ar');
    if (titleAr.length > 120 && /automatic-hand-dryer/.test(record.slug)) titleAr = 'مجفف أيدي أوتوماتيكي ديلايت بقدرة 2000 واط';
    if (/bathroom-grab-bar/.test(record.slug) && titleAr.length > 120) titleAr = `مقبض أمان للحمام من ديلايت ${record.slug.includes('25mm') ? '25' : '32'} مم`;
    const translated = { ...record, titleEn: productName(record, 'en'), titleAr,
      translationMethod: 'manual', manualSourceDescriptionsHash: record.manualSourceDescriptionsHash || fingerprint({ description: record.descriptionHtml || '', description_ar: record.descriptionArHtml || '' }),
      descriptionHtml: translateDescription(record.descriptionHtml, 'en'),
      descriptionArHtml: translateDescription(record.descriptionArHtml || record.descriptionHtml, 'ar') };
    z.object({ titleEn: z.string().min(1).max(120), titleAr: z.string().min(1).max(120),
      descriptionHtml: z.string().min(1).max(500000), descriptionArHtml: z.string().min(1).max(500000) }).parse(translated);
    if (/[\u0600-\u06ff]/u.test(sanitizeHtml(translated.descriptionHtml, { allowedTags: [], allowedAttributes: {} }))) throw new Error('MANUAL_ENGLISH_INCOMPLETE');
    if (untranslatedArabicWords(translated.descriptionArHtml).length) throw new Error('MANUAL_ARABIC_INCOMPLETE');
    return translated;
  });
  return { ...catalog, products };
}

async function applyTranslations(client, before, after) {
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('alreda-manual-translation', 0))::text`;
    const rows = await tx.products.findMany({ where: { source_id: { in: before.products.map(item => item.sourceId) } },
      select: { id: true, source_id: true, slug: true, name: true, name_ar: true, description: true, description_ar: true } });
    if (rows.length !== before.products.length) throw new Error('MANUAL_DATABASE_COVERAGE_CHANGED');
    const byId = new Map(rows.map(row => [row.source_id, row]));
    const updates = after.products.map((product, index) => {
      const original = before.products[index]; const row = byId.get(product.sourceId);
      if (!row || row.slug !== product.slug || original.sourceId !== product.sourceId) throw new Error('MANUAL_DATABASE_IDENTITY_MISMATCH');
      const data = { name: product.titleEn, name_ar: product.titleAr, description: product.descriptionHtml, description_ar: product.descriptionArHtml };
      for (const [field, old] of Object.entries({ name: original.titleEn || original.name, name_ar: original.titleAr || original.name,
        description: original.descriptionHtml || '', description_ar: original.descriptionArHtml || '' })) {
        if (row[field] && row[field] !== old && row[field] !== data[field]) throw new Error('MANUAL_DATABASE_EDIT_CONFLICT');
      }
      return { id: row.id, data, changed: Object.entries(data).some(([field, value]) => row[field] !== value) };
    });
    for (const update of updates.filter(item => item.changed)) await tx.products.update({ where: { id: update.id }, data: update.data });
    return { matched: rows.length, changed: updates.filter(item => item.changed).length };
  }, { isolationLevel: 'Serializable', timeout: 90000, maxWait: 15000 });
}

async function main(args = process.argv.slice(2)) {
  const execute = args.length === 1 && args[0] === '--execute';
  if (args.length && !execute) throw new Error('MANUAL_USE_EXECUTE_OR_NO_ARGUMENTS');
  const file = path.join(root, 'src/config/catalog.json');
  const text = await fs.readFile(file, 'utf8'); const before = JSON.parse(text); const after = buildTranslations(before);
  await writeJson(path.join(directory, 'manual-translation/translated-catalog.json'), after);
  let database = { executed: false };
  if (execute) {
    require('dotenv').config({ quiet: true });
    const { getPrismaClient, disconnectDatabase } = require('../../src/config/prisma');
    try {
      const client = getPrismaClient();
      await writeJson(path.join(directory, `manual-translation/database-before-${Date.now()}.json`), {
        products: await client.products.findMany({ select: { source_id: true, slug: true, name: true, name_ar: true, description: true, description_ar: true } }),
      });
      database = { executed: true, ...await applyTranslations(client, before, after) };
      const rows = await client.products.findMany({ where: { source_id: { in: after.products.map(item => item.sourceId) } },
        select: { source_id: true, name: true, name_ar: true, description: true, description_ar: true } });
      const saved = new Map(rows.map(row => [row.source_id, row]));
      if (after.products.some(item => { const row = saved.get(item.sourceId); return !row || row.name !== item.titleEn || row.name_ar !== item.titleAr
        || row.description !== item.descriptionHtml || row.description_ar !== item.descriptionArHtml; })) throw new Error('MANUAL_POSTCOMMIT_VERIFICATION_FAILED');
      if (await fs.readFile(file, 'utf8') !== text) throw new Error('MANUAL_SNAPSHOT_CONCURRENT_CHANGE');
      await fs.writeFile(path.join(directory, `manual-translation/catalog-before-${Date.now()}.json`), text);
      await writeJson(`${file}.tmp`, after); await fs.rename(`${file}.tmp`, file);
    } finally { await disconnectDatabase(); }
  }
  const report = { products: after.products.length, mode: execute ? 'execute' : 'plan', method: 'manually authored translations; no external translation provider',
    beforeHash: fingerprint(before), afterHash: fingerprint(after), database };
  await writeJson(path.join(root, 'docs/manual-translation-report.json'), report); console.info(JSON.stringify(report));
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ success: false,
  code: /^MANUAL_[A-Z_]+$/.test(error.message) ? error.message : 'MANUAL_TRANSLATION_FAILED' })); process.exitCode = 1; });
module.exports = { translateDescription, buildTranslations, applyTranslations, untranslatedArabicWords };
