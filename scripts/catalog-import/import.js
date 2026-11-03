const { fs, path, root, directory, hash, writeJson } = require('./shared');
const { validate } = require('./validate');
async function activate(catalog, { target = path.join(root, 'src/config/catalog.json'), statePath = path.join(directory, 'activation.json') } = {}) {
  if (catalog.source.startsWith('authorized-') && catalog.products.some(product => product.publicationStatus !== 'published')) throw new Error('Export staged only: verify publication status before activating private/export records.');
  const errors = validate(catalog);
  if (errors.length) throw new Error('Activation blocked by catalog validation; see report.');
  let previous;
  try { previous = await fs.readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    let state;
    try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch { throw new Error('Existing catalog has no import ownership record; refusing to overwrite.'); }
    if (hash(previous) !== state.sha256) throw new Error('Catalog was edited since import; refusing to overwrite admin/local changes.');
  }
  const text = JSON.stringify(catalog, null, 2) + '\n';
  const temporary = target + '.pending';
  await fs.writeFile(temporary, text);
  await fs.rename(temporary, target);
  await writeJson(statePath, { sha256: hash(text), capturedAt: catalog.capturedAt });
  return catalog.products.length;
}
module.exports = { activate };
