const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { startOrderDatabase } = require('../helpers/order-database');
const { createOrderRepository } = require('../../src/repositories/order.repository');
const { createOrderService } = require('../../src/services/order.service');
const { createApp } = require('../../src/app');
const { OrderError } = require('../../src/validators/order.validator');
const { createNotificationRepository } = require('../../src/repositories/notification.repository');
const { createCustomerAuthRepository } = require('../../src/repositories/customer-auth.repository');
const { createCartRepository } = require('../../src/repositories/cart.repository');
const policy = { enabled: true, origin: 'http://localhost', shippingRates: { Cairo: 25 } };
const logger = { error: vi.fn() };
let database; let repository; let customer; let admin; let stranger;
function service(options = {}) { return createOrderService({ repository, policy, logger, ...options }); }
async function product(stock = 5, price = 100) {
  return database.client.products.create({ data: { name: 'Synthetic test product', name_ar: 'Test', slug: randomUUID(), price_egp: price, stock_quantity: stock } });
}
function body(item, quantity = 1) {
  return { customer: { name: 'Synthetic Buyer', email: 'synthetic@example.invalid', phone: '01000000000' }, shipping: { country: 'EG', city: 'Cairo', address: 'Synthetic test address' },
    items: [{ productId: item.id, quantity, unitPriceEgp: item.price_egp }], expectedTotalEgp: item.price_egp * quantity + 25, paymentMethod: 'CASH_ON_DELIVERY' };
}
function app(userId, options = {}) {
  return createApp({ environment: 'test', logger, whatsappSettings: {}, mediaSettings: {}, orders: { repository, policy, authenticate: async () => userId ? { userId } : null, ...options } });
}
function post(application, key, payload) { return request(application).post('/api/orders').set('Origin', policy.origin).set('Idempotency-Key', key).send(payload); }
beforeAll(async () => {
  database = await startOrderDatabase(); repository = createOrderRepository(() => database.client);
  [customer, admin, stranger] = await Promise.all(['customer', 'admin', 'customer'].map(role => database.client.users.create({ data: { name: 'Synthetic account', email: `${randomUUID()}@example.invalid`, role } })));
}, 120000);
afterAll(async () => { await database?.stop(); }, 30000);

describe('durable PostgreSQL order workflow', () => {
  it('persists the optional delivery pin, verifies retries and displays its map link in admin', async () => {
    const item = await product(5, 100), key = randomUUID();
    const location = { latitude: 30.0444, longitude: 31.2357, accuracyM: 12.5 };
    const input = { ...body(item), shipping: { ...body(item).shipping, location } };
    const created = await service().submit(customer.id, key, input);
    expect(created.confirmed).toBe(true); expect(created.order.shipping.location).toEqual(location);
    const stored = await repository.getAdminOrder(created.order.id);
    expect(JSON.parse(stored.address_snapshot).location).toEqual(location);
    expect((await service().submit(customer.id, key, input)).order.id).toBe(created.order.id);
    const dashboard = await request(app(admin.id)).get(`/admin/orders/${created.order.id}`).expect(200);
    expect(dashboard.text).toContain('https://www.google.com/maps?q=30.0444,31.2357');
    expect(dashboard.text).toContain('Synthetic test address');
    await expect(service().submit(customer.id, key, { ...input, shipping: { ...input.shipping, location: { ...location, latitude: 31 } } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(4);
  });
  it('rejects malformed or out-of-range delivery coordinates before saving or changing stock', async () => {
    const item = await product();
    for (const location of [{ latitude: 91, longitude: 31 }, { latitude: 30, longitude: -181 }, { latitude: '30', longitude: 31 }, { latitude: 30, longitude: 31, accuracyM: -1 }, { latitude: 30, longitude: 31, mapUrl: 'javascript:invalid' }]) {
      await expect(service().submit(customer.id, randomUUID(), { ...body(item), shipping: { ...body(item).shipping, location } })).rejects.toMatchObject({ code: 'INVALID_ORDER' });
    }
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(5);
  });
  it('requires the single persistent variant ID so its inventory cannot be bypassed', async () => {
    const item = await product(3, 100);
    const variant = await database.client.product_variants.create({ data: { product_id: item.id, source_id: randomUUID(), title: 'Default Title', price_egp: 125, stock_quantity: 3, is_available: true } });
    await expect(service().submit(customer.id, randomUUID(), body(item))).rejects.toMatchObject({ code: 'PRODUCT_OPTIONS_REQUIRED' });
    const offered = (await repository.products()).find(row => row.id === item.id);
    expect(offered).toMatchObject({ variant_id: variant.id, sale_price_egp: 125 });
    const payload = { ...body(item), items: [{ productId: item.id, variantId: variant.id, quantity: 1, unitPriceEgp: 125 }], expectedTotalEgp: 150 };
    const result = await service().submit(customer.id, randomUUID(), payload);
    expect(result.confirmed).toBe(true);
    expect((await database.client.product_variants.findUnique({ where: { id: variant.id } })).stock_quantity).toBe(2);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(2);
  });
  it('merges guest selections independently and removes only the requested color', async () => {
    const item = await product(10, 100);
    const owner = await database.client.users.create({ data: { name: 'Synthetic cart owner', email: `${randomUUID()}@example.invalid`, role: 'customer' } });
    const variants = await Promise.all(['Black', 'Silver'].map(title => database.client.product_variants.create({ data: {
      product_id: item.id, source_id: randomUUID(), title, price_egp: 100, options: JSON.stringify([title]), is_available: true, stock_quantity: 5,
    } })));
    const carts = createCartRepository(() => database.client), guestToken = carts.newGuestToken();
    await carts.add({ guestToken, productId: item.id, variantId: variants[0].id, quantity: 2 });
    await carts.add({ guestToken, productId: item.id, variantId: variants[1].id, quantity: 1 });
    await carts.add({ userId: owner.id, productId: item.id, variantId: variants[0].id, quantity: 1 });
    await carts.mergeGuest(owner.id, guestToken);
    const merged = await carts.get({ userId: owner.id });
    expect(merged.cart_items).toHaveLength(2);
    expect(merged.cart_items.find(line => line.variant_id === variants[0].id).quantity).toBe(3);
    const remaining = await carts.remove({ userId: owner.id, productId: item.id, variantId: variants[1].id });
    expect(remaining.cart_items).toHaveLength(1);
    expect(remaining.cart_items[0].variant_id).toBe(variants[0].id);
  });
  it('persists different color selections, verifies the order, prevents duplicate checkout and restores variant stock on cancellation', async () => {
    const item = await product(10, 100);
    const variants = await Promise.all(['Black', 'Silver'].map((title, i) => database.client.product_variants.create({ data: {
      product_id: item.id, source_id: randomUUID(), title, title_ar: title, price_egp: i ? 150 : 100, options: JSON.stringify([title]), is_available: true, stock_quantity: 5,
    } })));
    const carts = createCartRepository(() => database.client);
    const other = await product(2, 100);
    await expect(carts.add({ userId: customer.id, productId: other.id, variantId: variants[0].id, quantity: 1 })).rejects.toThrow('PRODUCT_UNAVAILABLE');
    await expect(carts.add({ userId: customer.id, productId: item.id, quantity: 1 })).rejects.toThrow('PRODUCT_OPTIONS_REQUIRED');
    await carts.add({ userId: customer.id, productId: item.id, variantId: variants[0].id, quantity: 2 });
    const cart = await carts.add({ userId: customer.id, productId: item.id, variantId: variants[1].id, quantity: 1 });
    expect(cart.cart_items.filter(line => line.product_id === item.id)).toHaveLength(2);
    expect(cart.cart_items.find(line => line.variant_id === variants[1].id).products.sale_price_egp).toBe(150);
    await expect(carts.add({ userId: customer.id, productId: item.id, variantId: variants[0].id, quantity: 4 })).rejects.toThrow('INSUFFICIENT_INVENTORY');
    const key = randomUUID();
    const payload = { ...body(item, 1), items: variants.map((variant, i) => ({ productId: item.id, variantId: variant.id, quantity: i === 0 ? 2 : 1, unitPriceEgp: i ? 150 : 100 })), expectedTotalEgp: 375 };
    const service = createOrderService({ repository, policy, logger });
    await expect(service.submit(customer.id, randomUUID(), { ...payload, items: payload.items.map(line => ({ ...line, unitPriceEgp: 100 })) })).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    const result = await service.submit(customer.id, key, payload);
    expect(result.confirmed).toBe(true);
    expect(result.order.items.map(line => line.variant_id).sort()).toEqual(variants.map(variant => variant.id).sort());
    expect((await service.submit(customer.id, key, payload)).order.reference).toBe(result.order.reference);
    expect((await database.client.product_variants.findUnique({ where: { id: variants[0].id } })).stock_quantity).toBe(3);
    expect((await database.client.product_variants.findUnique({ where: { id: variants[1].id } })).stock_quantity).toBe(4);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(7);
    await repository.updateStatus(result.order.id, 'CANCELLED', admin.id);
    expect((await database.client.product_variants.findUnique({ where: { id: variants[0].id } })).stock_quantity).toBe(5);
    expect((await database.client.product_variants.findUnique({ where: { id: variants[1].id } })).stock_quantity).toBe(5);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(10);
    await repository.updateStatus(result.order.id, 'CANCELLED', admin.id);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(10);
    expect((await carts.get({ userId: customer.id })).cart_items.filter(line => line.product_id === item.id)).toHaveLength(0);
  });
  it('persists an authenticated cart, prefills checkout and verifies its order through admin retrieval', async () => {
    const auth = createCustomerAuthRepository(() => database.client);
    const carts = createCartRepository(() => database.client);
    const session = await auth.createSession(customer.id);
    const application = createApp({ environment: 'test', logger, whatsappSettings: {}, mediaSettings: {}, authRepository: auth, cartRepository: carts, orders: { repository, policy } });
    const cookie = `alreda_session=${session.token}`;
    const item = await product(5, 110);
    const cart = await request(application).post('/api/cart/items').set('Host', 'localhost').set('Origin', policy.origin).set('Cookie', cookie).send({ productId: item.id, quantity: 2 }).expect(200);
    expect(cart.body.cart_items[0]).toMatchObject({ product_id: item.id, quantity: 2 });
    const checkout = await request(application).get('/checkout').set('Cookie', cookie).expect(200);
    expect(checkout.text).toMatch(new RegExp(`value="2"[^>]*data-product-id="${item.id}"`));
    const response = await post(application, randomUUID(), body(item, 2)).set('Cookie', cookie).expect(200);
    expect(response.body.confirmed).toBe(true);
    expect(await repository.getAdminOrder(response.body.order.id)).toMatchObject({ total_egp: 245 });
    expect((await carts.get({ userId: customer.id })).cart_items).toHaveLength(0);
    const unknown = await product(null);
    await request(application).post('/api/cart/items').set('Host', 'localhost').set('Origin', policy.origin).set('Cookie', cookie).send({ productId: unknown.id, quantity: 1 }).expect(409);
  });
  it('commits the complete order and retrieves it through the real admin projection/dashboard', async () => {
    const item = await product(); const key = randomUUID();
    const response = await post(app(customer.id), key, body(item, 2)).expect(200);
    expect(response.body.confirmed).toBe(true);
    expect(response.body.order.totalEgp).toBe(225);
    expect(response.body.order.paymentStatus).toBe('UNPAID');
    const stored = await repository.getAdminOrder(response.body.order.id);
    expect(stored.order_items[0].quantity).toBe(2);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(3);
    const dashboard = await request(app(admin.id)).get('/admin/orders').expect(200);
    expect(dashboard.text).toContain(stored.order_number);
    expect(dashboard.text).toContain('Synthetic Buyer');
    expect(dashboard.text).toContain('Cash on delivery');
    const overview = await request(app(admin.id)).get('/admin').expect(200);
    expect(overview.text).toContain(stored.order_number);
    await request(app(admin.id)).get(`/admin/orders/${stored.id}`).expect(200);
  });

  it('lets an authenticated admin update order status when a local proxy rewrites the origin host', async () => {
    const item = await product();
    const created = await service().submit(customer.id, randomUUID(), body(item));
    const auth = createCustomerAuthRepository(() => database.client);
    const session = await auth.createSession(admin.id);
    const application = createApp({ environment: 'test', logger, authRepository: auth, orders: { repository, policy } });
    const cookie = `alreda_session=${session.token}`;
    const detail = await request(application).get(`/admin/orders/${created.order.id}`).set('Cookie', cookie).expect(200);
    const csrfToken = detail.text.match(/name="_csrf" value="([a-f0-9]{64})"/i)?.[1];
    expect(csrfToken).toBeTruthy();
    const response = await request(application).post(`/admin/orders/${created.order.id}/status`)
      .set('Cookie', cookie).set('Host', '127.0.0.1:666').set('Origin', 'http://localhost:666')
      .set('Sec-Fetch-Site', 'same-origin').type('form').send({ status: 'CONFIRMED', _csrf: csrfToken });
    expect(response.status, response.text).toBe(303);
    expect(response.headers.location).toBe(`/admin/orders/${created.order.id}`);
    expect((await repository.getAdminOrder(created.order.id)).status).toBe('CONFIRMED');
  });

  it('cancels once, restores inventory atomically, and serves notification settings from PostgreSQL to admins', async () => {
    const item = await product(4, 90); const result = await service().submit(customer.id, randomUUID(), body(item, 2));
    expect(result.confirmed).toBe(true);
    await repository.updateStatus(result.order.id, 'CANCELLED', admin.id);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(4);
    await expect(repository.updateStatus(result.order.id, 'CANCELLED', admin.id)).resolves.toMatchObject({ status: 'CANCELLED' });
    const adminApp = app(admin.id, { notificationRepository: createNotificationRepository(() => database.client) });
    const notifications = await request(adminApp).get('/admin/notifications').expect(200);
    expect(notifications.text).toContain('Abandoned cart reminders');
    expect(notifications.text).toContain('120');
    expect(await database.client.notification_outbox.count({ where: { order_id: result.order.id, event_type: 'ORDER_STATUS' } })).toBe(1);
  });

  it('enforces the shared authentication rate limit in PostgreSQL and stops incrementing at the cap', async () => {
    const authRepository = createCustomerAuthRepository(() => database.client);
    const keyHash = 'e'.repeat(64); const windowStart = new Date('2026-11-02T12:00:00.000Z');
    await expect(authRepository.consumeAuthRateLimit(keyHash, windowStart, 2)).resolves.toBe(true);
    await expect(authRepository.consumeAuthRateLimit(keyHash, windowStart, 2)).resolves.toBe(true);
    await expect(authRepository.consumeAuthRateLimit(keyHash, windowStart, 2)).resolves.toBe(false);
    await expect(authRepository.consumeAuthRateLimit(keyHash, windowStart, 2)).resolves.toBe(false);
    await expect(database.client.auth_rate_limits.findUnique({ where: { key_hash_window_start: { key_hash: keyHash, window_start: windowStart } } })).resolves.toMatchObject({ count: 2 });
  });
  it('rolls back stock and every related row when item persistence fails in PostgreSQL', async () => {
    const item = await product(); const key = randomUUID(); const input = body(item);
    await database.client.products.update({ where: { id: item.id }, data: { name: 'Rollback integration fault' } });
    await database.sql.query(`CREATE FUNCTION synthetic_item_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.product_name = 'Rollback integration fault' THEN RAISE EXCEPTION 'Synthetic item insert fault'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER synthetic_item_failure BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION synthetic_item_failure();`);
    const count = await database.client.orders.count();
    const result = await service().submit(customer.id, key, input);
    expect(result.state).toBe('pending_verification');
    expect(await repository.findRequest(customer.id, key)).toBeNull();
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(5);
    expect(await database.client.orders.count()).toBe(count);
    expect(await database.client.order_items.count({ where: { product_id: item.id } })).toBe(0);
  });
  it('prevents double-clicks/concurrent retries and rejects a changed payload on the same key', async () => {
    const item = await product(); const key = randomUUID(); const input = body(item);
    const results = await Promise.all(Array.from({ length: 4 }, () => service().submit(customer.id, key, input)));
    expect(results.every(value => value.confirmed)).toBe(true);
    expect(new Set(results.map(value => value.order.id)).size).toBe(1);
    expect(await database.client.order_requests.count({ where: { user_id: customer.id, request_key: key } })).toBe(1);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(4);
    await expect(service().submit(customer.id, key, { ...input, notes: 'Changed request' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('validates required customer input, quantities, price, shipping and payment on the server', async () => {
    const item = await product(); const input = body(item);
    for (const changes of [{ customer: {} }, { customer: { ...input.customer, email: 'invalid' } }, { items: [{ ...input.items[0], quantity: 0 }] }, { paymentStatus: 'PAID' }, { userId: admin.id }]) {
      await post(app(customer.id), randomUUID(), { ...input, ...changes }).expect(400);
    }
    await post(app(customer.id), randomUUID(), { ...input, shipping: { ...input.shipping, city: 'Unknown city' } }).expect(400);
    await post(app(customer.id), randomUUID(), { ...input, paymentMethod: 'ONLINE' }).expect(400);
    await post(app(customer.id), randomUUID(), { ...input, expectedTotalEgp: 1 }).expect(409);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(5);
  });
  it('rejects insufficient/unconfigured inventory and cannot oversell under concurrency', async () => {
    const unknown = await product(null); const scarce = await product(1);
    await expect(service().submit(customer.id, randomUUID(), body(unknown))).rejects.toMatchObject({ code: 'INSUFFICIENT_INVENTORY' });
    const outcomes = await Promise.allSettled([service().submit(customer.id, randomUUID(), body(scarce)), service().submit(stranger.id, randomUUID(), body(scarce))]);
    expect(outcomes.filter(value => value.status === 'fulfilled' && value.value.confirmed)).toHaveLength(1);
    expect(outcomes.filter(value => value.status === 'rejected' && value.reason.code === 'INSUFFICIENT_INVENTORY')).toHaveLength(1);
    expect((await database.client.products.findUnique({ where: { id: scarce.id } })).stock_quantity).toBe(0);
  });
  it('cannot oversell a specific color/type when two customers submit concurrently', async () => {
    const item = await product(2);
    const variants = await Promise.all(['Black / Single', 'Gold / Single'].map(title => database.client.product_variants.create({ data: {
      product_id: item.id, source_id: randomUUID(), title, options: JSON.stringify(title.split(' / ')), price_egp: 100, stock_quantity: 1, is_available: true,
    } })));
    const input = { ...body(item), items: [{ productId: item.id, variantId: variants[0].id, quantity: 1, unitPriceEgp: 100 }] };
    const outcomes = await Promise.allSettled([service().submit(customer.id, randomUUID(), input), service().submit(stranger.id, randomUUID(), input)]);
    expect(outcomes.filter(value => value.status === 'fulfilled' && value.value.confirmed)).toHaveLength(1);
    expect(outcomes.filter(value => value.status === 'rejected' && value.reason.code === 'INSUFFICIENT_INVENTORY')).toHaveLength(1);
    expect((await database.client.product_variants.findUnique({ where: { id: variants[0].id } })).stock_quantity).toBe(0);
    expect((await database.client.product_variants.findUnique({ where: { id: variants[1].id } })).stock_quantity).toBe(1);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(1);
  });
  it('rejects unavailable products, changed unit prices and unmapped product options', async () => {
    const item = await product(); const input = body(item);
    await expect(service().submit(customer.id, randomUUID(), { ...input, items: [{ ...input.items[0], unitPriceEgp: 1 }] })).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    await database.client.products.update({ where: { id: item.id }, data: { is_available: false } });
    await expect(service().submit(customer.id, randomUUID(), input)).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    await database.client.products.update({ where: { id: item.id }, data: { is_available: true } });
    await database.client.product_options.create({ data: { product_id: item.id, option_group: 'Size', name: 'Large', name_ar: 'Test', price_delta_egp: 10 } });
    await expect(service().submit(customer.id, randomUUID(), input)).rejects.toMatchObject({ code: 'PRODUCT_OPTIONS_REQUIRED' });
    expect((await repository.products()).some(value => value.id === item.id)).toBe(false);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(5);
  });
  it('reconciles a timeout after commit and returns the same order on response-loss retry', async () => {
    const item = await product(); const key = randomUUID(); const input = body(item);
    const timeout = { ...repository, create: async args => { await repository.create(args); throw new Error('synthetic socket timeout after COMMIT'); } };
    const first = await service({ repository: timeout }).submit(customer.id, key, input);
    expect(first.confirmed).toBe(true);
    const retry = await service().submit(customer.id, key, input);
    expect(retry.order.id).toBe(first.order.id);
    const recoveryDuringMaintenance = await request(app(customer.id, { policy: { enabled: false } })).get(`/api/orders/requests/${key}`).expect(200);
    expect(recoveryDuringMaintenance.body.order.id).toBe(first.order.id);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(4);
  });
  it('returns pending on failed post-commit admin verification and recovers without another order', async () => {
    const item = await product(); const key = randomUUID(); const input = body(item);
    const unavailable = { ...repository, getAdminOrder: async () => { throw new Error('private database endpoint'); } };
    const response = await post(app(customer.id, { repository: unavailable }), key, input).expect(202);
    expect(response.body.confirmed).toBe(false);
    expect(response.text).not.toContain('private');
    const recovered = await request(app(customer.id)).get(`/api/orders/requests/${key}`).expect(200);
    const retry = await service().submit(customer.id, key, input);
    expect(retry.order.id).toBe(recovered.body.order.id);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(4);
  });
  it('never reports success or blindly creates when preflight reconciliation cannot reach the database', async () => {
    const create = vi.fn();
    const unavailable = { ...repository, create, findRequest: async () => { throw new Error('synthetic connection unavailable'); } };
    const result = await service({ repository: unavailable }).submit(customer.id, randomUUID(), body(await product()));
    expect(result.confirmed).toBe(false); expect(create).not.toHaveBeenCalled();
  });
  it('keeps incomplete post-commit records unconfirmed and treats an unresolved timeout as pending', async () => {
    const item = await product(); const key = randomUUID(); const input = body(item);
    const incomplete = { ...repository, getAdminOrder: async id => ({ ...await repository.getAdminOrder(id), order_items: [] }) };
    expect((await service({ repository: incomplete }).submit(customer.id, key, input)).confirmed).toBe(false);
    const changedSnapshot = { ...repository, getAdminOrder: async id => ({ ...await repository.getAdminOrder(id), customer_name: 'Unexpected changed snapshot' }) };
    expect((await service({ repository: changedSnapshot }).reconcile(customer.id, key)).confirmed).toBe(false);
    const create = vi.fn(async () => { throw new Error('unknown commit outcome'); });
    const ambiguous = { ...repository, create, findRequest: async () => null };
    const unresolved = await service({ repository: ambiguous }).submit(customer.id, randomUUID(), body(await product()));
    expect(unresolved).toMatchObject({ state: 'pending_verification', confirmed: false, retryWithSameKey: true });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('requires verified identity, enforces admin roles/ownership, and rejects cross-origin submissions', async () => {
    const key = randomUUID(); const input = body(await product());
    await post(app(null), key, input).set('X-User-Id', admin.id).expect(401);
    await request(app(customer.id)).get('/admin/orders').expect(403);
    await request(app(null)).get('/admin/orders').expect(401);
    await post(app(customer.id), key, input).set('Origin', 'https://attacker.invalid').expect(403);
    const created = await service().submit(customer.id, key, input);
    const foreign = await request(app(stranger.id)).get(`/api/orders/requests/${key}`).expect(202);
    expect(foreign.text).not.toContain(created.order.reference);
  });
  it('keeps online orders unpaid until verified provider settlement, with amount and replay protection', async () => {
    const item = await product(); const key = randomUUID(); const input = { ...body(item), paymentMethod: 'ONLINE' };
    const paymentProvider = { verifyWebhook: vi.fn(async raw => {
      if (raw.toString() !== 'trusted-event') throw new Error('bad signature');
      return { provider: 'synthetic-provider', eventId: 'synthetic-event', paymentReference: 'synthetic-payment', orderId: created.order.id, amountEgp: 125, currency: 'EGP', status: 'paid' };
    }) };
    const checkout = service({ paymentProvider });
    const created = await checkout.submit(customer.id, key, input);
    expect(created.order.paymentStatus).toBe('UNPAID');
    const application = app(customer.id, { paymentProvider });
    await request(application).post('/api/payments/webhook').set('Content-Type', 'application/json').send('untrusted-event').expect(400);
    expect((await repository.getAdminOrder(created.order.id)).payment_status).toBe('UNPAID');
    await request(application).post('/api/payments/webhook').set('Content-Type', 'application/json').send('trusted-event').expect(200);
    await request(application).post('/api/payments/webhook').set('Content-Type', 'application/json').send('trusted-event').expect(200);
    const verified = await checkout.reconcile(customer.id, key);
    expect(verified.order.paymentStatus).toBe('PAID');
    expect(await database.client.payment_receipts.count({ where: { order_id: created.order.id } })).toBe(1);
    const badProvider = { verifyWebhook: async () => ({ provider: 'synthetic-provider', eventId: randomUUID(), paymentReference: randomUUID(), orderId: created.order.id, amountEgp: 1, currency: 'EGP', status: 'paid' }) };
    await expect(service({ paymentProvider: badProvider }).receivePayment(Buffer.from('valid-signature-wrong-amount'), {})).rejects.toBeInstanceOf(OrderError);
  });
  it('refuses migration rollback once stock/workflow data exists', async () => {
    await expect(database.sql.query(database.down)).rejects.toBeTruthy();
    await database.sql.query('ROLLBACK');
    expect(await database.client.orders.count()).toBeGreaterThan(0);
  });
  it('keeps checkout disabled and admin private when authentication/inventory setup is absent', async () => {
    const locked = createApp({ environment: 'test', logger, whatsappSettings: {}, mediaSettings: {}, orders: { policy: { enabled: false } } });
    await request(locked).get('/checkout').expect(503);
    await request(locked).post('/api/orders').send({}).expect(503).expect({ confirmed: false, code: 'CHECKOUT_UNAVAILABLE' });
    await request(locked).get('/admin/orders').expect(401);
  });
  it('returns a cancelled existing order on retry without showing confirmation or creating a replacement', async () => {
    const item = await product(); const key = randomUUID(); const input = body(item);
    const created = await service().submit(customer.id, key, input);
    await database.client.orders.update({ where: { id: created.order.id }, data: { status: 'CANCELLED' } });
    const retry = await post(app(customer.id), key, input).expect(200);
    expect(retry.body).toMatchObject({ state: 'cancelled', confirmed: false });
    expect(retry.body.order.id).toBe(created.order.id);
    expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(4);
  });
});
