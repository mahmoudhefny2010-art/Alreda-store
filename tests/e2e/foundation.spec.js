const { test, expect } = require('@playwright/test');
for (const viewport of [{ width: 1876, height: 886 }, { width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) {
  test(`storefront and admin at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Browse our latest products');
    await expect(page.getByRole('heading', { name: 'Collections', exact: true, level: 2 })).toHaveCount(2);
    await page.locator('.shopping-hero-image').evaluate(image => image.decode());
    await page.locator('.shop-brand img').evaluate(image => image.decode());
    await page.screenshot({ path: `test-results/hero-${viewport.width}.png` });
    await page.getByRole('link', { name: 'Shop all', exact: true }).click();
    await expect(page.locator('#collections-title')).toBeInViewport();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.category-card')).toHaveCount(18);
    await expect(page.locator('.category-grid--primary .category-card')).toHaveCount(15);
    await expect(page.locator('.category-grid--secondary .category-card')).toHaveCount(3);
    await expect(page.locator('.category-card .image-placeholder')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'More collections', exact: true })).toHaveCount(0);
    const expectedColumns = viewport.width > 1000 ? 4 : viewport.width < 360 ? 1 : 2;
    const columns = await page.locator('.category-grid--primary').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(expectedColumns);
    const secondaryColumns = await page.locator('.category-grid--secondary').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(secondaryColumns).toBe(viewport.width > 760 ? 3 : expectedColumns);
    await page.locator('.category-card img').evaluateAll(images => Promise.all(images.map(image => {
      image.loading = 'eager';
      return image.decode();
    })));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('link', { name: 'Workspace', exact: true })).toHaveCount(0);
    const brand = await page.locator('.shop-brand').boundingBox();
    expect(Math.abs(brand.x + brand.width / 2 - viewport.width / 2)).toBeLessThan(2);
    if (viewport.width <= 850) {
      const menu = page.getByRole('button', { name: 'Menu' });
      await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(menu).toBeFocused();
      await menu.click();
    }
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'Catalog', exact: true }).click();
    await expect(page).toHaveURL(/#collections$/);
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    if (viewport.width === 1440 || viewport.width === 390) {
      await page.screenshot({ path: `test-results/home-${viewport.width}.png`, fullPage: true });
      await page.locator('#collections').screenshot({ path: `test-results/collections-primary-${viewport.width}.png` });
      await page.locator('#more-collections').screenshot({ path: `test-results/collections-secondary-${viewport.width}.png` });
    }
    for (const [name, target] of [['Contact', '#contact'], ['About us', '#about-us']]) {
      if (viewport.width <= 850) await page.getByRole('button', { name: 'Menu' }).click();
      await nav.getByRole('link', { name, exact: true }).click();
      await expect(page.locator(target)).toBeInViewport();
      // A partly visible footer can still be moving. Let native smooth scrolling finish
      // before Playwright scrolls the header back into view for the next navigation click.
      await page.evaluate(() => new Promise(resolve => {
        let last = window.scrollY; let stable = 0;
        function settled() {
          const current = window.scrollY;
          stable = current === last ? stable + 1 : 0; last = current;
          if (stable >= 4) resolve(); else requestAnimationFrame(settled);
        }
        requestAnimationFrame(settled);
      }));
    }
    await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('searchbox').fill('mirrors');
    await expect(page.locator('#search-results li')).toHaveCount(1);
    await page.getByRole('searchbox').fill('no-such-category');
    await expect(page.getByRole('status')).toContainText('No matching collections');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Customer account' }).click();
    await expect(page.getByRole('dialog')).toContainText('not connected');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Shopping bag' }).click();
    await expect(page.getByRole('dialog')).toContainText('Your bag is empty');
    await page.keyboard.press('Escape');
    await page.locator('.category-card').filter({ has: page.getByRole('heading', { name: 'Mirrors', exact: true }) }).getByRole('link').click();
    await expect(page).toHaveURL(/\/collections\/mirrors$/);
    await expect(page.locator('#collection-title')).toHaveText('Mirrors');
    await expect(page.locator('.product-card')).toHaveCount(4);
    await expect(page.locator('.shopping-hero')).toHaveCount(0);
    await page.locator('.product-card img').evaluateAll(images => Promise.all(images.map(image => {
      image.loading = 'eager'; // Include below-the-fold images in the full-page capture.
      return image.decode();
    })));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/collection-${viewport.width}.png`, fullPage: true });
    await page.getByRole('searchbox', { name: 'Search this collection' }).fill('not-a-product');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText('No products to display.', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Clear search', exact: true }).click();
    await expect(page.locator('.product-card')).toHaveCount(4);
    await page.getByRole('navigation', { name: 'Collection navigation' }).getByRole('link', { name: 'Soap Dispensers', exact: true }).click();
    await expect(page).toHaveURL(/\/collections\/soap-dispensers$/);
    await expect(page.locator('.product-card')).toHaveCount(14);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('dialog').getByRole('searchbox').fill('mirrors');
    await page.locator('#search-results').getByRole('link', { name: 'Mirrors', exact: true }).click();
    await expect(page).toHaveURL(/\/collections\/mirrors$/);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Orders unavailable');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/admin-${viewport.width}.png`, fullPage: true });
    await page.goto('/missing');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    expect(errors).toEqual([]);
  });
}
