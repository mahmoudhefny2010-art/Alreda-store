const { translateCatalogText } = require('../../src/services/catalog-translation.service');
const { productSchema } = require('../../src/validators/admin.validator');
const { cardVariants } = require('../../src/utils/cardVariants');
const cloud = require('../../src/config/cloudinary-media.json').cloudName;
const image = `https://res.cloudinary.com/${cloud}/image/upload/test/one.jpg`;
const second = `https://res.cloudinary.com/${cloud}/image/upload/test/two.jpg`;
const input = { name: 'Sample', nameAr: 'عينة', categoryId: '1ac93ec3-2e14-4a25-a187-cc67d68fa331', priceEgp: '500', stock: '5', images: `${image}\n${second}` };

it('translates catalog terms both ways and refuses unsupported prose', () => {
  expect(translateCatalogText('Black', 'en')).toMatchObject({ complete: true, translated: 'أسود' });
  expect(translateCatalogText('أسود', 'ar')).toMatchObject({ complete: true, translated: 'Black' });
  expect(translateCatalogText('A completely unknown sentence here', 'en')).toEqual({ complete: false, translated: null });
  expect(translateCatalogText('<p><strong>Black</strong></p><script>bad()</script>', 'en', true)).toEqual({ complete: true, translated: '<p><strong>أسود</strong></p>' });
});
it('validates type images, unique names, quantities and card image assignments', () => {
  const presentation = { hoverImage: second, mobileImage: image, manageTypes: true, types: [{ en: 'Single', ar: 'مفرد', imageUrl: second, stock: 5, priceEgp: 500 }] };
  expect(productSchema.parse({ ...input, presentation: JSON.stringify(presentation) }).presentation.types).toHaveLength(1);
  for (const invalid of [
    { ...presentation, hoverImage: 'https://example.com/image.jpg' },
    { ...presentation, types: [...presentation.types, ...presentation.types] },
    { ...presentation, types: [{ ...presentation.types[0], stock: -1 }] },
    { ...presentation, types: [] },
  ]) expect(() => productSchema.parse({ ...input, presentation: JSON.stringify(invalid) })).toThrow();
});
it('resolves configured hover/mobile images and recognizes imported sets', () => {
  const record = { name: 'Bathroom Set', options: [], gallery: [{ sourceId: '1', src: image, cardSrc: '/one.webp' }, { sourceId: '2', src: second, cardSrc: '/two.webp' }], variants: [], catalogDetails: { presentation: { hoverImage: second, mobileImage: image } } };
  expect(cardVariants(record, 'en')).toMatchObject({ hoverImage: '/two.webp', mobileImage: '/one.webp', isSet: true });
  record.name = 'Bathroom Accessories 89 Black'; record.catalogDetails = {};
  expect(cardVariants(record, 'en')).toMatchObject({ mobileImage: '/one.webp', isSet: true });
});
