const { buildPlan } = require('../../scripts/database/import-catalog');

const manifest = { cloudName: 'test-cloud' };
const sourceCatalog = {
  products: [{ sourceId: '101', name: 'Product', slug: 'product', titleEn: 'Product', gallery: [{ sourceId: 'image-1' }], variants: [{ id: '201' }] }],
  collections: [{ sourceId: '301', name: 'Collection', slug: 'collection' }],
};
function delivery(mapped = true) {
  return { applyCatalog: catalog => ({
    ...catalog,
    products: catalog.products.map(product => ({ ...product, gallery: product.gallery.map(image => ({ ...image,
      src: mapped ? 'https://res.cloudinary.com/test-cloud/image/upload/image.jpg' : '/assets/image.jpg',
      cloudinary: mapped ? { secureUrl: 'https://res.cloudinary.com/test-cloud/image/upload/image.jpg' } : null,
    })) })),
    collections: catalog.collections.map(category => ({ ...category, image: null })),
  }) };
}

describe('database catalog import preflight', () => {
  it('plans the normalized catalog and confirms every product image has a Cloudinary source', () => {
    expect(buildPlan(sourceCatalog, manifest, delivery())).toMatchObject({ products: 1, categories: 1,
      variants: 1, images: 1, mappedCloudinaryImages: 1 });
  });

  it('refuses a local or unmapped product image', () => {
    expect(() => buildPlan(sourceCatalog, manifest, delivery(false))).toThrow('CATALOG_HAS_NON_CLOUDINARY_IMAGES');
  });

  it('refuses non-Cloudinary collection cover images', () => {
    const localCover = { ...delivery(), applyCatalog: catalog => ({ ...delivery().applyCatalog(catalog),
      collections: [{ ...catalog.collections[0], image: '/assets/cover.jpg' }] }) };
    expect(() => buildPlan(sourceCatalog, manifest, localCover)).toThrow('CATALOG_HAS_NON_CLOUDINARY_IMAGES');
  });
});
