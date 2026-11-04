const { test, expect } = require('@playwright/test');

for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1024, height: 1366 }]) {
  test(`mobile and tablet footer spacing and pagination at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/products');
    const welcome = page.locator('[data-welcome-dialog]');
    await expect(welcome).toBeVisible();
    await welcome.locator('[data-welcome-close]').click();

    const pagination = page.locator('.catalog-pagination');
    await expect(pagination).toBeVisible();
    await expect(pagination).toHaveCSS('display', 'flex');
    await expect(pagination).toHaveCSS('justify-content', 'center');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const favoriteIcon = page.locator('.favorite-toggle .icon').first();
    await expect(favoriteIcon).toBeVisible();
    await expect(favoriteIcon).toHaveCSS('width', '14px');
    await expect(page.locator('.favorite-toggle').first()).toHaveCSS('width', '30px');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    const colorSwatch = page.locator('.card-option-swatch').first();
    if (await colorSwatch.count()) await expect(colorSwatch).toHaveCSS('width', '26px');

    const footer = page.locator('.shop-footer');
    await footer.scrollIntoViewIfNeeded();
    await expect.poll(() => footer.evaluate(element => {
      const { bottom } = element.getBoundingClientRect();
      return Math.abs(Math.round(document.documentElement.scrollHeight - (bottom + window.scrollY)));
    })).toBe(0);
    if (viewport.width <= 850) await expect(page.locator('.mobile-bottom-nav')).toHaveAttribute('aria-hidden', 'true');
  });
}
