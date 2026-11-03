const { variantEditorSchema } = require('../../src/validators/admin.validator');
const { buildVariantEditor } = require('../../src/services/variant-editor.service');
const { variantColor, variantPrice } = require('../../src/services/purchase-selection.service');

const image = `https://res.cloudinary.com/${require('../../src/config/cloudinary-media.json').cloudName}/image/upload/test/variant.jpg`;
const options = [{ name: 'Color', nameAr: 'اللون' }, { name: 'Type', nameAr: 'النوع' }, { name: 'Size', nameAr: 'المقاس' }];
const row = { id: '26be682a-af63-42d3-8903-b9f0db579cb2', values: ['Black', 'Double', '50 cm'], priceEgp: 1200, salePriceEgp: 1050, stock: 4, available: true, imageUrl: image, titleAr: 'أسود / مزدوج / ٥٠ سم' };

it('validates unique exact combinations and each row offer independently', () => {
  const parsed = variantEditorSchema.parse({ enabled: true, options, rows: [row] });
  expect(parsed.rows[0]).toMatchObject({ priceEgp: 1200, salePriceEgp: 1050, stock: 4 });
  expect(() => variantEditorSchema.parse({ enabled: true, options, rows: [row, row] })).toThrow();
  expect(() => variantEditorSchema.parse({ enabled: true, options, rows: [{ ...row, salePriceEgp: 1200 }] })).toThrow();
  expect(() => variantEditorSchema.parse({ enabled: true, options, rows: [{ ...row, values: ['Black', 'Double'] }] })).toThrow();
  const { productSchema } = require('../../src/validators/admin.validator');
  const productInput = { name: 'Matrix item', nameAr: 'منتج خيارات', categoryId: '1ac93ec3-2e14-4a25-a187-cc67d68fa331', priceEgp: '500', salePriceEgp: '450', stock: '0', images: image,
    variantEditor: JSON.stringify({ enabled: true, options, rows: [{ ...row, priceEgp: 1200, salePriceEgp: 900 }] }) };
  expect(productSchema.parse(productInput).variantEditor.rows[0].salePriceEgp).toBe(900);
});

it('loads saved combinations without changing their stock, image, price or offer', () => {
  const product = { id: 'product-id', catalog_details: { presentation: { variantEditor: { enabled: true, options, ids: [row.id] }, variantOffers: { [row.id]: 1050 } } },
    product_variants: [{ id: row.id, source_id: 'admin-matrix-row', options: JSON.stringify(row.values), price_egp: 1200, compare_at_egp: null,
      stock_quantity: 4, is_available: true, title: 'Black / Double / 50 cm', title_ar: row.titleAr, source_image_id: 'image-id' }],
    product_images: [{ source_id: 'image-id', secure_url: image }], image_url: image };
  expect(buildVariantEditor(product)).toMatchObject({ enabled: true, options, rows: [row] });
  const inherited = buildVariantEditor({ ...product, sale_price_egp: 1100,
    catalog_details: { presentation: { variantEditor: { enabled: true, options, ids: [row.id] }, colorOffers: { Black: 1000 } } } });
  expect(inherited.rows[0].salePriceEgp).toBe(1000);
});

it('uses the selected combination color and price in checkout calculations', () => {
  const product = {
    id: 'product-id', price_egp: 1400, sale_price_egp: null,
    catalog_details: { presentation: { variantEditor: { enabled: true, options }, variantOffers: { [row.id]: 1050 } } },
  };
  const variant = { id: row.id, options: JSON.stringify(row.values), price_egp: row.priceEgp };
  expect(variantColor(product, variant)).toBe('Black');
  expect(variantPrice(product, variant, [])).toBe(1050);
  expect(variantPrice(product, { ...variant, id: 'other', options: JSON.stringify(['Gold', 'Single', '40 cm']), price_egp: 900 }, [])).toBe(900);
});
