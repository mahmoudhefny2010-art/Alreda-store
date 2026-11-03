const { createAdminManagementRepository } = require('../../src/repositories/admin-management.repository');

const campaignOnlyProduct = {
  id: '26be682a-af63-42d3-8903-b9f0db579cb2', name: 'Campaign item', name_ar: '\u0645\u0646\u062a\u062c',
  source_id: 'campaign-item', price_egp: 500, sale_price_egp: null, category_id: null,
  catalog_details: { type_en: '', color_en: '' }, product_categories: [], product_images: [],
};

it('includes products whose active product campaign reduces their effective price', async () => {
  const prisma = {
    products: { findMany: async () => [campaignOnlyProduct] },
    discount_rules: { findMany: async () => [{
      id: '1ac93ec3-2e14-4a25-a187-cc67d68fa331', is_active: true, starts_at: new Date(Date.now() - 60_000), ends_at: new Date(Date.now() + 60_000),
      scope: 'PRODUCT', target: campaignOnlyProduct.id, mode: 'PERCENT', amount: 20,
    }] },
  };

  const offers = await createAdminManagementRepository(() => prisma).productOffers();

  expect(offers).toHaveLength(1);
  expect(offers[0]).toMatchObject({ id: campaignOnlyProduct.id, sale_price_egp: 400, offer_source: 'campaign' });
});

it('includes products whose variant sale price is below its saved compare-at price', async () => {
  const product = { ...campaignOnlyProduct, price_egp: 2250, product_variants: [{
    title: 'Black', title_ar: '\u0623\u0633\u0648\u062f', options: '["Black"]', price_egp: 1250, compare_at_egp: 2250,
  }] };
  const prisma = { products: { findMany: async () => [product] }, discount_rules: { findMany: async () => [] } };

  const offers = await createAdminManagementRepository(() => prisma).productOffers();

  expect(offers).toHaveLength(1);
  expect(offers[0]).toMatchObject({ offer_source: 'variant', sale_price_egp: 1250, offer_regular_price_egp: 2250,
    offer_variants: [{ title: 'Black', sale_price_egp: 1250, regular_price_egp: 2250 }] });
});
