const { test, expect } = require('@playwright/test');

test('mobile navigation and guest wishlist stay in sync across reloads', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  let cartState = { cart_items: [] };
  await page.route('**/api/cart', route => route.fulfill({ json: cartState }));
  await page.route('**/api/wishlist?ids=*', route => {
    const url = new URL(route.request().url());
    const identifiers = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
    return route.fulfill({ json: { authenticated: false, items: identifiers.map(id => ({ id, unavailable: false, slug: 'synthetic-favorite', href: '/products/synthetic-favorite', name: 'Synthetic favorite',
      image: '', status: 'Available', outOfStock: false, hasOptions: false, selectedVariantId: 'synthetic-variant', variants: [{ id: 'synthetic-variant', title: 'Single', price: 'EGP 450.00', compareAt: 'EGP 500.00', image: '', available: true }], options: [], price: 'EGP 450.00', compareAt: 'EGP 500.00' })) } });
  });
  await page.route('**/api/cart/items', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      cartState = { cart_items: [{ product_id: body.productId, variant_id: body.variantId || null, quantity: body.quantity,
        products: { id: body.productId, name: 'Synthetic favorite', name_ar: 'Synthetic favorite', image_url: '', price_egp: 450, sale_price_egp: null } }] };
    }
    await route.fulfill({ json: cartState });
  });
  await page.goto('/');
  const welcome = page.locator('#welcome-dialog');
  await expect(welcome).toBeVisible();
  if (await welcome.evaluate(dialog => dialog.open)) {
    await welcome.locator('[data-welcome-later]').click();
    await welcome.locator('[data-welcome-done]').click();
  }
  const nav = page.locator('.mobile-bottom-nav');
  await expect(nav).toBeHidden();
  const header = page.locator('.shop-header');
  await expect(header.getByRole('button', { name: 'Menu' })).toBeVisible();
  await header.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('#site-nav')).toHaveClass(/is-open/);
  await page.keyboard.press('Escape');
  await header.getByRole('button', { name: /Shopping bag/ }).click();
  await expect(page.locator('#bag-dialog')).toBeVisible();
  await page.locator('#bag-dialog .dialog-top button').click();
  const headerBottom = await header.evaluate(element => window.scrollY + element.getBoundingClientRect().bottom);
  await page.evaluate(bottom => window.scrollTo({ top: bottom + 2, behavior: 'instant' }), headerBottom);
  await expect(nav).toBeVisible();
  await expect(nav).toHaveCSS('opacity', '1');
  await expect(page.locator('.shopping-hero')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/wishlist-mobile-navigation.png' });

  await nav.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('#site-nav')).toHaveClass(/is-open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#site-nav')).not.toHaveClass(/is-open/);

  await page.locator('.category-card a').first().click();
  const heart = page.locator('.product-card [data-favorite-toggle]').first();
  await expect(heart).toBeVisible();
  const productId = await heart.getAttribute('data-product-id');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await expect(nav.locator('[data-wishlist-count]')).toHaveText('1');
  await page.locator('.product-card').first().screenshot({ path: 'test-results/wishlist-product-card-mobile.png' });
  await page.reload();
  await expect(nav.locator('[data-wishlist-count]')).toHaveText('1');
  await expect(page.locator(`.product-card [data-favorite-toggle][data-product-id="${productId}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.scrollTo({ top: document.querySelector('.shop-header').offsetHeight + 4, behavior: 'instant' }));
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Favorites' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(nav).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Your favorites' })).toBeVisible();
  await expect(page.locator('[data-wishlist-empty]')).toBeHidden();
  await expect(page.locator('.wishlist-card-title', { hasText: 'Synthetic favorite' })).toBeVisible();
  await expect(page.getByText('EGP 450.00')).toBeVisible();
  await expect(page.locator('.wishlist-card del')).toHaveText('EGP 500.00');
  await page.screenshot({ path: 'test-results/wishlist-page-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(nav.locator('[data-cart-count]')).toHaveText('1');
  await header.getByRole('button', { name: /Shopping bag/ }).click();
  await expect(page.locator('#bag-dialog')).toBeVisible();
  await expect(page.locator('[data-cart-items]')).toContainText('Synthetic favorite');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#bag-dialog .dialog-top button').click();
  await page.goto('/');
  const homeWelcome = page.locator('#welcome-dialog');
  if (await homeWelcome.evaluate(dialog => dialog.open)) {
    await homeWelcome.locator('[data-welcome-later]').click();
    await homeWelcome.locator('[data-welcome-done]').click();
  }
  await page.locator('.shop-footer').scrollIntoViewIfNeeded();
  await expect(nav).toBeHidden();
  const whatsapp = page.locator('.whatsapp-contact__link');
  await expect(whatsapp).toBeVisible();
  expect(await whatsapp.evaluate(link => {
    const box = link.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === link;
  })).toBe(true);
  const footerTop = await page.locator('.shop-footer').evaluate(footer => footer.getBoundingClientRect().top + window.scrollY);
  await page.evaluate(top => window.scrollTo({ top: Math.max(0, top - innerHeight - 100), behavior: 'instant' }), footerTop);
  await expect(nav).toBeVisible();
  expect(await whatsapp.evaluate(link => link.getBoundingClientRect().bottom < document.querySelector('.mobile-bottom-nav').getBoundingClientRect().top)).toBe(true);
  await page.locator('.shop-footer').scrollIntoViewIfNeeded();
  await expect(nav).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.wishlist-header-toggle')).toBeVisible();
  await expect(nav).toBeHidden();
});

test('pulling down at the top of a mobile page refreshes after the release threshold', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    if (!('ontouchstart' in window)) Object.defineProperty(window, 'ontouchstart', { value: null });
    sessionStorage.setItem('alreda:pull-refresh-loads', String(Number(sessionStorage.getItem('alreda:pull-refresh-loads') || 0) + 1));
  });
  await page.goto('/');
  const welcome = page.locator('#welcome-dialog');
  await page.waitForTimeout(750);
  if (await welcome.evaluate(dialog => dialog.open)) {
    await welcome.locator('[data-welcome-later]').click();
    await welcome.locator('[data-welcome-done]').click();
  }
  for (const cancellation of ['touchcancel', 'multitouch']) {
    await page.locator('body').evaluate((body, cancellation) => {
      const touch = (y, identifier = 1) => new Touch({ identifier, target: document.body, clientX: 180, clientY: y });
      body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(0)] }));
      body.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(100)] }));
      if (cancellation === 'touchcancel') body.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true, changedTouches: [touch(100)] }));
      else body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(100), touch(100, 2)] }));
      body.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [touch(100)] }));
    }, cancellation);
    await expect(page.locator('[data-pull-refresh]')).toHaveAttribute('data-state', 'idle');
    await page.waitForTimeout(300); // A refresh previously scheduled after 240 ms must not occur.
    expect(await page.evaluate(() => sessionStorage.getItem('alreda:pull-refresh-loads'))).toBe('1');
  }
  await page.locator('body').evaluate(body => {
    const touch = y => new Touch({ identifier: 1, target: document.body, clientX: 180, clientY: y });
    body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(0)], changedTouches: [touch(0)] }));
    body.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(100)], changedTouches: [touch(100)] }));
    body.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [touch(100)] }));
  });
  await page.waitForFunction(() => sessionStorage.getItem('alreda:pull-refresh-loads') === '2', null, { timeout: 10000 });
});
