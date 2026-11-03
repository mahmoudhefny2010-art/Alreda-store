const { test, expect } = require('@playwright/test');
const slug = 'delight-bathroom-accessories-pieces-stainless-304-black';
for (const width of [1440, 390, 320]) {
  test(`product shopping UI at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/collections/individual-pieces');
    await page.locator('.product-card').first().getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/products/${slug}\\?collection=individual-pieces$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bathroom Accessories 89 Black');
    const main = page.locator('#product-main-photo');
    await main.evaluate(image => image.decode());
    const firstSource = await main.getAttribute('src');
    const thumbs = page.locator('[data-gallery-src]');
    await thumbs.nth(1).click();
    await expect(thumbs.nth(1)).toHaveAttribute('aria-pressed', 'true');
    expect(await main.getAttribute('src')).not.toBe(firstSource);
    await main.evaluate(image => image.decode());
    await page.getByRole('button', { name: 'Enlarge product image' }).click();
    await expect(page.getByRole('dialog', { name: 'Enlarged product image' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Enlarge product image' })).toBeFocused();
    const variants = await page.locator('[data-product-details]').evaluate(root => JSON.parse(root.dataset.variants));
    const originalPrice = await page.locator('[data-variant-price]').textContent();
    const different = variants.find(variant => variant.currentFormatted !== originalPrice);
    for (const [index, value] of different.options.entries()) {
      const choice = page.locator(`[data-option-index="${index}"]`).getByRole('radio', { name: value, exact: true });
      if (await choice.count()) await choice.check();
    }
    await expect(page.locator('[data-variant-price]')).toHaveText(different.currentFormatted);
    await expect(page).toHaveURL(new RegExp(`variant=${different.id}`));
    await page.reload();
    await expect(page.locator('[data-variant-price]')).toHaveText(different.currentFormatted);
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue('2');
    await page.getByRole('spinbutton', { name: 'Quantity' }).fill('999');
    await page.getByRole('spinbutton', { name: 'Quantity' }).blur();
    await expect(page.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue('99');
    await expect(page.getByRole('button', { name: 'Buy it now', exact: true })).toBeDisabled();
    await expect(page.locator('.product-purchase-actions').getByRole('button', { name: 'Add to cart', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('.product-thumbnails img, .related-products img').evaluateAll(images => Promise.all(images.map(image => { image.loading = 'eager'; return image.decode(); })));
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `test-results/product-${width}.png`, fullPage: true });
    await page.locator('.related-products .product-card').first().getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Bathroom Accessories 89 Black');
    expect(errors).toEqual([]);
  });
}
test('variant selection works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:3100/products/${slug}?collection=individual-pieces`);
    const select = page.getByRole('combobox', { name: 'Product option' });
    const options = await select.locator('option').all();
    await select.selectOption(await options[1].getAttribute('value'));
    await page.getByRole('button', { name: 'Update selection' }).click();
    await expect(page).toHaveURL(/variant=\d+/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bathroom Accessories 89 Black');
  } finally { await context.close(); }
});
