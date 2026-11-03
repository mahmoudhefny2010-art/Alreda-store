const { productCard } = require('../../src/utils/productPreview');
const { translate } = require('../../src/config/storefront-i18n');
const ejs = require('ejs');
const path = require('node:path');

describe('stock-backed catalog purchase controls', () => {
  const base = { id: 'a00ab79d-0887-4e1b-a5aa-6b4545a5acbe', sourceId: 'source-1', slug: 'single-item', name: 'Single item', stock_quantity: 3,
    options: [{ name: 'Title', values: ['Default Title'] }], variants: [{ priceAmount: '100.00', compareAtAmount: null }], gallery: [] };
  it('enables a database-backed simple product only with positive configured inventory', () => {
    expect(productCard(base, '', 'en')).toMatchObject({ id: base.id, stock_quantity: 3, purchaseEligible: true });
    expect(productCard({ ...base, stock_quantity: null }, '', 'en').purchaseEligible).toBe(false);
    expect(productCard({ ...base, id: undefined, stock_quantity: 3 }, '', 'en').purchaseEligible).toBe(false);
  });
  it('keeps selectable variants and their card controls disabled until variant-aware persistence exists', async () => {
    const product = { ...base, variants: [...base.variants, { ...base.variants[0] }], options: [{ name: 'Color', values: ['Black', 'Silver'] }] };
    const card = productCard(product, '', 'en');
    expect(card.purchaseEligible).toBe(false);
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/partials/product-card.ejs'), { product: card, t: key => translate('en', key), formatPrice: value => value });
    expect(html).toContain('disabled');
  });
});
