const request = require('supertest');
const { createApp } = require('../../src/app');
const details = require('../../src/config/catalog.json');
const app = createApp({ environment: 'test' });
describe('product detail pages', () => {
  it.each(details.products.map(product => product.slug))('renders the local product %s', async slug => {
    const response = await request(app).get(`/products/${encodeURIComponent(slug)}`).expect(200);
    expect(response.text).toContain('id="product-title"');
    expect(response.text).toContain('id="specifications-title">More information');
    expect(response.text).toContain('/assets/images/products/');
    expect(response.text).toContain('purchasing is not connected');
  });
  it('rejects variants that do not belong to the requested product', async () => {
    const products = details.products;
    const response = await request(app).get(`/products/${products[0].slug}?variant=${products[1].variants[0].id}`).expect(400);
    expect(response.text).toContain('Invalid product selection');
  });
  it.each(['variant=invalid', 'variant=1&variant=2', 'collection=one&collection=two'])('rejects malformed selection %s', async query => {
    await request(app).get(`/products/${encodeURIComponent(details.products[0].slug)}?${query}`).expect(400);
  });
  it.each(['unknown', 'constructor'])('returns 404 for %s', async slug => {
    await request(app).get(`/products/${slug}`).expect(404);
  });
});
