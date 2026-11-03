const { z } = require('zod');
const { fs, path, hash, product, collection } = require('./shared');
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  row.push(field); if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw new Error('Empty CSV');
  const headers = rows.shift();
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV headers');
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}
function csvExport(text) {
  const products = new Map();
  const ids = value => BigInt('0x' + hash(value).slice(0, 12)).toString();
  const decimal = value => {
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid CSV money');
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  };
  for (const row of parseCsv(text)) {
    const slug = row.Handle;
    if (!slug) throw new Error('CSV Handle required on each row');
    let item = products.get(slug);
    if (!item) {
      if (!row.Title) throw new Error('First CSV product row requires Title');
      item = { id: ids('product:' + slug), handle: slug, title: row.Title, body_html: row['Body (HTML)'] || '',
        vendor: row.Vendor || '', product_type: row.Type || '', tags: (row.Tags || '').split(',').map(value => value.trim()).filter(Boolean), images: [], variants: [], options: [] };
      products.set(slug, item);
    }
    if (row['Variant Price']) {
      const variant = { id: ids(`variant:${slug}:${[row['Option1 Value'], row['Option2 Value'], row['Option3 Value']].join('|')}`), title: '', price: decimal(row['Variant Price']),
        compare_at_price: row['Variant Compare At Price'] ? decimal(row['Variant Compare At Price']) : null, sku: row['Variant SKU'] || null, available: null };
      for (let index = 1; index <= 3; index++) {
        const name = row[`Option${index} Name`] || item.options[index - 1]?.name;
        const value = row[`Option${index} Value`];
        variant[`option${index}`] = value || null;
        if (name && value) {
          if (!item.options[index - 1]) item.options[index - 1] = { name, values: [] };
          if (!item.options[index - 1].values.includes(value)) item.options[index - 1].values.push(value);
        }
      }
      variant.title = [variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ') || 'Default Title';
      item.variants.push(variant);
    }
    if (row['Image Src'] && !item.images.some(image => image.src === row['Image Src'])) item.images.push({ id: ids('image:' + row['Image Src']),
      src: row['Image Src'], alt: row['Image Alt Text'] || '', position: Number(row['Image Position']) || item.images.length + 1 });
    if (row['Variant Image'] && item.variants.length) {
      let image = item.images.find(image => image.src === row['Variant Image']);
      if (!image) { image = { id: ids('image:' + row['Variant Image']), src: row['Variant Image'], position: item.images.length + 1 }; item.images.push(image); }
      item.variants.at(-1).featured_image = image;
    }
  }
  return { schemaVersion: 1, source: 'authorized-csv-export-derived-keys', capturedAt: new Date().toISOString(), currency: 'EGP',
    products: [...products.values()], collections: [], arabicProducts: [], arabicCollections: [], memberships: {} };
}
async function readExport(filename) {
  if (!filename) throw new Error('--source requires a local JSON or CSV export');
  const text = await fs.readFile(path.resolve(filename), 'utf8');
  const raw = filename.toLowerCase().endsWith('.csv') ? csvExport(text) : JSON.parse(text);
  return z.object({ products: z.array(product), collections: z.array(collection).default([]),
    memberships: z.record(z.string(), z.array(z.string())).default({}), currency: z.literal('EGP').default('EGP'),
    capturedAt: z.string().default(new Date().toISOString()), source: z.string().default('authorized-json-export'),
  }).passthrough().parse(raw);
}
module.exports = { parseCsv, csvExport, readExport };
