const { normalize } = require('../../scripts/catalog-import/normalize');
const { parseCsv, csvExport } = require('../../scripts/catalog-import/extract');
const { canonicalImage } = require('../../scripts/catalog-import/download-images');
const { validate } = require('../../scripts/catalog-import/validate');
const { summarize } = require('../../scripts/catalog-import/report');
const { activate } = require('../../scripts/catalog-import/import');
const { verify } = require('../../scripts/catalog-import/verify');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const image = 'https://cdn.shopify.com/s/files/1/0706/3692/9202/files/example.jpg?v=1';
const source = () => ({ capturedAt: '2026-11-01T00:00:00Z', source: 'test', currency: 'EGP', collections: [{ id: '100', handle: 'example', title: 'Example', products_count: 1 }],
  memberships: { example: ['10'] }, products: [{ id: '10', handle: 'actual-product', title: 'Actual product', body_html: '<p>Source details</p>',
    images: Array.from({ length: 12 }, (_, index) => ({ id: String(200 + index), src: image, position: index + 1 })),
    options: [{ name: 'Color', values: ['Black'] }], variants: [{ id: '20', title: 'Black', price: '450.00', compare_at_price: '550.00', available: true, option1: 'Black', featured_image: { id: '200', src: image } }] }] });
describe('catalog migration integrity', () => {
  it('preserves the entire ordered gallery, price, variant image and collection membership', () => {
    const catalog = normalize(source());
    expect(catalog.products[0].gallery).toHaveLength(12);
    expect(catalog.products[0].gallery.map(image => image.position)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(catalog.products[0].variants[0]).toMatchObject({ priceAmount: '450.00', compareAtAmount: '550.00', imageId: '200', inventoryQuantity: null });
    expect(catalog.products[0].collectionIds).toEqual(['100']);
    expect(catalog.products[0].variants[0].sku).toBeNull();
  });
  it('deduplicates by source ID and generates stable IDs on repeat normalization', () => {
    const raw = source(); raw.products.push(raw.products[0]);
    const first = normalize(raw); const second = normalize(raw);
    expect(first).toEqual(second);
    expect(first.products).toHaveLength(1);
    expect(first.duplicates).toEqual(['10']);
  });
  it('rejects malformed prices, untrusted origins and private image URLs', () => {
    const raw = source(); raw.products[0].variants[0].price = 'free';
    expect(() => normalize(raw)).toThrow();
    expect(() => canonicalImage('http://127.0.0.1/private')).toThrow();
    expect(() => canonicalImage('https://cdn.shopify.com/s/files/other/image.jpg')).toThrow();
  });
  it('canonicalizes CDN aliases without downloading transformed versions', () => {
    expect(canonicalImage('https://alredastore.com/cdn/shop/files/example.jpg?v=1&width=640&crop=center')).toBe(image);
  });
  it('reads quoted CSV newlines and preserves extra image rows without duplicating the product', () => {
    const csv = `Handle,Title,Body (HTML),Variant Price,Image Src,Image Position\r\nactual-product,Actual product,"<p>Line one\nLine ""two""</p>",450.00,${image},1\r\nactual-product,,,,${image.replace('example', 'second')},2`;
    expect(parseCsv(csv)[0]['Body (HTML)']).toContain('Line "two"');
    const first = csvExport(csv); const second = csvExport(csv);
    expect(first.products).toHaveLength(1);
    expect(first.products[0].images).toHaveLength(2);
    expect(first.products[0].id).toBe(second.products[0].id);
    expect(first.products[0].variants[0].available).toBeNull();
    expect(() => parseCsv('Handle,Title\nx,"broken')).toThrow();
  });
  it('blocks incomplete assets and dangling memberships before activation', () => {
    const catalog = normalize(source());
    catalog.collections[0].productIds.push('999');
    const errors = validate(catalog);
    expect(errors.some(error => error.includes('Missing downloaded gallery'))).toBe(true);
    expect(errors.some(error => error.includes('Unknown member'))).toBe(true);
    const result = summarize(catalog, { discoveredImages: 1, downloadedImages: 0, originalBytes: 0, failures: [{ url: image, reason: 'HTTP 404' }] }, errors);
    expect(result.databaseImported).toBe(false);
    expect(result.reconciledPublicSnapshot).toBe(false);
  });
  it('independently detects a changed price or a dropped source gallery image', () => {
    const raw = source(); const catalog = normalize(raw);
    expect(verify(catalog, raw).errors).toEqual([]);
    catalog.products[0].variants[0].priceAmount = '1.00';
    catalog.products[0].gallery.pop();
    const errors = verify(catalog, raw).errors;
    expect(errors.some(error => error.includes('Source variant differs'))).toBe(true);
    expect(errors.some(error => error.includes('Source gallery differs'))).toBe(true);
  });
  it('activates idempotently and refuses to overwrite later edits', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alreda-import-test-'));
    const target = path.join(directory, 'catalog.json'); const statePath = path.join(directory, 'state.json');
    try {
      const catalog = normalize(source());
      for (const image of catalog.products[0].gallery) image.src = '/assets/images/products/' + 'a'.repeat(64) + '.jpg';
      expect(await activate(catalog, { target, statePath })).toBe(1);
      const first = await fs.readFile(target, 'utf8');
      expect(await activate(catalog, { target, statePath })).toBe(1);
      expect(await fs.readFile(target, 'utf8')).toBe(first);
      await fs.writeFile(target, first + ' ');
      await expect(activate(catalog, { target, statePath })).rejects.toThrow('edited since import');
      await fs.unlink(target); await fs.unlink(statePath);
    } finally { await fs.rmdir(directory); }
  });
  it('does not publish private/unknown-status export records during activation', async () => {
    const catalog = normalize({ ...source(), source: 'authorized-json-export' });
    await expect(activate(catalog)).rejects.toThrow('verify publication status');
  });
});
