const { test, expect } = require('@playwright/test');
const firstId = '123e4567-e89b-12d3-a456-426614174010';
const secondId = '123e4567-e89b-12d3-a456-426614174011';
function line(id) {
  return { product_id: id, quantity: 1, products: { id, name: id, name_ar: id, price_egp: 100, stock_quantity: 5, is_available: true } };
}
test('overlapping add actions are serialized and keep every item in the bag', async ({ page }) => {
  await page.goto('/assets/js/cart.js');
  let releaseFirst; const firstHeld = new Promise(resolve => { releaseFirst = resolve; });
  let requests = 0;
  await page.route('**/api/cart', route => route.fulfill({ json: { cart_items: [] } }));
  await page.route('**/api/cart/items', async route => {
    const index = ++requests;
    if (index === 1) await firstHeld;
    await route.fulfill({ json: { cart_items: index === 1 ? [line(firstId)] : [line(firstId), line(secondId)] } });
  });
  await page.setContent(`<html lang="en"><body><span data-cart-count></span>
    <dialog data-cart-dialog data-empty-text="Empty" data-total-text="Total" data-remove-text="Remove" data-error-text="Error">
      <ul data-cart-items></ul><p data-cart-status></p><div data-cart-total></div><a data-cart-checkout href="/checkout">Checkout</a>
    </dialog>
    <article class="product-card"><button class="add-to-cart" data-product-id="${firstId}">First</button><p data-cart-status></p></article>
    <article class="product-card"><button class="add-to-cart" data-product-id="${secondId}">Second</button><p data-cart-status></p></article>
    </body></html>`);
  await page.addScriptTag({ url: '/assets/js/cart.js' });
  try {
    await page.getByRole('button', { name: 'First', exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await page.getByRole('button', { name: 'Second', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(requests).toBe(1);
    releaseFirst();
    await expect.poll(() => requests).toBe(2);
    await expect(page.locator('[data-cart-count]')).toHaveText('2');
    await expect(page.locator('.bag-item')).toHaveCount(2);
  } finally { releaseFirst(); }
});

test('signed-in catalog pages restore saved hearts and remove with one click', async ({ page }) => {
  await page.goto('/assets/js/wishlist.js');
  let removals = 0;
  await page.route('**/api/wishlist/ids', route => route.fulfill({ json: { authenticated: true, ids: [firstId] } }));
  await page.route('**/api/wishlist/items/' + firstId, route => {
    expect(route.request().method()).toBe('DELETE'); removals++;
    return route.fulfill({ json: { ids: [] } });
  });
  await page.setContent(`<html><body><nav class="mobile-bottom-nav" data-authenticated="true"></nav>
    <button data-favorite-toggle data-product-id="${firstId}" data-save-label="Save" data-remove-label="Remove" aria-pressed="false">Favorite</button>
    <span data-wishlist-count></span><span data-wishlist-global-status></span></body></html>`);
  await page.addScriptTag({ url: '/assets/js/wishlist.js' });
  await expect(page.locator('[data-favorite-toggle]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-wishlist-count]')).toHaveText('1');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('[data-favorite-toggle]')).toHaveAttribute('aria-pressed', 'false');
  expect(removals).toBe(1);
});
