const { getProduct } = require('../../src/services/product.service');
const sanitizeDescription = require('../../src/utils/sanitizeProductDescription');
const slug = 'delight-bathroom-accessories-pieces-stainless-304-black';
describe('product details service', () => {
  it('selects valid product variants and uses decimal display prices', () => {
    const page = getProduct(slug, { collection: 'individual-pieces' });
    const different = page.product.variants.find(variant => variant.priceAmount !== page.product.selectedVariant.priceAmount);
    expect(different).toBeDefined();
    const updated = getProduct(slug, { variant: different.id, collection: 'individual-pieces' });
    expect(updated.product.selectedVariant.id).toBe(different.id);
    expect(updated.product.selectedVariant.currentFormatted).toContain('EGP');
    expect(updated.product.selectedVariant.currentFormatted).not.toBe(page.product.selectedVariant.currentFormatted);
  });
  it('does not substitute an unrelated variant or category', () => {
    expect(getProduct(slug, { variant: '1' })).toEqual({ invalidSelection: true });
    expect(getProduct(slug, { collection: 'mirrors' })).toEqual({ invalidSelection: true });
  });
  it('uses the source-associated image for each color and size combination', () => {
    const { catalog } = require('../../src/services/catalog.repository');
    const record = catalog.products.find(product => product.slug === 'delight-magic-hidden-clothes-drying-rack-stainless');
    for (const variant of record.variants) {
      const image = record.gallery.find(image => image.sourceId === variant.imageId);
      expect(image).toBeDefined();
      const page = getProduct(record.slug, { variant: variant.id });
      expect(page.product.selectedVariant.gallerySrc).toBe(image.src);
      expect(page.product.primaryImage.src).toBe(image.src);
    }
  });
  it('returns the product main image for variants without a source image', () => {
    const { catalog } = require('../../src/services/catalog.repository');
    const record = catalog.products.find(product => product.variants.some(variant => variant.imageId) && product.variants.some(variant => !variant.imageId));
    const variant = record.variants.find(variant => !variant.imageId);
    const page = getProduct(record.slug, { variant: variant.id });
    expect(page.product.selectedVariant.gallerySrc).toBe(record.gallery[0].src);
    expect(page.product.primaryImage.src).toBe(record.gallery[0].src);
  });
  it('returns related products from the same collection and excludes itself', () => {
    const page = getProduct(slug, { collection: 'individual-pieces' });
    expect(page.relatedProducts).toHaveLength(4);
    expect(page.relatedProducts.every(item => page.category.productIds.includes(item.id))).toBe(true);
    expect(page.relatedProducts.every(item => !item.href.includes(`/products/${slug}?`))).toBe(true);
  });
  it.each(['unknown', 'constructor', '__proto__'])('does not resolve object prototype names: %s', value => {
    expect(getProduct(value)).toBeNull();
  });
  it('strips active content and attributes while preserving readable formatting', () => {
    const html = sanitizeDescription('<h2 style="color:red">Features</h2><p onclick="bad()">Safe <strong>detail</strong><img src=x onerror="bad()"></p><script>bad()</script><iframe src="https://invalid.test"></iframe><a href="javascript:bad()">link</a>');
    expect(html).toContain('<h3>Features</h3>');
    expect(html).toContain('<strong>detail</strong>');
    expect(html).not.toMatch(/<script|<iframe|<img|onclick|onerror|href=|style=/);
    expect(html).not.toContain('bad()');
  });
});
