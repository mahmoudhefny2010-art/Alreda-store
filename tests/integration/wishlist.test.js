'use strict';

const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { startOrderDatabase } = require('../helpers/order-database');
const { createApp } = require('../../src/app');
const { createCustomerAuthRepository } = require('../../src/repositories/customer-auth.repository');
const { createCartRepository } = require('../../src/repositories/cart.repository');
const { createWishlistRepository } = require('../../src/repositories/wishlist.repository');

let database; let owner; let other; let auth; let carts; let favorites; let app; let product; let variants; let fixture;
const logger = { error: vi.fn() };

beforeAll(async () => {
  database = await startOrderDatabase();
  auth = createCustomerAuthRepository(() => database.client);
  carts = createCartRepository(() => database.client);
  favorites = createWishlistRepository(() => database.client);
  [owner, other] = await Promise.all(['owner', 'other'].map(async label => database.client.users.create({ data: { name: label, email: `${randomUUID()}@example.invalid` } })));
  product = await database.client.products.create({ data: { source_id: `test-${randomUUID()}`, name: 'Synthetic faucet', name_ar: 'Test', slug: `test-${randomUUID()}`, price_egp: 400, stock_quantity: 8 } });
  variants = await Promise.all(['Black', 'Silver'].map((title, index) => database.client.product_variants.create({ data: { product_id: product.id, source_id: randomUUID(), title, price_egp: 400 + 100 * index, options: JSON.stringify([title]), is_available: true, stock_quantity: index ? 0 : 5 } })));
  const record = { id: product.id, sourceId: product.source_id, slug: product.slug, name: product.name, titleEn: product.name, titleAr: 'Test', isAvailable: true,
    stock_quantity: 8, priceEgp: 400, options: [{ name: 'Color', values: ['Black', 'Silver'] }], collectionIds: [], gallery: [{ sourceId: 'image-1', src: 'https://images.example.invalid/test.jpg', displaySrc: 'https://images.example.invalid/test.jpg' }],
    variants: variants.map((variant, index) => ({ databaseId: variant.id, id: variant.source_id, title: variant.title, titleAr: variant.title, options: [variant.title], priceAmount: `${400 + 100 * index}.00`, compareAtAmount: index ? '600.00' : null, inventoryQuantity: variant.stock_quantity, publicAvailable: variant.stock_quantity > 0, imageId: null })),
  };
  fixture = { persistent: true, products: new Map([[product.id, record], [product.source_id, record]]), bySlug: new Map([[product.slug, record]]), categories: [], byCategory: new Map(), catalog: { products: [record] } };
  app = createApp({ environment: 'test', logger, whatsappSettings: {}, mediaSettings: {}, authSettings: { SESSION_SECRET: 'wishlist-test-session-secret-that-is-long-enough' },
    authRepository: auth, cartRepository: carts, wishlistRepository: favorites, orders: { policy: { enabled: false, shippingRates: {} } },
    catalogProvider: async () => fixture,
  });
}, 120000);

afterAll(async () => { await database?.stop(); }, 30000);

async function sessionCookie(user) { const session = await auth.createSession(user.id); return `alreda_session=${session.token}`; }
function sameOrigin(req) { return req.set('Origin', 'http://127.0.0.1').set('Sec-Fetch-Site', 'same-origin'); }

describe('persistent customer wishlist', () => {
  it('saves uniquely per customer, merges guest identifiers, and isolates account data', async () => {
    await favorites.add(owner.id, product.id);
    await favorites.add(owner.id, product.id);
    expect(await favorites.listIds(owner.id)).toEqual([product.id]);
    expect(await favorites.listIds(other.id)).toEqual([]);
    await favorites.merge(owner.id, [product.source_id, product.id, product.source_id]);
    expect(await favorites.listIds(owner.id)).toEqual([product.id]);

    const ownerCookie = await sessionCookie(owner); const otherCookie = await sessionCookie(other);
    const ownerList = await request(app).get('/api/wishlist').set('Cookie', ownerCookie).expect(200);
    expect(ownerList.body.items).toHaveLength(1);
    expect(ownerList.body.items[0]).toMatchObject({ id: product.id, name: 'Synthetic faucet', hasOptions: true, outOfStock: false });
    expect(ownerList.body.items[0].variants.find(value => value.title === 'Silver')).toMatchObject({ available: false });
    expect(ownerList.body.items[0].variants.find(value => value.title === 'Silver').compareAt).toContain('600');
    expect((await request(app).get('/api/wishlist').set('Cookie', otherCookie).expect(200)).body.items).toEqual([]);
    await sameOrigin(request(app).post('/api/wishlist/items').set('Cookie', otherCookie)).send({ productId: product.id }).expect(200);
    expect(await favorites.listIds(other.id)).toEqual([product.id]);
    await favorites.remove(owner.id, product.id);
    expect(await favorites.listIds(owner.id)).toEqual([]);
    expect(await favorites.listIds(other.id)).toEqual([product.id]);
  });

  it('keeps option and stock checks in the existing cart API, and rejects unpublished products', async () => {
    const cookie = await sessionCookie(owner);
    await expect(carts.add({ userId: owner.id, productId: product.id, quantity: 1 })).rejects.toThrow('PRODUCT_OPTIONS_REQUIRED');
    const cart = await carts.add({ userId: owner.id, productId: product.id, variantId: variants[0].id, quantity: 2 });
    expect(cart.cart_items[0]).toMatchObject({ product_id: product.id, variant_id: variants[0].id, quantity: 2 });
    await expect(carts.add({ userId: owner.id, productId: product.id, variantId: variants[1].id, quantity: 1 })).rejects.toThrow('INSUFFICIENT_INVENTORY');
    await database.client.products.update({ where: { id: product.id }, data: { is_available: false } });
    await expect(favorites.add(owner.id, product.id)).rejects.toThrow('PRODUCT_UNAVAILABLE');
    fixture.products.get(product.id).isAvailable = false;
    const response = await request(app).get('/api/wishlist?ids=' + encodeURIComponent(product.id)).set('Cookie', cookie).expect(200);
    expect(response.body.items).toEqual([]); // An unavailable item cannot be added as a new favorite.
  });

  it('renders the localized mobile wishlist and lets the session CSRF token authorize logout when Origin is stripped', async () => {
    const cookie = await sessionCookie(other);
    const page = await request(app).get('/wishlist').set('Cookie', cookie).expect(200);
    expect(page.text).toContain('Your favorites');
    expect(page.text).toContain('mobile-bottom-nav');
    const token = page.text.match(/name="_csrf" value="([a-f0-9]{64})"/i)?.[1];
    expect(token).toBeTruthy();
    await request(app).post('/auth/logout').set('Cookie', cookie).type('form').send({ _csrf: token }).expect(303);
    const next = await sessionCookie(other);
    await request(app).post('/auth/logout').set('Cookie', next).type('form').send({ _csrf: '0'.repeat(64) }).expect(403);
  });
});
