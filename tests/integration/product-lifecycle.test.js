const request = require('supertest');
const express = require('express');
const path = require('node:path');
const ejs = require('ejs');
const { createAdminManagementRoutes } = require('../../src/routes/admin-management.routes');
const { createAdminCsrfToken } = require('../../src/security/admin-csrf');
const { selection } = require('../../src/services/purchase-selection.service');
const { randomUUID } = require('node:crypto');
const { startOrderDatabase } = require('../helpers/order-database');
const { createAdminManagementRepository } = require('../../src/repositories/admin-management.repository');
const { readCloudinaryConfig } = require('../../src/config/cloudinary');

const adminId = 'd2e4097a-4c78-44c8-b411-9ed4acec2380';
const productId = '26be682a-af63-42d3-8903-b9f0db579cb2';
const sessionToken = 'synthetic-admin-session-token';
const csrfSecret = 'synthetic-csrf-secret-that-is-at-least-32-characters';

function lifecycleApp() {
  const calls = [];
  let pending = true;
  const repository = {
    catalog: async ({ includeArchived = false } = {}) => ({ products: includeArchived ? [{ id: productId, name: 'Archived fixture', name_ar: 'منتج مؤرشف', product_images: [], image_url: '' }] : [], categories: [], sections: [], details: [] }),
    archiveProduct: async (actorId, id) => calls.push(['archive', actorId, id]),
    restoreProduct: async (actorId, id) => calls.push(['restore', actorId, id]),
    permanentlyDeleteProduct: async (actorId, id) => { calls.push(['delete', actorId, id]); return { queuedAssets: 1, assetPublicIds: ['alreda-store/products/test/image'] }; },
    pendingCloudinaryCleanupJobs: async () => pending ? [{ id: 'job-id', public_id: 'alreda-store/products/test/image', asset_id: 'asset-id' }] : [],
    completeCloudinaryCleanupJob: async () => { pending = false; },
    retryCloudinaryCleanupJob: async () => {},
    hasPendingCloudinaryCleanup: async () => pending,
  };
  const identities = { principal: async id => ({ id, role: 'admin', user_roles: [], admin_permissions: ['catalog'] }) };
  const cloudinaryService = { deleteCatalogAsset: async () => ({ deleted: true }) };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.customer = { id: adminId }; req.customerSessionToken = sessionToken;
    const getHeader = req.get.bind(req);
    req.get = name => name.toLowerCase() === 'host' ? 'store.test' : getHeader(name);
    res.locals.a = key => key; res.locals.orderUserId = adminId;
    res.render = (view, data) => res.json({ view, contentView: data.contentView, productIds: data.products?.map(item => item.id) || [], savedMessage: data.savedMessage || '', cleanupQueued: data.cleanupQueued || false, csrfToken: data.csrfToken || '' });
    next();
  });
  app.use(createAdminManagementRoutes({ repository, identities, cloudinaryService, csrfSecret,
    authenticate: req => req.customer ? { userId: req.customer.id } : null }));
  return { app, calls, repository };
}

describe('product archive and deletion lifecycle', () => {
  it('archives and restores through authorized, CSRF-protected admin actions', async () => {
    const { app, calls } = lifecycleApp();
    const token = createAdminCsrfToken(sessionToken, csrfSecret);
    await request(app).post(`/admin/catalog/products/${productId}/archive`).set('Origin', 'http://store.test').type('form').send({ _csrf: token }).expect(303);
    await request(app).get('/admin/catalog/archived').expect(200).then(response => expect(response.body.productIds).toEqual([productId]));
    await request(app).post(`/admin/catalog/products/${productId}/restore`).set('Origin', 'http://store.test').type('form').send({ _csrf: token }).expect(303);
    expect(calls).toEqual([['archive', adminId, productId], ['restore', adminId, productId]]);
  });

  it('permanently deletes through the repository and immediately processes queued Cloudinary cleanup', async () => {
    const { app, calls } = lifecycleApp();
    const listing = await request(app).get('/admin/catalog/archived').expect(200);
    await request(app).post(`/admin/catalog/products/${productId}/permanent-delete`).set('Origin', 'http://store.test').type('form').send({ _csrf: listing.body.csrfToken })
      .expect(303).expect('Location', '/admin/catalog/archived?saved=deleted');
    expect(calls).toEqual([['delete', adminId, productId]]);
  });

  it('shows the irreversible delete action only in the archived workspace', async () => {
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin/archived-products.ejs'), {
      a: key => key, locale: 'en', products: [{ id: productId, name: 'Archived fixture', name_ar: 'منتج مؤرشف', price_egp: 100, stock_quantity: 2, product_images: [], image_url: '' }], csrfToken: 'synthetic-token', savedMessage: '', cleanupQueued: false,
    });
    expect(html).toContain(`/admin/catalog/products/${productId}/restore`);
    expect(html).toContain(`/admin/catalog/products/${productId}/permanent-delete`);
    expect(html).toContain('confirm(');
  });

  it('prevents an archived product from being added or checked out', async () => {
    const tx = { $queryRaw: async () => {}, products: { findUnique: async () => ({ id: productId, is_available: true, catalog_details: { presentation: { archivedAt: '2026-11-04T00:00:00.000Z' } } }) } };
    await expect(selection(tx, productId, null, 1)).rejects.toThrow('PRODUCT_UNAVAILABLE');
  });
});

describe('product lifecycle persistence on a disposable PostgreSQL database', () => {
  let database;
  let repository;
  let actorId;
  beforeAll(async () => {
    database = await startOrderDatabase();
    repository = createAdminManagementRepository(() => database.client);
    actorId = randomUUID();
    await database.client.users.create({ data: { id: actorId, email: `${actorId}@example.test`, name: 'Synthetic Catalog Admin', role: 'admin' } });
  }, 120000);
  afterAll(async () => { await database?.stop(); }, 30000);

  it('preserves archived product data, restores it, and permanently deletes related catalog data while retaining order snapshots', async () => {
    const root = readCloudinaryConfig().rootFolder;
    const cloudPublicId = `${root}/products/synthetic-product/main/image`;
    const imageUrl = `https://res.cloudinary.com/alreda-test/image/upload/${cloudPublicId}.jpg`;
    const product = await database.client.products.create({ data: {
      name: 'Synthetic lifecycle product', name_ar: 'منتج اختبار', slug: `synthetic-${randomUUID()}`, price_egp: 100,
      image_url: imageUrl, stock_quantity: 5,
      product_images: { create: { source_id: 'synthetic-image', secure_url: imageUrl, public_id: cloudPublicId, asset_id: 'synthetic-asset-id', is_primary: true } },
      product_options: { create: { option_group: 'type', name: 'Single', name_ar: 'مفرد' } },
    } });
    const order = await database.client.orders.create({ data: { order_number: `T${randomUUID().replaceAll('-', '').slice(0, 20)}`, address_snapshot: '{}', customer_name: 'Synthetic Buyer', customer_phone: '+201000000000', subtotal_egp: 200, total_egp: 200 } });
    const snapshot = await database.client.order_items.create({ data: { order_id: order.id, product_id: product.id, product_name: product.name, product_name_ar: product.name_ar, quantity: 2, unit_price_egp: 100, line_total_egp: 200 } });
    const discount = await database.client.discount_rules.create({ data: { name: 'Synthetic product discount', name_ar: 'خصم اختبار', mode: 'PERCENT', amount: 10, scope: 'PRODUCT', target: product.id, starts_at: new Date(Date.now() - 60000), ends_at: new Date(Date.now() + 3600000) } });

    await repository.archiveProduct(actorId, product.id);
    expect((await database.client.products.findUnique({ where: { id: product.id }, include: { catalog_details: true } })).catalog_details.presentation.archivedAt).toBeTruthy();
    expect((await repository.catalog()).products.some(item => item.id === product.id)).toBe(false);
    expect((await repository.catalog({ includeArchived: true })).products.some(item => item.id === product.id)).toBe(true);
    await repository.restoreProduct(actorId, product.id);
    expect((await repository.catalog()).products.some(item => item.id === product.id)).toBe(true);

    await repository.archiveProduct(actorId, product.id);
    const deletion = await repository.permanentlyDeleteProduct(actorId, product.id);
    expect(deletion.queuedAssets).toBe(1);
    expect(await database.client.products.findUnique({ where: { id: product.id } })).toBeNull();
    expect(await database.client.product_options.count({ where: { product_id: product.id } })).toBe(0);
    expect(await database.client.discount_rules.findUnique({ where: { id: discount.id } })).toBeNull();
    expect(await database.client.product_images.count({ where: { product_id: product.id } })).toBe(0);
    expect(await database.client.cloudinary_cleanup_jobs.findUnique({ where: { public_id: cloudPublicId } })).toMatchObject({ status: 'PENDING', asset_id: 'synthetic-asset-id' });
    expect(await database.client.order_items.findUnique({ where: { id: snapshot.id } })).toMatchObject({ product_id: null, product_name: 'Synthetic lifecycle product', quantity: 2, line_total_egp: 200 });
  }, 120000);
});
