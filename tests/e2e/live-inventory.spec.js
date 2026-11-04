const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { translate } = require('../../src/config/storefront-i18n');

const productId = '123e4567-e89b-12d3-a456-426614174000';
const variantId = '123e4567-e89b-12d3-a456-426614174001';
const item = {
  id: 'cart-item',
  product_id: productId,
  variant_id: variantId,
  quantity: 2,
  product_variants: { price_egp: 500, stock_quantity: 4, is_available: true },
  products: { id: productId, name: 'Synthetic product', name_ar: 'Synthetic product', image_url: '', price_egp: 500,
    sale_price_egp: 500, stock_quantity: 4, is_available: true },
};

test('wishlist polls every five minutes, clears recovered errors, and only rerenders changed products', async ({ page }) => {
  await page.clock.install();
  await page.goto('/assets/js/wishlist.js');
  let requests = 0;
  let idsRequests = 0;
  let product = { id: productId, productId, unavailable: false, href: '/products/synthetic', name: 'Synthetic product',
    image: '', status: 'Available', outOfStock: false, hasOptions: false, selectedVariantId: variantId,
    variants: [{ id: variantId, title: 'Single', price: 'EGP 500.00', compareAt: '', image: '', available: true }],
    options: [], price: 'EGP 500.00', compareAt: '' };
  await page.route('**/api/wishlist*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/ids')) { idsRequests++; return route.fulfill({ json: { authenticated: true, ids: [productId] } }); }
    requests++;
    return route.fulfill({ json: { authenticated: true, ids: [productId], items: [product] } });
  });
  await page.setContent(`<!doctype html><html lang="en"><body>
    <nav class="mobile-bottom-nav" data-authenticated="true"></nav>
    <main data-wishlist data-error="Your favorites could not be loaded. Please try again." data-updated="Favorite product details were updated."
      data-empty-title="No favorites" data-empty-copy="Empty" data-price-label="Price unavailable"
      data-unavailable="Unavailable" data-out-of-stock="Out of stock" data-choose="Choose option" data-remove="Remove" data-add="Add" data-added="Added" data-cart="Added">
      <p data-wishlist-status role="status" aria-live="polite"></p><div data-wishlist-grid></div>
      <section data-wishlist-empty hidden><h2 data-empty-heading></h2><p data-empty-message></p></section>
    </main><span data-wishlist-global-status role="status"></span></body></html>`);
  await page.addScriptTag({ url: '/assets/js/wishlist.js' });

  await expect(page.locator('.wishlist-card-title')).toHaveText('Synthetic product');
  expect(requests).toBe(1);
  expect(idsRequests).toBe(0);
  await page.locator('[data-wishlist-status]').evaluate(element => { element.textContent = 'Your favorites could not be loaded. Please try again.'; });
  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('[data-wishlist-status]')).toBeEmpty();
  await page.locator('.wishlist-card').evaluate(element => { window.savedFavoriteCard = element; });
  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => requests).toBe(3);
  expect(await page.locator('.wishlist-card').evaluate(element => element === window.savedFavoriteCard)).toBe(true);

  product = { ...product, status: 'Out of stock', outOfStock: true, price: 'EGP 600.00',
    variants: [{ ...product.variants[0], price: 'EGP 600.00', available: false }] };
  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => requests).toBe(4);
  await expect(page.locator('.wishlist-card-price strong')).toHaveText('EGP 600.00');
  await expect(page.locator('.wishlist-stock')).toHaveText('Out of stock');
  await expect(page.getByRole('button', { name: 'Add' })).toBeDisabled();
  await expect(page.locator('[data-wishlist-status]')).toHaveText('Favorite product details were updated.');
});

test('shopping bag keeps quantities and refreshes price and stock only when the server data changes', async ({ page }) => {
  await page.clock.install();
  await page.goto('/assets/js/cart.js');
  let cart = { cart_items: [structuredClone(item)] };
  let requests = 0;
  await page.route('**/api/cart', async route => {
    requests++;
    return route.fulfill({ json: cart });
  });
  const header = await ejs.renderFile(path.resolve('src/views/partials/header.ejs'), {
    locale: 'en', t: key => translate('en', key), title: '', returnTo: '/', customer: null, googleAuthEnabled: true,
  });
  await page.setContent(`<!doctype html><html lang="en"><body>${header}<script src="/assets/js/cart.js"></script></body></html>`);
  await expect(page.locator('.bag-item')).toHaveCount(1);
  await page.locator('.bag-item').evaluate(element => { window.savedCartItem = element; });

  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => requests).toBe(2);
  expect(await page.locator('.bag-item').evaluate(element => element === window.savedCartItem)).toBe(true);

  cart = { cart_items: [{ ...item, product_variants: { ...item.product_variants, price_egp: 700, stock_quantity: 1 },
    products: { ...item.products, price_egp: 700, sale_price_egp: 700, stock_quantity: 1 } }] };
  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => requests).toBe(3);
  await expect(page.locator('.bag-item-quantity')).toContainText('2 ×');
  await expect(page.locator('.bag-item-quantity')).toContainText('700');
  await expect(page.locator('.bag-stock-warning')).toContainText('Only 1 available');
  cart = { cart_items: [{ ...item, product_variants: { ...item.product_variants, stock_quantity: null },
    products: { ...item.products, stock_quantity: 4 } }] };
  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => requests).toBe(4);
  await expect(page.locator('.bag-stock-warning')).toHaveText('Out of stock. Remove this item before checkout.');
});

test('checkout updates current cart prices and warns about reduced stock without changing the entered quantity', async ({ page }) => {
  await page.clock.install();
  await page.goto('/assets/js/checkout.js');
  let cart = { cart_items: [structuredClone(item)] };
  let requests = 0;
  await page.route('**/api/cart', async route => {
    requests++;
    return route.fulfill({ json: cart });
  });
  await page.setContent(`<!doctype html><html lang="en"><body>
    <section class="checkout-page"><p id="checkout-status" role="status" aria-live="polite"></p><div id="checkout-result" hidden></div>
      <form id="checkout-form" data-request-key="123e4567-e89b-12d3-a456-426614174002" data-locale="en"
        data-invalid-name="Invalid name" data-invalid-phone="Invalid phone" data-paid="Paid" data-pending="Pending" data-unpaid="Unpaid"
        data-items-updated="Product prices or availability changed. Your summary is up to date."
        data-inventory-refresh-error="Could not refresh product details." data-item-out-of-stock="Out of stock."
        data-item-quantity-changed="Only {quantity} available." data-item-removed="Removed from bag.">
        <input name="name" value="Synthetic Buyer"><input name="phone" value="01012345678"><input name="email" value="buyer@example.invalid">
        <input name="address" value="Synthetic address"><select name="city"><option value="Cairo" data-fee="25" selected>Cairo</option></select>
        <input name="postalCode"><textarea name="notes"></textarea><input type="radio" name="paymentMethod" value="CASH_ON_DELIVERY" checked>
        <label class="checkout-product"><span class="checkout-product-name"><span data-checkout-product-name>Synthetic product</span><small>EGP 500</small></span>
          <span class="checkout-quantity"><small>Quantity</small><input type="number" value="2" min="0" max="4" data-product-id="${productId}" data-variant-id="${variantId}"
            data-price="500" data-stock="4" data-available="true" data-cart-managed="true"><small data-checkout-stock-status hidden></small></span></label>
        <dl><dd data-checkout-subtotal></dd><dd data-checkout-shipping></dd><dd id="checkout-total"></dd></dl>
        <button type="submit">Submit</button>
      </form><button id="check-order" hidden></button><button id="new-order" hidden></button>
    </section><script src="/assets/js/checkout.js"></script></body></html>`);
  const quantity = page.locator('[data-product-id]');
  await expect(page.locator('#checkout-total')).toContainText('1,025');
  await page.locator('#checkout-form [type="submit"]').evaluate(button => { window.savedSubmitButton = button; });

  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => requests).toBe(1);
  expect(await page.locator('#checkout-form [type="submit"]').evaluate(element => element === window.savedSubmitButton)).toBe(true);

  cart = { cart_items: [{ ...item, product_variants: { ...item.product_variants, price_egp: 700, stock_quantity: 1 },
    products: { ...item.products, price_egp: 700, sale_price_egp: 700, stock_quantity: 1 } }] };
  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('.checkout-product-name small')).toHaveText('EGP 700');
  await expect(quantity).toHaveValue('2');
  await expect(quantity).toHaveAttribute('max', '1');
  await expect(page.locator('[data-checkout-stock-status]')).toContainText('Only 1 available');
  await expect(page.locator('#checkout-total')).toContainText('1,425');
  await expect(page.locator('#checkout-status')).toHaveText('Product prices or availability changed. Your summary is up to date.');

  cart = { cart_items: [{ ...item, product_variants: { ...item.product_variants, stock_quantity: null },
    products: { ...item.products, stock_quantity: 4 } }] };
  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => requests).toBe(3);
  await expect(quantity).toHaveAttribute('max', '0');
  await expect(page.locator('[data-checkout-stock-status]')).toHaveText('Out of stock.');
});
