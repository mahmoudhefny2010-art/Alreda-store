const request = require('supertest');
const express = require('express');
const path = require('node:path');
const { createApp } = require('../../src/app');
const errorHandler = require('../../src/middleware/error.middleware');
const { translate } = require('../../src/config/storefront-i18n');
const app = createApp({ environment: 'test' });

describe('Phase 1 HTTP application', () => {
  it.each([['/', 'Collections']])('renders %s through EJS', async (url, text) => {
    const response = await request(app).get(url).expect(200).expect('Content-Type', /html/);
    expect(response.text).toContain(text);
    expect(response.text).not.toContain('<%=');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.text).toContain('/assets/js/vercel-analytics-bootstrap.js');
    expect(response.text).not.toContain('window.va =');
  });
  it('redirects old collection preview links to the dedicated page', async () => {
    await request(app).get('/?collection=mirrors').expect(302).expect('Location', '/collections/mirrors');
  });
  it.each(require('../../src/config/storefront-preview').categories)('renders only products in $slug', async category => {
    const response = await request(app).get(category.href).expect(200);
    const { getCollection } = require('../../src/services/category.service');
    const expected = getCollection(category.slug);
    expect(response.text).toContain('id="collection-title"');
    expect(response.text.match(/class="product-card"/g) || []).toHaveLength(expected.products.length);
    const ids = [...response.text.matchAll(/data-product-id="([^"]+)"/g)].map(match => match[1]);
    expect(ids.every(id => category.productIds.includes(id))).toBe(true);
    expect(response.text).not.toContain('class="shopping-hero"');
    expect(response.text).toContain(translate('en', 'snapshotNotice'));
  });
  it('returns 404 for missing collections', async () => {
    await request(app).get('/collections/unknown').expect(404);
  });
  it('shows an empty state when collection search has no matches', async () => {
    const response = await request(app).get('/collections/mirrors?q=not-a-product').expect(200);
    expect(response.text).toContain('No products to display.');
    expect(response.text).toContain('Clear search');
  });
  it('finds products by English or Arabic name in the global search', async () => {
    const product = require('../../src/config/catalog.json').products[0];
    const english = await request(app).get('/api/products/search').query({ q: product.titleEn.split(' ').slice(0, 2).join(' ') }).expect(200);
    expect(english.body.products).toContainEqual(expect.objectContaining({ href: `/products/${product.slug}` }));
    const arabic = await request(app).get('/api/products/search').query({ q: product.titleAr.slice(0, 3) }).set('Cookie', 'alreda_locale=ar').expect(200);
    expect(arabic.body.products).toContainEqual(expect.objectContaining({ name: product.titleAr, href: `/products/${product.slug}` }));
    await request(app).get('/api/products/search').query({ q: 'x' }).expect(400).expect({ products: [] });
  });
  it('shows product search in the global search dialog', async () => {
    const response = await request(app).get('/').expect(200);
    expect(response.text).toContain('Search products and collections');
    expect(response.text).toContain('data-search-kind="collection"');
    expect(response.text).toContain('Search by product or collection name');
  });
  it.each(['sort=invalid', 'q=one&q=two', 'sort=featured&sort=price-asc', 'page=0', 'page=-1', 'page=1&page=2', 'page=1.5'])('rejects invalid collection filters %s', async query => {
    await request(app).get(`/collections/mirrors?${query}`).expect(400);
  });
  it('shows all products with pagination and rejects pages beyond the result set', async () => {
    await request(app).get('/products?page=2&sort=price-asc').expect(200);
    await request(app).get('/products?page=99999').expect(404);
    await request(app).get('/products?page=invalid').expect(400);
  });
  it.each(['unknown', '%3Cscript%3E', 'mirrors&collection=soap-dispensers'])('rejects invalid collection input %s', async value => {
    await request(app).get(`/?collection=${value}`).expect(400);
  });
  it('requires verified identity before exposing the database-backed admin dashboard', async () => {
    const response = await request(app).get('/admin').expect('Cache-Control', 'no-store').expect(401);
    expect(response.text).toContain('Sign in to administration');
    expect(response.text).not.toContain(translate('en', 'checkoutUnavailable'));
    expect(response.text).not.toContain('Synthetic Buyer');
  });
  it.each([['/assets/css/main.css', /css/], ['/assets/css/base/variables.css', /css/], ['/assets/js/main.js', /javascript/], ['/assets/js/vercel-analytics-bootstrap.js', /javascript/]])('serves %s', async (url, type) => {
    await request(app).get(url).expect(200).expect('Content-Type', type);
  });
  it('returns a helpful 404 without reflecting attacker input', async () => {
    const response = await request(app).get('/%3Cscript%3Ebad%3C/script%3E').expect(404);
    expect(response.text).toContain(translate('en', 'notFoundTitle'));
    expect(response.text).not.toContain('<script>bad');
  });
  it('does not expose project configuration as static files', async () => {
    await request(app).get('/assets/.env').expect(404);
    await request(app).get('/package.json').expect(404);
  });
  it('rejects malformed and oversized bodies', async () => {
    await request(app).post('/').set('Content-Type', 'application/json').send('{').expect(400);
    await request(app).post('/').send({ data: 'x'.repeat(20000) }).expect(413);
  });
  it('handles async server errors safely without a public failure endpoint', async () => {
    const testApp = express();
    testApp.set('views', path.resolve(__dirname, '../../src/views'));
    testApp.set('view engine', 'ejs');
    testApp.locals.siteName = 'Alreda Store';
    testApp.locals.year = 2026;
    testApp.use((req, res, next) => {
      res.locals.locale = 'en';
      res.locals.direction = 'ltr';
      res.locals.returnTo = req.originalUrl;
      res.locals.t = key => translate('en', key);
      next();
    });
    const logger = { error: vi.fn() };
    testApp.get('/failure', async () => { throw new Error('secret database credential'); });
    testApp.use(errorHandler(logger));
    const response = await request(testApp).get('/failure').expect(500);
    expect(response.text).toContain(translate('en', 'errorTitle'));
    expect(response.text).not.toContain('secret database credential');
    expect(logger.error).toHaveBeenCalledWith({ event: 'request_failed', status: 500 });
  });
});
