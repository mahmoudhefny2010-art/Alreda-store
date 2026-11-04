const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createAdminOrdersController } = require('../../src/controllers/admin/orders.controller');
const { translate } = require('../../src/config/storefront-i18n');
const { dashboardText } = require('../../src/config/admin-dashboard-i18n');
const { adminText } = require('../../src/config/admin-i18n');
const orders = ['PLACED', 'CONFIRMED', 'DELIVERED', 'CANCELLED'].map((status, index) => ({ id: randomUUID(), order_number: `AS-SYNTHETIC-${index + 1}`, customer_name: `Synthetic Customer ${index + 1}`, customer_phone: '01000000000', status, payment_method: 'CASH_ON_DELIVERY', payment_status: 'UNPAID', created_at: new Date('2026-11-03T10:00:00Z'), subtotal_egp: 1000, delivery_fee_egp: 50, total_egp: 1050, notes: 'Synthetic delivery note', address_snapshot: JSON.stringify({ email: 'synthetic@example.invalid', address: 'Synthetic Street 5', city: 'Cairo', country: 'EG', location: { latitude: 30, longitude: 31 } }), order_items: [{ product_name: 'Bathroom accessories — Black / Double', product_name_ar: 'إكسسوارات الحمام — أسود / مزدوج', quantity: 2, unit_price_egp: 500, line_total_egp: 1000 }] }));
for (const locale of ['en', 'ar']) for (const width of [390, 1440]) {
  test(`admin order filters, cards and detail ${locale} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/assets/**', route => route.fulfill({ path: path.resolve('src/public', new URL(route.request().url()).pathname.slice('/assets/'.length)) }));
    const repository = { listAdminOrders: async (cursor, filters) => orders.filter(order => (!filters.q || order.order_number.includes(filters.q) || order.customer_name.includes(filters.q)) && (!filters.status || order.status === filters.status)), getAdminOrder: async id => orders.find(order => order.id === id) };
    const controller = createAdminOrdersController(repository);
    await page.route('**/admin/orders**', async route => {
      const url = new URL(route.request().url());
      const locals = { locale, direction: locale === 'ar' ? 'rtl' : 'ltr', title: 'Orders', adminPath: url.pathname, adminPermissions: ['orders', 'catalog', 'roles'], customer: { name: 'Synthetic Admin' }, t: key => translate(locale, key), a: key => adminText(locale, key), dashboardText: key => dashboardText(locale, key), number: value => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en').format(value) };
      let data;
      const res = { locals, render: (view, value) => { data = value; } };
      if (url.pathname === '/admin/orders') await controller.index({ query: Object.fromEntries(url.searchParams) }, res);
      else await controller.detail({ params: { id: url.pathname.split('/').pop() }, query: Object.fromEntries(url.searchParams) }, res);
      const html = await ejs.renderFile(path.resolve('src/views/layouts/admin.ejs'), { ...locals, ...data });
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    });
    await page.goto('/admin/orders');
    await expect(page.locator('.admin-order-card')).toHaveCount(4);
    await expect(page.locator('.admin-order-card').first()).not.toContainText('Synthetic Street');
    await expect(page.locator('.orders-filters input')).toHaveCSS('min-height', '44px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/admin-orders-${locale}-${width}.png`, fullPage: true });
    await page.locator('[name="q"]').fill('SYNTHETIC-1');
    await page.locator('[name="status"]').selectOption('PLACED');
    await page.locator('.orders-filters [type="submit"]').click();
    await expect(page.locator('.admin-order-card')).toHaveCount(1);
    await expect(page.locator('[name="status"]')).toHaveValue('PLACED');
    await page.locator('.admin-order-card .button').click();
    await expect(page.locator('.order-detail-heading')).toContainText('AS-SYNTHETIC-1');
    await expect(page.locator('.order-detail-address')).toContainText('Synthetic Street 5');
    await expect(page.locator('.order-action-panel select')).toBeVisible();
    await expect(page.locator('.order-map-button')).toHaveAttribute('href', 'https://www.google.com/maps?q=30,31');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `alreda-store-verification-screenshots/admin-order-detail-${locale}-${width}.png`, fullPage: true });

    await page.goto(`/admin/orders/${orders.find(order => order.status === 'CONFIRMED').id}?whatsapp=failed`);
    await expect(page.locator('.whatsapp-order-notice')).toHaveAttribute('data-status', 'failed');
    await expect(page.locator('form[action$="/whatsapp"] button')).toBeVisible();
  });
}

for (const locale of ['en', 'ar']) for (const width of [320, 390, 820, 1440]) {
  test(`admin dashboard fits ${locale} viewport ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/assets/**', route => route.fulfill({ path: path.resolve('src/public', new URL(route.request().url()).pathname.slice('/assets/'.length)) }));
    await page.route('**/admin', async route => {
      const orderRows = orders.map(({ id, order_number, customer_name, status, total_egp }) => ({ id, order_number, customer_name, status, total_egp }));
      const locals = {
        locale, direction: locale === 'ar' ? 'rtl' : 'ltr', title: 'Dashboard', adminPath: '/admin',
        adminPermissions: ['orders', 'catalog', 'roles'], customer: { name: 'Synthetic Admin' },
        t: key => translate(locale, key), a: key => adminText(locale, key), dashboardText: key => dashboardText(locale, key),
        number: value => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en').format(value),
        mediaAsset: (_key, fallback) => fallback,
      };
      const html = await ejs.renderFile(path.resolve('src/views/layouts/admin.ejs'), {
        ...locals, contentView: '../admin/dashboard', stats: { products: 125, categories: 12, orders: 104, pending: 8, lowStock: 4, unknownStock: 2, discounts: 3, team: 2 }, latestOrders: orderRows,
      });
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    });
    await page.goto('/admin');
    await expect(page.locator('.admin-dashboard')).toBeVisible();
    await expect(page.locator('.admin-table tbody tr')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 520) {
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /maximum-scale=1, user-scalable=no/);
      expect(await page.locator('.admin-table-wrap').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    if (width === 390 && locale === 'ar') await page.screenshot({ path: 'test-results/admin-dashboard-mobile-ar.png', fullPage: true });
  });
}
