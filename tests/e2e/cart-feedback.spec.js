const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { translate } = require('../../src/config/storefront-i18n');

for (const locale of ['en', 'ar']) {
  for (const width of [1440, 390]) {
    test(`shopping bag, saved feedback and quantity badge ${locale} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const t = key => translate(locale, key);
      const header = await ejs.renderFile(path.resolve('src/views/partials/header.ejs'), { locale, t, title: '', returnTo: '/', customer: { name: 'Synthetic customer' } });
      let items = [];
      let fail = false;
      const item = { quantity: 2, variant_id: 'gold', products: { id: 'test', name: 'Bathroom accessories — Gold', name_ar: 'إكسسوارات الحمام — ذهبي', image_url: '/synthetic-bag-photo.svg', price_egp: 500 } };
      await page.route('**/api/cart', route => route.fulfill({ json: { cart_items: items } }));
      await page.route('**/api/cart/items', route => {
        if (fail) return route.fulfill({ status: 503, json: { error: 'CART_UNAVAILABLE' } });
        items = route.request().method() === 'DELETE' ? [] : [item];
        return route.fulfill({ json: { cart_items: items } });
      });
      await page.route('**/synthetic-bag-photo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80"><rect width="60" height="80" fill="#ddd"/></svg>' }));
      await page.route('**/synthetic-bag', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/components/cart.css"></head><body>${header}<main class="product-card" style="padding:24px"><button class="add-to-cart" data-product-id="test">Add</button><p data-cart-status role="status"></p></main><script src="/assets/js/main.js"></script><script src="/assets/js/cart.js"></script></body></html>` }));
      await page.goto('/synthetic-bag');
      const badge = page.locator('[data-cart-count]');
      await expect(badge).toBeHidden();
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.locator('[data-cart-feedback]')).toBeVisible();
      await expect(page.locator('main [data-cart-feedback]')).toHaveCSS('position', 'static');
      await expect(page.locator('[data-cart-feedback-text]')).toHaveText(t('cartAdded'));
      await expect(badge).toHaveText('2');
      await expect(badge).toBeVisible();
      // The checkout confirmation requests a fresh persistent cart without a page reload.
      items = [];
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('cart:refresh')));
      await expect(badge).toBeHidden();
      items = [item];
      await page.reload();
      await expect(badge).toHaveText('2');
      await page.locator('[data-dialog="bag-dialog"]').click();
      await expect(page.locator('.bag-item')).toHaveCount(1);
      await expect(page.locator('.bag-item-name')).toHaveText(locale === 'ar' ? item.products.name_ar : item.products.name);
      await expect(page.locator('.bag-total strong')).toContainText(locale === 'ar' ? '١٬٠٠٠' : '1,000');
      await expect(page.locator('[data-cart-checkout]')).toBeVisible();
      expect(await page.locator('#bag-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: `alreda-store-verification-screenshots/bag-${locale}-${width}.png` });
      await page.locator('.bag-remove').click();
      await expect(badge).toBeHidden();
      await expect(page.locator('[data-cart-checkout]')).toBeHidden();
      await expect(page.locator('#bag-dialog [data-cart-status]')).toHaveText(t('bagEmpty'));
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-dialog="bag-dialog"]')).toBeFocused();
      fail = true;
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.locator('main [data-cart-status]')).toHaveText(t('cartError'));
      await expect(page.locator('[data-cart-feedback]')).toBeHidden();
      await expect(badge).toBeHidden();
    });
  }
}
