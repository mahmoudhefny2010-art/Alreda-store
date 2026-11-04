const { test, expect } = require('@playwright/test');
const { createServer } = require('node:http');
const { createApp } = require('../../src/app');
const { randomUUID } = require('node:crypto');

let server;
let baseOrigin;
const userId = randomUUID();
const itemId = randomUUID();
const sessionToken = 'synthetic-browser-session-token-0123456789ab';

test.beforeAll(async () => {
  const repository = {
    principal: async id => ({ id, role: 'customer', user_roles: [], admin_permissions: [] }),
    products: async () => [{ id: itemId, name: 'Synthetic product', name_ar: 'منتج', price_egp: 100, sale_price_egp: null, stock_quantity: 5 }],
    latestCustomerOrder: async () => ({
      customer_name: 'Saved Synthetic Buyer',
      customer_phone: '+201012345678',
      address_snapshot: JSON.stringify({ email: 'saved@example.invalid', address: 'Saved test address', city: 'Cairo', postalCode: '12345' }),
    }),
    shippingRates: async rates => ({ rates }),
    storeSettings: () => ({}),
  };
  const app = createApp({
    environment: 'test',
    logger: { error: () => {} },
    whatsappSettings: {},
    mediaSettings: {},
    authSettings: {},
    authRepository: { findSession: async () => ({ users: { id: userId, name: 'Synthetic Buyer', email: 'buyer@example.invalid', role: 'customer', user_roles: [] } }) },
    cartRepository: { get: async () => null },
    wishlistRepository: { listIds: async () => [] },
    orders: {
      repository,
      authenticate: async () => ({ userId }),
      policy: { enabled: true, origin: 'http://127.0.0.1', shippingRates: { Cairo: 25 } },
    },
  });
  server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseOrigin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test('checkout validates customer name and Egyptian mobile number before submission', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: 'alreda_session', value: sessionToken, url: baseOrigin }]);
  await page.goto(`${baseOrigin}/checkout`);
  const requests = [];
  page.on('request', request => { if (request.url().endsWith('/api/orders')) requests.push(request); });

  const name = page.getByLabel('Full name');
  const phone = page.getByLabel('Phone', { exact: true });
  await expect(name).toHaveValue('Saved Synthetic Buyer');
  await expect(page.getByLabel('Email')).toHaveValue('saved@example.invalid');
  await expect(phone).toHaveValue('+201012345678');
  await expect(page.getByLabel('Delivery address')).toHaveValue('Saved test address');
  await expect(page.getByLabel('City')).toHaveValue('Cairo');
  await expect(page.getByLabel('Postal code (optional)')).toHaveValue('12345');
  await name.fill('A');
  await phone.fill('12345');
  expect(await name.evaluate(input => input.checkValidity())).toBe(false);
  expect(await phone.evaluate(input => input.checkValidity())).toBe(false);
  await page.getByRole('button', { name: 'Submit order', exact: true }).click();
  await expect(name).toBeFocused();
  expect(requests).toHaveLength(0);

  await name.fill('Synthetic Buyer');
  await phone.fill('+201012345678');
  expect(await name.evaluate(input => input.checkValidity())).toBe(true);
  expect(await phone.evaluate(input => input.checkValidity())).toBe(true);
});

test('checkout allows retry after a confirmed validation failure and finishes a successful order', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: 'alreda_session', value: sessionToken, url: baseOrigin }]);
  await page.goto(`${baseOrigin}/checkout`);
  await page.getByLabel('Full name').fill('Synthetic Buyer');
  await page.getByLabel('Phone', { exact: true }).fill('01012345678');
  await page.getByLabel('Delivery address').fill('Synthetic test address');
  await page.locator('[data-product-id]').fill('1');

  const keys = [];
  await page.route('**/api/orders', async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ confirmed: false, code: 'PRICE_CHANGED' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'confirmed',
        confirmed: true,
        order: {
          reference: 'AS-SYNTHETIC',
          paymentMethod: 'CASH_ON_DELIVERY',
          paymentStatus: 'UNPAID',
          items: [{ product_name: 'Synthetic product', quantity: 1, unit_price_egp: 100 }],
          subtotalEgp: 100,
          shippingEgp: 25,
          totalEgp: 125,
        },
      }),
    });
  });

  await page.getByRole('button', { name: 'Submit order', exact: true }).click();
  await expect(page.locator('#checkout-status')).toHaveText('The price or total changed. Refresh checkout, review the updated total and submit again.');
  await expect(page.locator('#check-order')).toBeHidden();
  await page.getByRole('button', { name: 'Submit order', exact: true }).click();
  await expect(page.locator('#checkout-status')).toHaveText('Order Confirmed');
  await expect(page.locator('#checkout-result')).toContainText('AS-SYNTHETIC');
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
});
