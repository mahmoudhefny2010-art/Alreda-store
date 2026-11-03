const { productSchema } = require('../../src/validators/admin.validator');
const { productCard } = require('../../src/utils/productPreview');

const imageA = 'https://res.cloudinary.com/pjwlhib7/image/upload/store/a.jpg';
const imageB = 'https://res.cloudinary.com/pjwlhib7/image/upload/store/b.jpg';
const base = { name: 'Sample', nameAr: 'عينة', categoryId: '1ac93ec3-2e14-4a25-a187-cc67d68fa331', priceEgp: '500', stock: '4', available: 'on', images: `${imageA}\n${imageB}` };

describe('admin product color variants', () => {
  it('validates multiple unique colors and binds each to an uploaded Cloudinary image', () => {
    const result = productSchema.parse({ ...base, colorVariants: JSON.stringify([
      { color: 'Black', imageUrl: imageA, stock: 3 }, { color: 'Gold', imageUrl: imageB, stock: 1 },
    ]) });
    expect(result.colorVariants).toEqual([{ color: 'Black', imageUrl: imageA, stock: 3, priceEgp: null }, { color: 'Gold', imageUrl: imageB, stock: 1, priceEgp: null }]);
    expect(result.imageUrls).toEqual([imageA, imageB]);
  });
  it('accepts optional color overrides and rejects invalid prices', () => {
    for (const value of ['', null, undefined, 725, '725']) {
      const result = productSchema.parse({ ...base, colorVariants: JSON.stringify([{ color: 'Gold', imageUrl: imageA, priceEgp: value }]) });
      expect(result.colorVariants[0].priceEgp).toBe(value == null || value === '' ? null : 725);
    }
    for (const value of [0, -1, 1.5, 'not-a-price', 10000001]) expect(() => productSchema.parse({ ...base, colorVariants: JSON.stringify([{ color: 'Gold', imageUrl: imageA, priceEgp: value }]) })).toThrow();
  });

  it('rejects duplicates, unknown colors, and images outside the product gallery', () => {
    for (const variants of [
      [{ color: 'Black', imageUrl: imageA }, { color: 'Black', imageUrl: imageB }],
      [{ color: 'Purple', imageUrl: imageA }],
      [{ color: 'Gold', imageUrl: 'https://res.cloudinary.com/pjwlhib7/image/upload/store/other.jpg' }],
    ]) expect(() => productSchema.parse({ ...base, colorVariants: JSON.stringify(variants) })).toThrow();
  });

  it('renders selectable color swatches with their variant-specific images', () => {
    const product = productCard({
      id: 'product-id', slug: 'sample', titleEn: 'Sample', name: 'Sample',
      options: [{ name: 'Color', values: ['Black', 'Gold'] }],
      gallery: [{ sourceId: 'black-photo', src: imageA }, { sourceId: 'gold-photo', src: imageB }],
      variants: [
        { id: 'black', options: ['Black'], imageId: 'black-photo', priceAmount: '500.00', publicAvailable: true },
        { id: 'gold', options: ['Gold'], imageId: 'gold-photo', priceAmount: '500.00', publicAvailable: true },
      ],
    }, '');
    expect(product.preview.groups[0].values.map(value => value.value)).toEqual(['Black', 'Gold']);
    expect(product.preview.variants.map(value => value.image)).toEqual([imageA, imageB]);
  });
});
