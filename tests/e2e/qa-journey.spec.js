const { test, expect } = require('@playwright/test');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startOrderDatabase } = require('../helpers/order-database');
const { createApp } = require('../../src/app');
const { createCustomerAuthRepository } = require('../../src/repositories/customer-auth.repository');
const { createOrderRepository } = require('../../src/repositories/order.repository');
const { createCartRepository } = require('../../src/repositories/cart.repository');
const { createWishlistRepository } = require('../../src/repositories/wishlist.repository');
const { createAdminManagementRepository } = require('../../src/repositories/admin-management.repository');
const { createStoreSettingsRepository } = require('../../src/repositories/store-settings.repository');
const { disconnectDatabase } = require('../../src/config/prisma');

let database, server, appOrigin, auth, buyer, admin, other, item, variants, settings;
const evidence = { isolatedDatabase: true, authentication: 'Database-persistent session cookies', steps: [], gaps: ['Guest checkout is unavailable', 'Delivery quotation approval is unavailable', 'COD collection marking is unavailable', 'Analytics and Excel export are unavailable'] };
const directory = path.resolve('test-results/qa-audit/journey');
const localLogger = { error: event => evidence.steps.push({ event: event.event || 'server-error', code: event.code || 'UNSPECIFIED' }) };
const timeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('QA_TEARDOWN_TIMEOUT')), ms); timer.unref(); })]);
test.beforeAll(async () => {
  test.setTimeout(120000);
  await fs.mkdir(directory, { recursive: true });
  database = await startOrderDatabase();
  const connection = database.sql.connectionParameters;
  if (!['127.0.0.1', 'localhost'].includes(connection.host)) throw new Error('QA_LOCAL_DATABASE_REQUIRED');
  const local = new URL('postgresql://127.0.0.1');
  local.username = connection.user; local.password = connection.password; local.port = String(connection.port); local.pathname = '/' + connection.database;
  process.env.DATABASE_URL = local.href; process.env.DIRECT_URL = ''; process.env.DATABASE_REQUIRED = 'false';
  for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'ONESIGNAL_APP_ID', 'ONESIGNAL_REST_API_KEY']) process.env[key] = '';
  const db = database.client;
  auth = createCustomerAuthRepository(() => db);
  const orders = createOrderRepository(() => db), carts = createCartRepository(() => db), wishlist = createWishlistRepository(() => db);
  settings = createStoreSettingsRepository(() => db);
  [buyer, admin, other] = await Promise.all(['customer', 'admin', 'customer'].map(role => db.users.create({ data: { name: 'Synthetic QA ' + role, email: `${randomUUID()}@example.invalid`, google_id: randomUUID(), role } })));
  const section = await db.storefront_sections.create({ data: { slug: 'qa-collections', title_en: 'QA collections', title_ar: 'مجموعات الاختبار' } });
  const category = await db.categories.create({ data: { source_id: 'qa-bathroom', slug: 'qa-bathroom', name: 'QA Bathroom', name_ar: 'حمام اختباري', image_url: '', home_section_id: section.id } });
  item = await db.products.create({ data: { source_id: 'qa-bathroom-item', slug: 'qa-bathroom-item', name: 'QA Bathroom Set', name_ar: 'طقم حمام اختباري', price_egp: 400, stock_quantity: 40, category_id: category.id, image_url: '/qa-image/black.svg', description: '<p>Synthetic test product only.</p>', description_ar: '<p>منتج اختباري فقط.</p>' } });
  await db.product_categories.create({ data: { product_id: item.id, category_id: category.id } });
  variants = [];
  for (const [color, type, price] of [['Black', 'Single', 400], ['Black', 'Double', 500], ['Gold', 'Single', 450], ['Gold', 'Double', 600]]) variants.push(await db.product_variants.create({ data: { product_id: item.id, source_id: `qa-${color}-${type}`, title: `${color} / ${type}`, title_ar: `${color} / ${type}`, options: JSON.stringify([color, type]), price_egp: price, stock_quantity: 10, is_available: true, source_image_id: color.toLowerCase() } }));
  await db.catalog_details.create({ data: { product_id: item.id, color_en: 'Black, Gold', color_ar: 'أسود، ذهبي', presentation: { variantEditor: { enabled: true, options: [{ name: 'Color', nameAr: 'اللون' }, { name: 'Type', nameAr: 'النوع' }], ids: variants.map(v => v.id) } } } });
  await Promise.all(['black', 'gold'].map((color, index) => db.product_images.create({ data: { product_id: item.id, source_id: color, secure_url: `https://res.cloudinary.com/pjwlhib7/image/upload/qa/${color}.svg`, display_order: index, alt_text: 'Synthetic ' + color } })));
  await settings.saveShipping(admin.id, { mode: 'CITY', flatFee: 0, zones: [{ city: 'Cairo', cityAr: 'القاهرة', fee: 100, enabled: true }] });
  let application;
  server = createServer((req, res) => {
    if (req.url.startsWith('/qa-image/')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${req.url.includes('gold') ? '#c4a45c' : '#303035'}"/><text x="70" y="310" fill="white" font-size="40">SYNTHETIC QA IMAGE</text></svg>`); return; }
    application(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); appOrigin = `http://127.0.0.1:${server.address().port}`;
  application = createApp({ environment: 'test', logger: localLogger, whatsappSettings: {}, mediaSettings: {}, authSettings: { SESSION_SECRET: 'synthetic-qa-session-secret-over-32-characters' }, authRepository: auth, cartRepository: carts, wishlistRepository: wishlist,
    orders: { repository: orders, policy: { enabled: true, origin: appOrigin, shippingRates: {} }, settingsRepository: settings, instapay: { enabled: false } },
    management: { repository: createAdminManagementRepository(() => db) } });
});
test.afterAll(async () => {
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  await timeout(disconnectDatabase(), 15000);
  await timeout(database?.stop(), 20000);
});
async function signed(context, user) {
  const session = await auth.createSession(user.id);
  await context.addCookies([{ name: 'alreda_session', value: session.token, url: appOrigin, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(() => localStorage.setItem('alreda-welcome-v1', 'seen'));
}
async function snap(page, name) { await page.screenshot({ path: path.join(directory, name + '.png'), fullPage: true }); evidence.steps.push({ step: name, result: 'PASS' }); }

test('real browser customer journey and persisted administrator order lifecycle', async ({ browser, page, context }) => {
  await context.route('https://res.cloudinary.com/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#c4a45c"/><text x="70" y="310" fill="#fff" font-size="40">SYNTHETIC QA IMAGE</text></svg>' }));
  await signed(context, buyer);
  await page.goto(appOrigin);
  await expect(page.locator('.category-card').first()).toBeVisible(); await snap(page, '01-home');
  await page.locator('[data-dialog="search-dialog"]').click(); await page.locator('#collection-search').fill('QA Bathroom');
  await expect(page.locator('#search-results a')).toHaveCount(1); await snap(page, '02-search');
  await page.locator('#search-results a').click(); await expect(page.locator('.product-card')).toHaveCount(1);
  await page.locator('.product-card a[href*="/products/"]').first().click();
  await expect(page.locator('#product-title')).toHaveText('QA Bathroom Set');
  await page.locator('.product-choice').filter({ hasText: 'Gold' }).click(); await page.locator('.product-choice').filter({ hasText: 'Double' }).click();
  await expect(page.locator('[data-variant-price]')).toContainText('600'); await expect(page.locator('#product-main-photo')).toHaveAttribute('src', /gold\.svg/);
  await snap(page, '03-color-type-price-image');
  await page.locator('[data-favorite-toggle]').first().click(); await expect(page.locator('[data-favorite-toggle]').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.wishlist-header-toggle').click(); await expect(page.locator('.wishlist-card')).toHaveCount(1);
  await page.locator('.wishlist-variant').selectOption(variants[3].id); await expect(page.locator('.wishlist-card-price')).toContainText('600');
  await page.locator('.wishlist-add').click(); await expect.poll(() => database.client.cart_items.count({ where: { product_id: item.id, variant_id: variants[3].id } })).toBe(1);
  await snap(page, '04-wishlist-added-to-cart');
  await page.locator('.bag-toggle').click(); await expect(page.locator('.bag-items')).toContainText('QA Bathroom Set'); await snap(page, '05-cart');
  await page.locator('[data-cart-checkout]').click();
  await page.locator('[data-product-id][data-variant-id]').fill('2');
  await page.locator('[name="phone"]').fill('01000000000'); await page.locator('[name="address"]').fill('Synthetic QA Street, building 1, apartment 2');
  await expect(page.locator('[data-checkout-shipping]')).toContainText('100'); await expect(page.locator('#checkout-total')).toContainText('1,300');
  await snap(page, '06-checkout-cod');
  await page.locator('.checkout-submit').click(); await expect(page.locator('#checkout-status')).toHaveText('Order Confirmed'); await snap(page, '07-confirmed');
  const order = await database.client.orders.findFirst({ where: { user_id: buyer.id }, include: { order_items: true } });
  expect(order).toBeTruthy(); expect(order.total_egp).toBe(1300); expect(order.delivery_fee_egp).toBe(100); expect(order.order_items[0].variant_id).toBe(variants[3].id); expect(order.order_items[0].quantity).toBe(2);
  expect((await database.client.product_variants.findUnique({ where: { id: variants[3].id } })).stock_quantity).toBe(8);
  expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(38);
  evidence.persistence = { orderStored: true, orderItemsStored: true, selectedVariantStock: 8, aggregateStock: 38, deliveryFee: 100, total: 1300 };
  const adminContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  await signed(adminContext, admin); const adminPage = await adminContext.newPage();
  try {
    await adminPage.goto(appOrigin + '/admin/orders'); await expect(adminPage.locator('.admin-order-card')).toContainText(order.order_number); await snap(adminPage, '08-admin-list');
    await adminPage.locator('.admin-order-card .button').click(); await expect(adminPage.locator('.order-detail-heading')).toContainText(order.order_number);
    for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
      await adminPage.locator('select[name="status"]').selectOption(status); await adminPage.locator('.order-action-panel').getByRole('button', { name: 'Save status', exact: true }).click();
      await expect.poll(async () => (await database.client.orders.findUnique({ where: { id: order.id } })).status).toBe(status);
    }
    await snap(adminPage, '09-admin-delivered');
    await adminPage.goto(appOrigin + '/admin/delivery'); await adminPage.locator('[data-zone-fee]').fill('77');
    await adminPage.locator('#delivery-settings-form button[type="submit"]').click(); await expect(adminPage.locator('.operations-success')).toContainText('saved'); await snap(adminPage, '10-delivery-saved');
  } finally { await adminContext.close(); }
  await page.goto(appOrigin + '/account/orders/' + order.id); await expect(page.locator('main')).toContainText(order.order_number); await expect(page.locator('main')).toContainText('Delivered'); await snap(page, '11-customer-order-history');
  await page.goto(appOrigin + '/products/' + item.slug); await page.locator('.detail-add').click();
  await page.goto(appOrigin + '/checkout'); await expect(page.locator('[data-checkout-shipping]')).toContainText('77'); await snap(page, '12-updated-checkout-delivery');
  const otherContext = await browser.newContext(); await signed(otherContext, other);
  try {
    const isolated = await otherContext.request.get(appOrigin + '/account/orders/' + order.id); expect(isolated.status()).toBe(404);
    const adminDenied = await otherContext.request.get(appOrigin + '/admin/orders'); expect(adminDenied.status()).toBe(403);
    const ids = await otherContext.request.get(appOrigin + '/api/wishlist/ids'); expect((await ids.json()).ids).toEqual([]);
    evidence.security = { otherCustomerOrderDenied: true, otherCustomerAdminDenied: true, favoritesIsolated: true };
  } finally { await otherContext.close(); }
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(appOrigin + '/products/' + item.slug); await expect(page.locator('#product-title')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await snap(page, '13-mobile-product');
});
