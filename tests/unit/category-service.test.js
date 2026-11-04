const { getCollection } = require('../../src/services/category.service');
describe('imported collection service', () => {
  it('does not return another collection for an unknown slug', () => {
    expect(getCollection('unknown')).toBeNull();
  });
  it('searches within the selected collection', () => {
    const original = getCollection('mirrors');
    const result = getCollection('mirrors', { q: original.products[0].name });
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products.every(product => product.name.includes(original.products[0].name))).toBe(true);
    expect(result.products.every(product => result.category.productIds.includes(product.id))).toBe(true);
  });
  it('paginates the complete catalog without duplicate or skipped products', () => {
    const { catalog } = require('../../src/services/catalog.repository');
    const first = getCollection(null);
    const pages = Array.from({ length: first.pageCount }, (_, index) => getCollection(null, { page: index + 1 }));
    const ids = pages.flatMap(page => page.products.map(product => product.id));
    expect(new Set(ids).size).toBe(catalog.products.length);
    expect(ids.length).toBe(catalog.products.length);
    expect(getCollection(null, { page: first.pageCount + 1 })).toEqual({ invalidPage: true });
  });
  it('keeps long page lists compact while retaining first, last and nearby pages', () => {
    const first = getCollection(null, { page: 1 });
    if (first.pageCount <= 7) return;
    for (const current of [1, 4, Math.ceil(first.pageCount / 2), first.pageCount]) {
      const { pagination } = getCollection(null, { page: current });
      const numbers = pagination.map(item => item.number);
      expect(numbers.length).toBeLessThanOrEqual(7);
      expect(numbers[0]).toBe(1);
      expect(numbers.at(-1)).toBe(first.pageCount);
      expect(numbers).toContain(current);
      expect(numbers.filter(number => number === null).length).toBeGreaterThan(0);
    }
  });
  it('sorts snapshot prices safely without mutating the source order', () => {
    const original = getCollection('mirrors').products.map(product => product.id);
    const ascending = getCollection('mirrors', { sort: 'price-asc' }).products;
    const cents = product => BigInt(product.priceAmount.replace('.', ''));
    expect(ascending.every((product, index) => index === 0 || cents(ascending[index - 1]) <= cents(product))).toBe(true);
    expect(getCollection('mirrors', { sort: 'price-desc' }).products.map(cents)).toEqual(ascending.map(cents).reverse());
    expect(getCollection('mirrors').products.map(product => product.id)).toEqual(original);
  });
  it('keeps the three verified mirror-stand products assigned to their matching collection', () => {
    const { products, byCategory } = require('../../src/services/catalog.repository');
    const category = byCategory.get('mirror-stand');
    for (const slug of ['delight-mirror-stand-122', 'delight-mirror-stand-858', 'delight-mirror-stand-853']) {
      const product = [...products.values()].find(item => item.slug === slug);
      expect(product.collectionIds).toContain(category.sourceId);
      expect(category.productIds).toContain(product.sourceId);
    }
  });
});
