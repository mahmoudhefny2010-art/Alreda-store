const { productCard } = require('../../src/utils/productPreview');
const ejs = require('ejs');
const path = require('node:path');
const { translate } = require('../../src/config/storefront-i18n');
const record = { sourceId: 'fixture', slug: 'test-item', titleEn: 'Test item', name: 'Test item',
  options: [{ name: 'Color', values: ['Black', 'Silver', 'Unmapped'] }, { name: 'Size', values: ['Small', 'Large'] }],
  gallery: [{ sourceId: 'one', src: '/one.jpg', cardSrc: '/one-card.webp' }, { sourceId: 'two', src: '/two.jpg' }],
  variants: [
    { id: '11', title: 'Black / Small', options: ['Black', 'Small'], imageId: 'two', priceAmount: '100.00', compareAtAmount: null, publicAvailable: true },
    { id: '12', title: 'Silver / Large', options: ['Silver', 'Large'], imageId: 'one', priceAmount: '120.00', compareAtAmount: '150.00', publicAvailable: false },
  ] };
describe('catalog card variant previews', () => {
  it('starts with the first gallery photo while preserving actual color image associations', () => {
    const card = productCard(record, 'sets');
    expect(card.image).toBe('/one-card.webp');
    expect(card.preview.variants[0].image).toBe('/two.jpg');
    expect(card.preview.variants[1]).toMatchObject({ image: '/one-card.webp', price: 'EGP 120.00', compare: 'EGP 150.00' });
    expect(card.preview.groups[0].values.map(option => option.value)).toEqual(['Black', 'Silver']);
    expect(card.purchaseEligible).toBe(false);
  });
  it('keeps source gallery order, uses the cover when no mapped image exists, and localizes labels', () => {
    const source = structuredClone(record); source.variants[0].imageId = null;
    const card = productCard(source, '', 'ar');
    expect(card.preview.gallery).toEqual(['/one-card.webp', '/two.jpg']);
    expect(card.preview.variants[0].image).toBe('/one-card.webp');
    expect(card.preview.groups[0].name).toBe('اللون');
    expect(card.preview.groups[0].values[0].label).toBe('أسود');
  });
  it('escapes variant data and renders keyboard accessible choices outside navigation links', async () => {
    const source = structuredClone(record); source.variants[0].title = '"><script>alert(1)</script>';
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/partials/product-card.ejs'), { product: productCard(source, ''), t: key => translate('en', key) });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('value="Small"');
    expect(html).not.toContain('data-card-option-select');
    expect(html).toContain('card-color-black');
    expect(html.indexOf('class="product-price"')).toBeLessThan(html.indexOf('class="card-options"'));
    expect(html.indexOf('</a>')).toBeLessThan(html.indexOf('class="card-options"'));
  });
  it('does not invent options for a single default variant or absent galleries', () => {
    const source = structuredClone(record); source.gallery = []; source.options = [{ name: 'Title', values: ['Default Title'] }]; source.variants = [{ ...source.variants[0], options: ['Default Title'] }];
    const card = productCard(source, ''); expect(card.preview.groups).toEqual([]); expect(card.image).toBeNull();
  });
  it('resolves images through variantIds when the direct image mapping is absent', () => {
    const source = structuredClone(record); source.variants[0].imageId = null; source.gallery[1].variantIds = ['11'];
    expect(productCard(source, '').preview.variants[0].image).toBe('/two.jpg');
  });
  it('shows saved catalog colors as swatches for new single-color products', async () => {
    const source = structuredClone(record);
    source.options = [{ name: 'Size', values: ['Small'] }];
    source.variants = [{ ...source.variants[0], options: ['Small'] }];
    source.catalogDetails = { color_en: 'Rose Gold, Antique' };
    const card = productCard(source, '');
    expect(card.preview.catalogColors).toEqual([
      { label: 'Rose Gold', hex: '#c89480' },
      { label: 'Antique', hex: '#80664c' },
    ]);
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/partials/product-card.ejs'), { product: card, t: key => translate('en', key) });
    expect(html).toContain('card-catalog-colors');
    expect(html).toContain('style="--swatch-color:#c89480"');
    expect(html).toContain('aria-label="Antique"');
  });
  it('keeps size-only products navigable without showing their option controls on cards', async () => {
    const source = structuredClone(record); source.options = [{ name: 'Size', values: ['Small', 'Large'] }];
    source.variants.forEach((variant, index) => { variant.options = [index ? 'Large' : 'Small']; });
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/partials/product-card.ejs'), { product: productCard(source, ''), t: key => translate('en', key) });
    expect(html).toContain('card-choose-options');
    expect(html).not.toContain('data-card-option-select');
    expect(html).not.toContain('class="card-options"');
    expect(html).not.toContain('class="card-option ');
  });
});
