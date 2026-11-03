const { test, expect } = require('@playwright/test');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const { startOrderDatabase } = require('../helpers/order-database');
const { createOrderRepository } = require('../../src/repositories/order.repository');
const { createApp } = require('../../src/app');
let database; let repository; let server; let checkoutOrigin; let admin; let verificationUnavailable = false;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(120000);
  database = await startOrderDatabase(); repository = createOrderRepository(() => database.client);
  admin = await database.client.users.create({ data: { name: 'Synthetic browser account', email: `${randomUUID()}@example.invalid`, role: 'admin' } });
  let handler;
  server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  checkoutOrigin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ environment: 'test', logger: { error: () => {} }, whatsappSettings: {}, mediaSettings: {}, orders: {
    // This identity adapter exists only in this loopback test process, never in src/server.js.
    authenticate: async () => ({ userId: admin.id }),
    repository: { ...repository, getAdminOrder: async id => { if (verificationUnavailable) throw new Error('synthetic unavailable'); return repository.getAdminOrder(id); } },
    policy: { enabled: true, origin: checkoutOrigin, shippingRates: { Cairo: 25 } },
  } });
});
test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await database?.stop();
});
async function fillOrder(page) {
  const item = await database.client.products.create({ data: { name: `Synthetic browser ${randomUUID()}`, name_ar: 'Test', slug: randomUUID(), price_egp: 100, stock_quantity: 5 } });
  await page.goto(`${checkoutOrigin}/checkout`);
  await page.locator(`[data-product-id="${item.id}"]`).fill('1');
  await page.getByLabel('Full name').fill('Synthetic Browser Buyer');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Phone', { exact: true }).fill('01000000000');
  await page.getByLabel('Delivery address').fill('Synthetic browser address');
  return item;
}
test('desktop checkout confirms only a stored order visible in the protected dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const item = await fillOrder(page);
  await expect(page.getByRole('button', { name: 'Start a new order' })).toBeHidden();
  await page.getByRole('button', { name: 'Submit order', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Order Confirmed');
  const stored = await database.client.orders.findFirst({ where: { order_items: { some: { product_id: item.id } } } });
  expect(stored).toBeTruthy(); expect(stored.payment_status).toBe('UNPAID');
  await page.screenshot({ path: 'test-results/checkout-confirmed-desktop.png', fullPage: true });
  await page.goto(`${checkoutOrigin}/admin/orders`);
  await expect(page.getByRole('link', { name: stored.order_number })).toBeVisible();
  await page.screenshot({ path: 'test-results/orders-admin-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('mobile verification failure stays pending and recovers after refresh without duplicating stock changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Synthetic storage denied'); } }); });
  const item = await fillOrder(page);
  await page.screenshot({ path: 'test-results/checkout-mobile.png', fullPage: true });
  verificationUnavailable = true;
  try {
    await page.getByRole('button', { name: 'Submit order', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('pending verification');
    await expect(page.locator('#checkout-result')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Start a new order' })).toBeHidden();
    expect(await database.client.orders.count({ where: { order_items: { some: { product_id: item.id } } } })).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/checkout-pending-mobile.png', fullPage: true });
  } finally { verificationUnavailable = false; }
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Order Confirmed');
  expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(4);
  await page.goto(`${checkoutOrigin}/admin`);
  await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/orders-admin-mobile.png', fullPage: true });
});
test('lost network response after commit shows uncertainty and reconciles the original order', async ({ page }) => {
  const item = await fillOrder(page);
  await page.route(`${checkoutOrigin}/api/orders`, async route => { await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Submit order', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('may have been saved');
  await expect(page.locator('#checkout-result')).toBeHidden();
  await page.getByRole('button', { name: 'Check order status' }).click();
  await expect(page.getByRole('status')).toHaveText('Order Confirmed');
  expect(await database.client.orders.count({ where: { order_items: { some: { product_id: item.id } } } })).toBe(1);
  expect((await database.client.products.findUnique({ where: { id: item.id } })).stock_quantity).toBe(4);
});
