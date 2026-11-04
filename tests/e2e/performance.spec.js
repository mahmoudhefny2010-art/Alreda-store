const { test, expect } = require('@playwright/test');
for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`product gallery and options retain their interactions at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/products/delight-bathroom-accessories-pieces-stainless-304-black');
    const welcome = page.locator('[data-welcome-dialog]');
    await expect(welcome).toBeVisible();
    await welcome.locator('[data-welcome-close]').click();
    await expect(page.locator('html')).not.toHaveClass(/is-page-loading/);
    await expect(page.locator('.product-detail-layout')).toHaveCSS('display', 'grid');
    const thumbnails = page.locator('[data-gallery-src]');
    const original = await page.locator('#product-main-photo').getAttribute('src');
    await thumbnails.nth(1).click();
    await expect(thumbnails.nth(1)).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('#product-main-photo').getAttribute('src')).not.toBe(original);
    const root = page.locator('[data-product-details]');
    const variants = await root.evaluate(element => JSON.parse(element.dataset.variants));
    const initial = await page.locator('[data-variant-price]').textContent();
    const next = variants.find(variant => variant.currentFormatted !== initial);
    for (const [index, value] of next.options.entries()) {
      const choice = page.locator(`[data-option-index="${index}"] input[value=${JSON.stringify(value)}]`);
      await choice.check();
    }
    await expect(page.locator('[data-variant-price]')).toHaveText(next.currentFormatted);
    await expect(page).toHaveURL(new RegExp(`variant=${next.id}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
  test(`page controls are usable while an image is delayed at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const stylesheets = [];
    page.on('request', request => { if (request.resourceType() === 'stylesheet') stylesheets.push(new URL(request.url()).pathname); });
    let releaseImage;
    const delayed = new Promise(resolve => { releaseImage = resolve; });
    await page.route('**/assets/images/bathroom-hero.jpg', async route => { await delayed; await route.abort(); });
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).not.toHaveClass(/is-page-loading/);
      expect(stylesheets.some(url => /admin-|product-details/.test(url))).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('searchbox')).toBeVisible();
      await page.keyboard.press('Escape');
    } finally { releaseImage(); }
  });
}
