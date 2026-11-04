const request = require('supertest');
const { createApp } = require('../../src/app');
const { assetUrl } = require('../../src/utils/staticAssets');
const { optimizedImageUrl } = require('../../src/utils/optimizedImage');
const { createCheckoutController } = require('../../src/controllers/storefront/checkout.controller');
const { createCartRepository } = require('../../src/repositories/cart.repository');

describe('production HTTP delivery', () => {
  const app = createApp({ environment: 'production', authSettings: {}, mediaSettings: {}, whatsappSettings: {} });
  it('negotiates gzip while keeping personalized HTML private', async () => {
    const response = await request(app).get('/').set('Accept-Encoding', 'gzip').expect(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers.vary).toContain('Accept-Encoding');
    expect(response.headers.vary).toContain('Cookie');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.text).toContain('Browse our latest products');
    await request(app).get('/').set('Accept-Encoding', 'identity').expect(200).then(result => {
      expect(result.headers['content-encoding']).toBeUndefined();
    });
    expect(app.enabled('view cache')).toBe(true);
  });
  it('caches content-versioned assets immutably and revalidates unversioned assets', async () => {
    const url = assetUrl('/assets/css/main.css');
    const response = await request(app).get(url).expect(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    await request(app).get(url).set('If-None-Match', response.headers.etag).expect(304);
    for (const url of ['/assets/css/main.css', '/assets/css/main.css?v=000000000000']) {
      await request(app).get(url).expect(200).then(result => {
        expect(result.headers['cache-control']).toBe('public, max-age=3600');
      });
    }
    await request(app).get('/service-worker.js').expect('Cache-Control', 'no-cache');
  });
  it('does not treat traversal paths as content-versioned assets', () => {
    for (const url of ['/assets/css/../secret.js', '/assets/js/folder/../../secret.js']) expect(assetUrl(url)).toBe(url);
  });
  it('answers a new guest bag request without touching the database or creating a cookie', async () => {
    const repository = { get: vi.fn(), newGuestToken: vi.fn() };
    const app = createApp({ environment: 'test', authSettings: {}, mediaSettings: {}, whatsappSettings: {}, cartRepository: repository });
    const response = await request(app).get('/api/cart').expect(200);
    expect(response.body).toEqual({ cart_items: [] });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.newGuestToken).not.toHaveBeenCalled();
  });
});

describe('public Cloudinary delivery', () => {
  it('reuses existing optimized Cloudinary derivatives to avoid duplicate transformations', () => {
    const url = 'https://res.cloudinary.com/synthetic/image/upload/c_limit,f_auto,q_auto,w_640/v123/sample.jpg';
    expect(optimizedImageUrl(url, 'product-card')).toBe(url);
  });
  it('preserves deliberate crops when adding delivery optimization', () => {
    expect(optimizedImageUrl('https://res.cloudinary.com/synthetic/image/upload/c_crop,h_800,w_800/v123/sample.jpg', 'thumbnail'))
      .toContain('/c_crop,h_800,w_800/c_limit,w_160/q_auto/f_auto/v123/sample.jpg');
  });
  it('preserves the current upload version and public ID at fixed card/detail/thumbnail widths', () => {
    const original = 'https://res.cloudinary.com/synthetic/image/upload/v123/alreda-store/products/sample.jpg';
    for (const [profile, width] of [['thumbnail', 160], ['product-card', 640], ['product-detail', 1200]]) {
      const url = optimizedImageUrl(original, profile);
      expect(url).toContain(`c_limit,w_${width}/q_auto/f_auto/v123/alreda-store/products/sample.jpg`);
      expect(optimizedImageUrl(url, profile)).toBe(url);
    }
  });
  it.each([
    '/assets/images/sample.webp', 'invalid-url',
    'https://res.cloudinary.com.evil.test/synthetic/image/upload/v1/sample.jpg',
    'https://res.cloudinary.com/synthetic/image/private/v1/sample.jpg',
    'https://res.cloudinary.com/synthetic/image/upload/s--signature--/v1/sample.jpg',
    'https://res.cloudinary.com/synthetic/image/upload/v1/sample.jpg?auth_token=synthetic',
  ])('leaves non-public or unsupported URLs intact: %s', value => {
    expect(optimizedImageUrl(value, 'thumbnail')).toBe(value);
  });
});

it('does not acquire a database connection for a bag with no owner or guest token', async () => {
  const provider = vi.fn();
  expect(await createCartRepository(provider).get({})).toEqual({ cart_items: [] });
  expect(provider).not.toHaveBeenCalled();
});

it('does not load the entire checkout catalog when the customer already has cart items', async () => {
  const product = { id: 'synthetic-id', stock_quantity: 9 };
  const repository = { products: vi.fn(), latestCustomerOrder: vi.fn(async () => null) };
  const controller = createCheckoutController({ repository, service: { settings: { shippingRates: {} } },
    cartRepository: { get: async () => ({ cart_items: [{ products: product, product_id: product.id, quantity: 2, variant_id: 'variant', product_variants: { stock_quantity: 3 } }] }) } });
  const render = vi.fn();
  await controller.page({}, { locals: { orderUserId: 'owner', t: key => key }, render });
  expect(repository.products).not.toHaveBeenCalled();
  expect(render.mock.calls[0][1]).toMatchObject({ products: [{ id: product.id, stock_quantity: 3, variant_id: 'variant' }], cartQuantities: { variant: 2 } });
});
