require('dotenv').config({ quiet: true });
const { fs, path, directory, writeJson } = require('./shared');
const { discover } = require('./discover');
const { normalize } = require('./normalize');
const { downloadImages } = require('./download-images');
const { validate } = require('./validate');
const { activate } = require('./import');
const { summarize, report } = require('./report');
const { verify } = require('./verify');
async function run() {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source');
  const raw = sourceIndex >= 0 ? await require('./extract').readExport(args[sourceIndex + 1])
    : args.includes('--cached') ? JSON.parse(await fs.readFile(path.join(directory, 'discovered.json'), 'utf8'))
      : await discover({ refresh: args.includes('--refresh') });
  const catalog = normalize(raw);
  await writeJson(path.join(directory, 'normalized.json'), catalog);
  const downloads = await downloadImages(catalog);
  await writeJson(path.join(directory, 'normalized.json'), catalog);
  const errors = validate(catalog);
  const reconciliation = verify(catalog, raw);
  errors.push(...reconciliation.errors);
  let cloudinaryMedia;
  if (args.includes('--cloudinary') && !errors.length && !downloads.failures.length) {
    cloudinaryMedia = await require('./cloudinary').migrateCatalogMedia(catalog, { execute: true });
    if (cloudinaryMedia.failures.length) errors.push('Cloudinary image import incomplete; see data/media/cloudinary-import.json');
  }
  let activated = 0;
  if (args.includes('--activate') && !errors.length && !downloads.failures.length) {
    try { activated = await activate(catalog); } catch (error) { errors.push(error.message); }
  }
  const summary = summarize(catalog, downloads, errors, activated);
  summary.sourceVerification = reconciliation;
  if (cloudinaryMedia) summary.cloudinaryMedia = cloudinaryMedia;
  await report(summary);
  console.info(JSON.stringify({ collections: summary.collectionsDiscovered, products: summary.uniqueProductsDiscovered, variants: summary.variantsDiscovered,
    images: summary.imagesDownloaded, activated, errors: errors.length, failedDownloads: downloads.failures.length, reconciled: summary.reconciledPublicSnapshot }));
  if (errors.length || downloads.failures.length) process.exitCode = 1;
}
run().catch(error => { console.error('Catalog migration stopped:', error.name, error.message); process.exitCode = 1; });
