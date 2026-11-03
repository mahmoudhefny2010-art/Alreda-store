const { productCard, availability } = require('../../src/utils/productPreview');
const { getProductFromData } = require('../../src/services/product.service');
const { translate } = require('../../src/config/storefront-i18n');
const ejs = require('ejs');
const path = require('node:path');
const record = () => ({ id: 'a6c56b98-f00b-4b4b-8b03-3af6a37a9204', sourceId: 'stock-test', slug: 'stock-test', name: 'Stock test', titleEn: 'Stock test', titleAr: 'منتج تجريبي',
  stock_quantity: 0, isAvailable: false, collectionIds: [], options: [], gallery: [], variants: [{ id: 'one', title: 'Default Title', options: ['Default Title'], priceAmount: '100.00', inventoryQuantity: 0, publicAvailable: false }] });
it.each(['en', 'ar'])('shows a sold-out card and disables adding it in %s', async locale => {
  const product = productCard(record(), '', locale);
  expect(product.availability.label).toBe(translate(locale, 'outOfStock'));
  expect(product.purchaseEligible).toBe(false);
  const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/partials/product-card.ejs'), { product, t: key => translate(locale, key) });
  expect(html).toContain(translate(locale, 'outOfStock')); expect(html).toContain('disabled');
});
it('keeps unknown inventory distinct from zero and updates per-option stock labels', () => {
  const item = record(); item.stock_quantity = null; item.isAvailable = true; item.variants[0].inventoryQuantity = null; item.variants[0].publicAvailable = null;
  expect(productCard(item, '').outOfStock).toBe(false);
  expect(availability(item.variants).label).not.toBe('Out of stock');
  item.stock_quantity = 5; item.options = [{ name: 'Color', values: ['Black', 'Gold'] }];
  item.variants = [{ ...item.variants[0], options: ['Black'], inventoryQuantity: 0, publicAvailable: false }, { ...item.variants[0], id: 'two', options: ['Gold'], inventoryQuantity: 5, publicAvailable: true }];
  const data = { bySlug: new Map([[item.slug, item]]), byCategory: new Map(), categories: [], products: new Map(), catalog: { products: [item] } };
  const product = getProductFromData(data, item.slug).product;
  expect(product.variants[0].availabilityLabel).toBe('Out of stock');
  expect(product.variants[1].availabilityLabel).toBe('In stock');
  expect(productCard(item, '').preview.variants.map(variant => variant.outOfStock)).toEqual([true, false]);
});
