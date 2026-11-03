const { productSchema } = require('../../src/validators/admin.validator');
const { effectivePrice } = require('../../src/services/discount.service');

const input = { name: 'Sample', nameAr: 'منتج', categoryId: '1ac93ec3-2e14-4a25-a187-cc67d68fa331', priceEgp: '500', stock: '8', images: 'https://res.cloudinary.com/pjwlhib7/image/upload/store/sample.jpg' };

describe('product offer price', () => {
  it('accepts an optional blank offer and a valid lower offer price', () => {
    expect(productSchema.parse(input).salePriceEgp).toBe(null);
    expect(productSchema.parse({ ...input, salePriceEgp: '350' }).salePriceEgp).toBe(350);
  });

  it('rejects an offer equal to or above the regular price', () => {
    expect(() => productSchema.parse({ ...input, salePriceEgp: '500' })).toThrow();
    expect(() => productSchema.parse({ ...input, salePriceEgp: '501' })).toThrow();
  });

  it('uses the saved offer price for storefront and checkout pricing', () => {
    expect(effectivePrice({ price_egp: 500, sale_price_egp: 350 })).toBe(350);
    expect(effectivePrice({ price_egp: 500, sale_price_egp: 350 }, [], new Date(), 600)).toBe(350);
  });
});
