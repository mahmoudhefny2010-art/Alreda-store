const { test, expect } = require('@playwright/test');

for (const width of [390, 1440]) {
  test(`global search shows matching product names at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/products/search**', async route => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('q')).toBe('mirror');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        products: [{ name: 'Black mirror holder', href: '/products/black-mirror-holder' }],
      }) });
    });

    await page.goto('/');
    await page.locator('[data-welcome-close]').click();
    await page.locator('[data-dialog="search-dialog"]').click();
    await page.locator('#collection-search').fill('mirror');
    const result = page.locator('#search-results a[href="/products/black-mirror-holder"]');
    await expect(result).toContainText('Black mirror holder');
    await expect(result).toContainText('products');
    await expect(result).toBeVisible();
  });
}
