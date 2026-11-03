const { test, expect } = require('@playwright/test');
const catalog = require('../../src/config/catalog.json');
const rack = catalog.products.find(product => product.slug === 'delight-magic-hidden-clothes-drying-rack-stainless');
const incomplete = catalog.products.find(product => product.variants.some(variant => variant.imageId && variant.imageId !== product.gallery[0].sourceId)
  && product.variants.some(variant => !variant.imageId));
async function choose(page, variant) {
  for (const [index, value] of variant.options.entries()) {
    const input = page.locator(`[data-option-index="${index}"]`).getByRole('radio', { name: value, exact: true });
    if (!(await input.isChecked())) {
      await input.focus();
      await page.keyboard.press('Space');
      await expect(input).toBeChecked();
      await expect(input).toBeFocused();
    }
  }
}
for (const width of [1440, 390]) {
  test(`color and size select the associated photo at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/products/${rack.slug}`);
    const main = page.locator('#product-main-photo');
    // Exercise both colors and sizes, then return to the initial combination.
    for (const variant of [...rack.variants.slice(1), rack.variants[0]]) {
      await choose(page, variant);
      const image = rack.gallery.find(image => image.sourceId === variant.imageId);
      await expect(main).toHaveAttribute('data-original-src', image.src);
      await expect(main).toHaveAttribute('src', image.displaySrc);
      await expect(main).toHaveAttribute('srcset', image.srcSet);
      const selected = page.locator('[data-gallery-src]').filter({ has: page.locator(`img[src="${image.cardSrc}"]`) });
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      expect(await selected.evaluate(button => {
        const strip = button.parentElement.getBoundingClientRect(); const image = button.getBoundingClientRect();
        return image.left >= strip.left - 1 && image.right <= strip.right + 1;
      })).toBe(true);
      await expect(page).toHaveURL(new RegExp(`variant=${variant.id}`));
    }
    await page.reload();
    const expected = rack.gallery.find(image => image.sourceId === rack.variants[0].imageId);
    await expect(main).toHaveAttribute('data-original-src', expected.src);
    await page.getByRole('button', { name: 'Enlarge product image' }).click();
    await expect(page.locator('.product-lightbox img')).toHaveAttribute('src', expected.src);
  });
  test(`an option without its own image resets the photo at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/products/${incomplete.slug}`);
    const mapped = incomplete.variants.find(variant => variant.imageId && variant.imageId !== incomplete.gallery[0].sourceId);
    const unmapped = incomplete.variants.find(variant => !variant.imageId);
    await choose(page, mapped);
    const mappedImage = incomplete.gallery.find(image => image.sourceId === mapped.imageId);
    await expect(page.locator('#product-main-photo')).toHaveAttribute('data-original-src', mappedImage.src);
    await choose(page, unmapped);
    await expect(page.locator('#product-main-photo')).toHaveAttribute('data-original-src', incomplete.gallery[0].src);
    await page.reload();
    await expect(page.locator('#product-main-photo')).toHaveAttribute('data-original-src', incomplete.gallery[0].src);
  });
}
