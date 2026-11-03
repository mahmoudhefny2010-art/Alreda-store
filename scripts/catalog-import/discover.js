const { z } = require('zod');
const { directory, path, origin, product, collection, writeJson, fetchPublic } = require('./shared');
const decode = text => text.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
function locations(xml) { return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => decode(match[1])); }
async function discover({ refresh = false } = {}) {
  const get = url => fetchPublic(url, { refresh });
  const robots = await get('/robots.txt');
  // Never crawl private/transactional surfaces or attempt rate-limit bypasses.
  if (/Disallow:\s*\/\s*$/m.test(robots)) throw new Error('Public crawl disallowed');
  const index = await get('/sitemap.xml');
  const sitemap = { products: [], collections: [], arabicProducts: [], arabicCollections: [] };
  for (const url of locations(index).filter(url => /sitemap_(products|collections)_/.test(url))) {
    const entries = locations(await get(url));
    const key = url.includes('/ar/') ? url.includes('products_') ? 'arabicProducts' : 'arabicCollections' : url.includes('products_') ? 'products' : 'collections';
    sitemap[key].push(...entries.filter(entry => /\/(products|collections)\/[^/]+$/.test(new URL(entry).pathname)));
  }
  async function paginated(prefix, kind, schema) {
    const records = new Map();
    for (let page = 1; page <= 1000; page++) {
      const result = z.object({ [kind]: z.array(schema) }).parse(JSON.parse(await get(`${prefix}${kind}.json?limit=250&page=${page}`)));
      if (!result[kind].length) return [...records.values()];
      let added = 0;
      for (const item of result[kind]) { if (!records.has(item.id)) added++; records.set(item.id, item); }
      if (!added) throw new Error('Source pagination repeated a page');
    }
    throw new Error('Source pagination limit exceeded');
  }
  const products = await paginated('/', 'products', product);
  const collections = await paginated('/', 'collections', collection);
  const arabicProducts = await paginated('/ar/', 'products', product);
  const arabicCollections = await paginated('/ar/', 'collections', collection);
  const known = new Set(products.map(item => item.handle));
  for (const url of sitemap.products) {
    const slug = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (!known.has(slug)) {
      const result = z.object({ product }).parse(JSON.parse(await get(`/products/${encodeURIComponent(slug)}.json`)));
      products.push(result.product); known.add(slug);
    }
  }
  const knownCollections = new Set(collections.map(item => item.handle));
  for (const url of sitemap.collections) {
    const slug = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (!knownCollections.has(slug)) {
      const result = z.object({ collection }).parse(JSON.parse(await get(`/collections/${encodeURIComponent(slug)}.json`)));
      collections.push(result.collection); knownCollections.add(slug);
    }
  }
  const memberships = {};
  const publicCollectionCounts = {};
  for (const category of collections) {
    const rows = await paginated(`/collections/${encodeURIComponent(category.handle)}/`, 'products', product);
    memberships[category.handle] = rows.map(item => item.id);
    if (category.products_count !== rows.length) {
      const html = await get(`/collections/${encodeURIComponent(category.handle)}`);
      const count = html.match(/\b(\d+) products\b/);
      publicCollectionCounts[category.handle] = count ? Number(count[1]) : null;
    }
    for (const item of rows) if (!known.has(item.handle)) { products.push(item); known.add(item.handle); }
    console.info(`Discovered collection ${Object.keys(memberships).length}/${collections.length}: ${rows.length} products`);
  }
  const home = await get('/');
  const navigationLinks = [...new Set([...home.matchAll(/href=["']([^"']*\/collections\/[^"'#?]+)["']/g)].map(match => decode(match[1])))];
  const result = { schemaVersion: 1, source: 'public-storefront', origin, capturedAt: new Date().toISOString(), currency: 'EGP',
    products, collections, arabicProducts, arabicCollections, memberships, publicCollectionCounts, sitemap, navigationLinks,
    hierarchy: null, hierarchyNote: 'Public collections expose no verified parent IDs. No hierarchy has been inferred.' };
  await writeJson(path.join(directory, 'discovered.json'), result);
  return result;
}
module.exports = { discover, locations };
