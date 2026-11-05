const { randomUUID } = require('node:crypto');
const { startOrderDatabase } = require('../helpers/order-database');
const prisma = require('../../src/config/prisma');
const catalogPath = require.resolve('../../src/services/catalog.repository');
const { createCartRepository } = require('../../src/repositories/cart.repository');
let database, repository, originalProvider, originalUrl, originalDirect, category, otherCategory, target, peer, unrelated, archived;
function pageContents(page) {
  // Membership IDs outside the hydrated scope are internal, not navigation content.
  return { ...page, categories: page.categories.map(item => ({ slug: item.slug, name: item.name, href: item.href, image: item.image })) };
}

beforeAll(async () => {
  database = await startOrderDatabase();
  originalProvider = prisma.getPrismaClient;
  originalUrl = process.env.DATABASE_URL; originalDirect = process.env.DIRECT_URL;
  process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic';
  delete process.env.DIRECT_URL;
  prisma.getPrismaClient = () => database.client;
  delete require.cache[catalogPath]; repository = require(catalogPath);
  [category, otherCategory] = await Promise.all(['mirrors', 'unrelated'].map(slug => database.client.categories.create({
    data: { slug, name: slug, name_ar: slug },
  })));
  async function product(slug, collection, presentation = {}) {
    return database.client.products.create({ data: { slug, name: slug, name_ar: slug, price_egp: 100, stock_quantity: 5,
      product_categories: { create: { category_id: collection.id } },
      catalog_details: { create: { presentation } },
      product_images: { create: { source_id: slug, secure_url: `https://res.cloudinary.com/synthetic/image/upload/v123/alreda-store/products/${slug}.jpg`, display_order: 0 } },
    } });
  }
  [target, peer, unrelated, archived] = await Promise.all([
    product('target', category), product('peer', category), product('unrelated-product', otherCategory),
    product('archived', category, { archivedAt: new Date().toISOString() }),
  ]);
}, 120000);
afterAll(async () => {
  prisma.getPrismaClient = originalProvider;
  if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  if (originalDirect === undefined) delete process.env.DIRECT_URL; else process.env.DIRECT_URL = originalDirect;
  delete require.cache[catalogPath];
  await database?.stop();
}, 30000);

it('hydrates only the requested product and its related collection without stale inventory', async () => {
  const scoped = await repository.getDatabaseCatalog(null, { productSlug: target.slug });
  expect([...scoped.products.keys()].sort()).toEqual([target.id, peer.id].sort());
  expect(scoped.bySlug.has(unrelated.slug)).toBe(false);
  expect(scoped.bySlug.has(archived.slug)).toBe(false);
  expect(scoped.bySlug.get(target.slug).gallery[0]).toMatchObject({
    src: `https://res.cloudinary.com/synthetic/image/upload/v123/alreda-store/products/${target.slug}.jpg`,
    cardSrc: `https://res.cloudinary.com/synthetic/image/upload/c_limit,w_640/q_auto/f_auto/v123/alreda-store/products/${target.slug}.jpg`,
  });
  await database.client.products.update({ where: { id: target.id }, data: { stock_quantity: 0, price_egp: 200 } });
  const fresh = await repository.getDatabaseCatalog(null, { productSlug: target.slug });
  expect(fresh.bySlug.get(target.slug)).toMatchObject({ stock_quantity: 0, variants: [{ priceAmount: '200.00' }] });
});

it('preserves collection contents, legacy aliases, and price sorting', async () => {
  const { getCollectionFromData } = require('../../src/services/category.service');
  const whole = await repository.getDatabaseCatalog();
  const alias = repository.catalog.legacyAliases.find(value => value.targetSlug === category.slug);
  for (const slug of [category.slug, ...(alias ? [alias.slug] : [])]) {
    const scoped = await repository.getDatabaseCatalog(null, { collectionSlug: slug });
    for (const sort of ['featured', 'price-asc', 'price-desc']) {
      expect(pageContents(getCollectionFromData(scoped, slug, { sort }))).toEqual(pageContents(getCollectionFromData(whole, slug, { sort })));
    }
  }
});

it('searches database-backed product names in both languages and hides archived items', async () => {
  await database.client.products.update({ where: { id: target.id }, data: { name: 'Black mirror holder', name_ar: 'حامل مرايا أسود' } });
  const english = await repository.searchCatalogProducts('mirror hold', 'en');
  expect(english).toContainEqual(expect.objectContaining({ name: 'Black mirror holder', href: '/products/target' }));
  const arabic = await repository.searchCatalogProducts('مرايا', 'ar');
  expect(arabic).toContainEqual(expect.objectContaining({ name: 'حامل مرايا أسود', href: '/products/target' }));
  expect(english.some(product => product.href === '/products/archived')).toBe(false);
});

it('preserves product variants and related results when hydration is scoped', async () => {
  const { getProductFromData } = require('../../src/services/product.service');
  const whole = await repository.getDatabaseCatalog();
  const scoped = await repository.getDatabaseCatalog(null, { productSlug: target.slug, collectionSlug: category.slug });
  expect(pageContents(getProductFromData(scoped, target.slug, { collection: category.slug }))).toEqual(pageContents(getProductFromData(whole, target.slug, { collection: category.slug })));
  expect(getProductFromData(scoped, target.slug, { collection: otherCategory.slug })).toEqual({ invalidSelection: true });
});

it('reads carts without creating empty rows and isolates each owner and guest token', async () => {
  const carts = createCartRepository(() => database.client);
  const owners = await Promise.all([1, 2].map(() => database.client.users.create({ data: { email: `${randomUUID()}@example.invalid`, name: 'Synthetic' } })));
  const count = await database.client.shopping_carts.count();
  const token = carts.newGuestToken();
  expect(await carts.get({ userId: owners[0].id })).toEqual({ cart_items: [] });
  expect(await carts.get({ guestToken: token })).toEqual({ cart_items: [] });
  expect(await database.client.shopping_carts.count()).toBe(count);
  await carts.add({ userId: owners[0].id, productId: peer.id, quantity: 1 });
  await carts.add({ guestToken: token, productId: unrelated.id, quantity: 2 });
  expect((await carts.get({ userId: owners[0].id })).cart_items[0]).toMatchObject({ product_id: peer.id, quantity: 1 });
  expect((await carts.get({ guestToken: token })).cart_items[0]).toMatchObject({ product_id: unrelated.id, quantity: 2 });
  expect(await carts.get({ userId: owners[1].id, guestToken: token })).toEqual({ cart_items: [] });
  expect(await carts.get({ guestToken: carts.newGuestToken() })).toEqual({ cart_items: [] });
});

it('persists serverless media recovery identifiers in the existing audit schema', async () => {
  const filename = require.resolve('../../src/repositories/media-journal.repository');
  delete require.cache[filename];
  const originalVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  const actor = await database.client.users.create({ data: { email: `${randomUUID()}@example.invalid`, name: 'Synthetic admin', role: 'admin' } });
  try {
    const { recordMediaEvent } = require(filename);
    await recordMediaEvent({ event: 'asset_uploaded', publicId: 'alreda-store/products/synthetic', assetId: 'synthetic-asset' }, { verifiedCatalogAdmin: true, userId: actor.id });
    const records = await database.client.admin_audit_events.findMany({ where: { actor_id: actor.id } });
    expect(records).toHaveLength(2);
    expect(new Set(records.map(row => row.action)).size).toBe(1);
    expect(records.map(row => row.target_id).sort()).toEqual(['asset:synthetic-asset', 'public:alreda-store/products/synthetic']);
  } finally {
    if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
    delete require.cache[filename];
  }
});
