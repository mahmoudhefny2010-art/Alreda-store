const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { startOrderDatabase } = require('../helpers/order-database');
const { createStoreSettingsRepository, readDelivery } = require('../../src/repositories/store-settings.repository');
const { createOrderRepository } = require('../../src/repositories/order.repository');
const { createOrderService } = require('../../src/services/order.service');
const { createNotificationRepository } = require('../../src/repositories/notification.repository');
const { createNotificationWorker } = require('../../src/services/notification-worker.service');
const { createApp } = require('../../src/app');
const message = { titleEn: 'Store news', titleAr: 'أخبار المتجر', bodyEn: 'Discover our products.', bodyAr: 'اكتشف منتجاتنا.', url: '/products' };
const shipping = fee => ({ mode: 'CITY', flatFee: 0, zones: [{ city: 'Cairo', cityAr: 'القاهرة', fee, enabled: true }, { city: 'Giza', cityAr: 'الجيزة', fee: 0, enabled: false }] });
let database, settings, orders, admin, customer, optedOut, noDevice;
beforeAll(async () => {
  database = await startOrderDatabase(); settings = createStoreSettingsRepository(() => database.client); orders = createOrderRepository(() => database.client);
  const user = role => database.client.users.create({ data: { name: 'Synthetic account', email: `${randomUUID()}@example.invalid`, role } });
  [admin, customer, optedOut, noDevice] = await Promise.all([user('admin'), user('customer'), user('customer'), user('customer')]);
  for (const person of [customer, optedOut, noDevice]) await database.client.notification_preferences.create({ data: { user_id: person.id, marketing_enabled: person.id !== optedOut.id, transactional_enabled: true } });
  for (const person of [customer, optedOut]) await database.client.push_subscribers.create({ data: { user_id: person.id, external_id: person.id, onesignal_subscription_id: randomUUID() } });
}, 120000);
afterAll(async () => database?.stop(), 30000);

it('saves authorized shipping configuration and rejects unauthorized or invalid changes', async () => {
  await expect(settings.saveShipping(customer.id, shipping(30))).rejects.toThrow('ADMIN_REQUIRED');
  await settings.saveShipping(admin.id, shipping(30));
  expect(await readDelivery(database.client, { Legacy: 999 })).toEqual({ rates: { Cairo: 30 }, labels: { Cairo: 'القاهرة', Giza: 'الجيزة' } });
  await expect(settings.saveShipping(admin.id, shipping(-1))).rejects.toThrow();
  expect((await settings.shipping()).zones[0].fee).toBe(30);
});

it('saves the authenticated delivery form with a rewritten Origin and exposes the committed fee at checkout', async () => {
  const { createCustomerAuthRepository } = require('../../src/repositories/customer-auth.repository');
  const auth = createCustomerAuthRepository(() => database.client);
  const session = await auth.createSession(admin.id);
  const application = createApp({ environment: 'test', authSettings: { SESSION_SECRET: 'synthetic-delivery-csrf-secret-'.repeat(2) }, authRepository: auth,
    cartRepository: require('../../src/repositories/cart.repository').createCartRepository(() => database.client),
    logger: { error: () => {} }, orders: { repository: orders, policy: { enabled: true, origin: 'http://127.0.0.1:666', shippingRates: {} }, settingsRepository: settings } });
  const cookie = `alreda_session=${session.token}`;
  const page = await request(application).get('/admin/delivery').set('Cookie', cookie).expect(200);
  const csrf = page.text.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
  await request(application).post('/admin/delivery').set('Host', '127.0.0.1:666').set('Origin', 'null').set('Cookie', cookie).type('form')
    .send({ configuration: JSON.stringify(shipping(57)), _csrf: csrf }).expect(303);
  expect((await settings.shipping()).zones[0].fee).toBe(57);
  const saved = await request(application).get('/admin/delivery?saved=1').set('Cookie', cookie).expect(200);
  expect(saved.text).toContain('Delivery settings saved.');
  const checkout = await request(application).get('/checkout').set('Cookie', cookie).expect(200);
  expect(checkout.text).toContain('data-fee="57"');
});
it('uses fresh database delivery fees, rolls back a stale total, and reconciles an existing order before new pricing', async () => {
  await settings.saveShipping(admin.id, shipping(30));
  const product = await database.client.products.create({ data: { name: 'Synthetic item', name_ar: 'منتج تجريبي', slug: randomUUID(), price_egp: 100, stock_quantity: 3 } });
  const service = createOrderService({ repository: orders, policy: { enabled: true, origin: 'http://localhost', shippingRates: {} }, shippingProvider: fallback => orders.shippingRates(fallback), logger: { error: () => {} } });
  expect((await service.checkoutSettings()).shippingRates).toEqual({ Cairo: 30 });
  const body = { customer: { name: 'Synthetic Buyer', email: 'test@example.invalid', phone: '01000000000' }, shipping: { country: 'EG', city: 'Cairo', address: 'Synthetic test address' },
    items: [{ productId: product.id, quantity: 1, unitPriceEgp: 100 }], expectedTotalEgp: 130, paymentMethod: 'CASH_ON_DELIVERY' };
  const key = randomUUID(), result = await service.submit(customer.id, key, body);
  expect(result.confirmed).toBe(true); expect(result.order.shippingEgp).toBe(30);
  await settings.saveShipping(admin.id, shipping(50));
  expect((await service.submit(customer.id, key, body)).order.id).toBe(result.order.id);
  const before = await database.client.orders.count();
  await expect(service.submit(customer.id, randomUUID(), body)).rejects.toThrow();
  expect(await database.client.orders.count()).toBe(before);
  expect((await database.client.products.findUnique({ where: { id: product.id } })).stock_quantity).toBe(2);
});

it('uses delivery prices saved through admin immediately at checkout and synchronizes color/type inventory and admin orders', async () => {
  const { createCartRepository } = require('../../src/repositories/cart.repository');
  const carts = createCartRepository(() => database.client);
  const storePolicy = { enabled: true, origin: 'http://store.test', shippingRates: {} };
  const application = userId => createApp({ environment: 'test', authSettings: {}, logger: { error: () => {} }, cartRepository: carts,
    orders: { repository: orders, policy: storePolicy, authenticate: () => ({ userId }), settingsRepository: settings, pushEnabled: false } });
  const administration = application(admin.id), storefront = application(customer.id);
  const item = await database.client.products.create({ data: { name: 'Synthetic synchronized set', name_ar: 'طقم تجريبي', slug: randomUUID(), price_egp: 100, stock_quantity: 6 } });
  const variants = await Promise.all(['Black / Single', 'Black / Double', 'Gold / Single'].map((title, i) => database.client.product_variants.create({ data: {
    product_id: item.id, source_id: randomUUID(), title, title_ar: title, price_egp: i === 1 ? 150 : 100, options: JSON.stringify(title.split(' / ')), is_available: true, stock_quantity: 2,
  } })));
  await carts.add({ userId: customer.id, productId: item.id, variantId: variants[1].id, quantity: 1 });
  const save = fee => request(administration).post('/admin/delivery').set('Host', 'store.test').set('Origin', storePolicy.origin).type('form').send({ configuration: JSON.stringify(shipping(fee)) });
  await save(47).expect(303);
  const saved = await request(administration).get('/admin/delivery?saved=1').expect(200);
  expect(saved.text).toContain('Checkout now uses these prices.');
  expect(saved.text).toContain('form="delivery-settings-form"'); expect(saved.text).toContain('Apply language');
  const checkout = await request(storefront).get('/checkout').expect(200);
  expect(checkout.text).toContain('data-fee="47"'); expect(checkout.text).toContain(`data-variant-id="${variants[1].id}"`);
  await save(63).expect(303);
  const refreshed = await request(storefront).get('/checkout').expect(200);
  expect(refreshed.text).toContain('data-fee="63"');
  const input = { customer: { name: 'Synthetic Buyer', email: 'test@example.invalid', phone: '01000000000' }, shipping: { country: 'EG', city: 'Cairo', address: 'Synthetic test address' },
    items: [{ productId: item.id, variantId: variants[1].id, quantity: 1, unitPriceEgp: 150 }], expectedTotalEgp: 197, paymentMethod: 'CASH_ON_DELIVERY' };
  const key = randomUUID();
  const submit = body => request(storefront).post('/api/orders').set('Host', 'store.test').set('Origin', storePolicy.origin).set('Idempotency-Key', key).send(body);
  await submit(input).expect(409);
  expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(6);
  const response = await submit({ ...input, expectedTotalEgp: 213 }).expect(200);
  expect(response.body.confirmed).toBe(true); expect(response.body.order.shippingEgp).toBe(63);
  const stocks = await database.client.product_variants.findMany({ where: { product_id: item.id } });
  expect(stocks.find(row => row.id === variants[1].id).stock_quantity).toBe(1);
  expect(stocks.filter(row => row.id !== variants[1].id).map(row => row.stock_quantity)).toEqual([2, 2]);
  expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(5);
  expect((await carts.get({ userId: customer.id })).cart_items.some(row => row.product_id === item.id)).toBe(false);
  const dashboard = await request(administration).get('/admin/orders').expect(200);
  expect(dashboard.text).toContain(response.body.order.reference);
  await submit({ ...input, expectedTotalEgp: 213 }).expect(200);
  expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(5);
});

it('distinguishes delivery storage failure from intentionally unconfigured delivery', async () => {
  const application = repository => createApp({ environment: 'test', authSettings: {}, logger: { error: () => {} }, orders: {
    repository, policy: { enabled: true, origin: 'http://store.test', shippingRates: {} }, authenticate: () => ({ userId: customer.id }) } });
  const missing = await request(application({ ...orders, shippingRates: async () => ({ rates: {}, labels: {} }) })).get('/checkout').expect(503);
  expect(missing.text).toContain('Delivery is currently unavailable. Please contact us.'); expect(missing.text).not.toContain('href="/admin/delivery"');
  const unavailable = await request(application({ ...orders, shippingRates: async () => { throw new Error('private database error'); } })).get('/checkout').expect(503);
  expect(unavailable.text).toContain('Delivery is temporarily unavailable. Please try again.'); expect(unavailable.text).not.toContain('private database error');
});

it('reconciles product totals from known variant quantities with mandatory backup and no variant changes', async () => {
  const { reconcileInventory } = require('../../scripts/database/reconcile-inventory');
  const item = await database.client.products.create({ data: { name: 'Synthetic inventory reconciliation', name_ar: 'مخزون تجريبي', slug: randomUUID(), price_egp: 100, stock_quantity: 99 } });
  await database.client.product_variants.createMany({ data: [2, 3].map(stock_quantity => ({ product_id: item.id, source_id: randomUUID(), title: 'Synthetic variant', price_egp: 100, is_available: true, stock_quantity })) });
  const preview = await reconcileInventory(database.client);
  expect(preview.find(row => row.id === item.id)).toEqual({ id: item.id, before: 99, after: 5 });
  expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(99);
  await expect(reconcileInventory(database.client, { apply: true, backup: async () => { throw new Error('Synthetic backup failure'); } })).rejects.toThrow();
  expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(99);
  const backup = vi.fn(async () => {});
  await reconcileInventory(database.client, { apply: true, backup });
  expect(backup).toHaveBeenCalled();
  expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(5);
  expect((await database.client.product_variants.findMany({ where: { product_id: item.id }, orderBy: { stock_quantity: 'asc' } })).map(row => row.stock_quantity)).toEqual([2, 3]);
  expect((await reconcileInventory(database.client)).some(row => row.id === item.id)).toBe(false);
});
it('queues only consenting device owners, deduplicates retries, and rechecks consent before delivery', async () => {
  const input = { requestKey: randomUUID(), audience: 'ALL', message };
  expect((await settings.audienceCounts()).ALL).toBe(1);
  const saved = await settings.queueCampaign(admin.id, input);
  expect(saved.count).toBe(1);
  expect((await settings.queueCampaign(admin.id, input)).count).toBe(1);
  expect((await settings.queueCampaign(admin.id, { ...input, requestKey: input.requestKey.toUpperCase() })).count).toBe(1);
  expect(await database.client.notification_outbox.count({ where: { event_type: 'ADMIN_CAMPAIGN' } })).toBe(1);
  await expect(settings.queueCampaign(admin.id, { ...input, message: { ...message, bodyEn: 'Different message' } })).rejects.toThrow('CAMPAIGN_KEY_CONFLICT');
  const provider = { enabled: true, send: vi.fn(async () => ({ skipped: false, messageId: 'synthetic-provider-id' })) };
  await database.client.notification_preferences.update({ where: { user_id: customer.id }, data: { marketing_enabled: false } });
  const worker = createNotificationWorker({ clientProvider: () => database.client, provider, logger: { error: () => {} } });
  for (let i = 0; i < 4 && await worker.processOne(); i++);
  expect(provider.send).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ADMIN_CAMPAIGN' }));
  const attempt = await database.client.notification_attempts.findFirst({ where: { outbox: { event_type: 'ADMIN_CAMPAIGN' } } });
  expect(attempt.status).toBe('SKIPPED');
  await database.client.notification_preferences.update({ where: { user_id: customer.id }, data: { marketing_enabled: true } });
  provider.send.mockClear();
  await settings.queueCampaign(admin.id, { ...input, requestKey: randomUUID() });
  await worker.processOne();
  expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ADMIN_CAMPAIGN', payload: expect.objectContaining({ message }) }));
});
it('saves event templates, honors the disabled switch and sends custom text with stable provider keys', async () => {
  await settings.saveTemplate(admin.id, { eventType: 'ORDER_STATUS', enabled: false, message });
  await database.client.notification_outbox.create({ data: { user_id: customer.id, event_type: 'ORDER_STATUS', dedupe_key: randomUUID(), payload: { reference: 'AS-SYNTHETIC', status: 'CONFIRMED' } } });
  const provider = { enabled: true, send: vi.fn(async () => ({ skipped: false, messageId: 'synthetic-id' })) };
  const worker = createNotificationWorker({ clientProvider: () => database.client, provider, logger: { error: () => {} } });
  await worker.processOne(); expect(provider.send).not.toHaveBeenCalled();
  await settings.saveTemplate(admin.id, { eventType: 'ORDER_STATUS', enabled: true, message });
  const job = await database.client.notification_outbox.create({ data: { user_id: customer.id, event_type: 'ORDER_STATUS', dedupe_key: randomUUID(), payload: { reference: 'AS-SYNTHETIC', status: 'CONFIRMED' } } });
  await worker.processOne();
  expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ deliveryKey: job.id, payload: expect.objectContaining({ message }) }));
});
it('guards admin settings routes and queues a campaign without calling the real provider', async () => {
  await settings.saveShipping(admin.id, { mode: 'CITY', flatFee: 0, zones: [{ city: 'Cairo', cityAr: 'Ø§Ù„Ù‚Ø§Ù‡Ø±Ø©', fee: 25, enabled: true }] });
  const app = createApp({ environment: 'test', authSettings: {}, logger: { error: () => {} }, orders: { repository: orders, policy: { enabled: false, shippingRates: {} },
    authenticate: () => ({ userId: admin.id }), notificationRepository: createNotificationRepository(() => database.client), settingsRepository: settings, pushEnabled: true } });
  const deliveryPage = await request(app).get('/admin/delivery').expect(200);
  expect(deliveryPage.text).toContain('value="Cairo"'); expect(deliveryPage.text).not.toContain('value="Alexandria"');
  const page = await request(app).get('/admin/notifications').expect(200); expect(page.text).toContain('Write a push notification');
  await request(app).post('/admin/delivery').set('Host', 'store.test').set('Origin', 'https://other.invalid').type('form').send({ configuration: JSON.stringify(shipping(20)) }).expect(403);
  await request(app).post('/admin/delivery').set('Host', 'store.test').set('Origin', 'http://store.test').type('form').send({ configuration: JSON.stringify(shipping(25)) }).expect(303);
  await request(app).post('/admin/notifications/campaigns').set('Host', 'store.test').set('Origin', 'http://store.test').type('form').send({ configuration: JSON.stringify({ requestKey: randomUUID(), audience: 'CUSTOMERS_WITH_ORDERS', message }) }).expect(303);
  const forbidden = createApp({ environment: 'test', authSettings: {}, logger: { error: () => {} }, orders: { repository: orders, policy: { enabled: false, shippingRates: {} }, authenticate: () => ({ userId: customer.id }), settingsRepository: settings, pushEnabled: true } });
  await request(forbidden).get('/admin/delivery').expect(403);
  await request(forbidden).post('/admin/notifications/campaigns').set('Host', 'store.test').set('Origin', 'http://store.test').type('form').send({ configuration: JSON.stringify({ requestKey: randomUUID(), audience: 'ALL', message }) }).expect(403);
});
