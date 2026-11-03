const { test, expect } = require('@playwright/test');
const catalog = require('../../src/config/catalog.json');
const largestGallery = [...catalog.products].sort((a, b) => b.gallery.length - a.gallery.length)[0];
for (const width of [1440, 390]) {
  test(`complete catalog pagination and gallery at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/products');
    await expect(page.locator('.product-card')).toHaveCount(24);
    await page.locator('.product-card img').evaluateAll(images => Promise.all(images.map(image => { image.loading = 'eager'; return image.decode(); })));
    const cards = await page.locator('.product-card').evaluateAll(elements => elements.map(card => ({
      top: card.getBoundingClientRect().top, height: card.getBoundingClientRect().height,
      buttonTop: card.querySelector('.add-to-cart').getBoundingClientRect().top,
      imageFit: getComputedStyle(card.querySelector('img')).objectFit,
    })));
    expect(Math.max(...cards.map(card => card.height)) - Math.min(...cards.map(card => card.height))).toBeLessThan(1);
    for (const card of cards) {
      expect(card.imageFit).toBe('cover');
      const row = cards.filter(other => Math.abs(other.top - card.top) < 1);
      expect(Math.max(...row.map(other => other.buttonTop)) - Math.min(...row.map(other => other.buttonTop))).toBeLessThan(1);
    }
    await page.screenshot({ path: `test-results/product-cards-${width}.png`, fullPage: true });
    const firstIds = await page.locator('.product-card').evaluateAll(cards => cards.map(card => card.dataset.productId));
    await page.getByRole('navigation', { name: 'Product pages' }).getByRole('link', { name: 'Page 2', exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    const nextIds = await page.locator('.product-card').evaluateAll(cards => cards.map(card => card.dataset.productId));
    expect(nextIds.every(id => !firstIds.includes(id))).toBe(true);
    await page.goto(`/products/${encodeURIComponent(largestGallery.slug)}`);
    const thumbs = page.locator('[data-gallery-src]');
    await expect(thumbs).toHaveCount(largestGallery.gallery.length);
    await thumbs.last().click();
    await expect(thumbs.last()).toHaveAttribute('aria-pressed', 'true');
    const main = page.locator('#product-main-photo');
    await main.evaluate(image => image.decode());
    await expect(main).toHaveAttribute('data-original-src', largestGallery.gallery.at(-1).src);
    await page.getByRole('button', { name: 'Enlarge product image' }).click();
    await page.locator('.product-lightbox img').evaluate(image => image.decode());
    await expect(page.locator('.product-lightbox img')).toHaveAttribute('src', largestGallery.gallery.at(-1).src);
    await page.keyboard.press('Escape');
    const imageVariant = largestGallery.variants.find(variant => variant.id !== largestGallery.variants[0].id && variant.imageId && variant.imageId !== largestGallery.gallery.at(-1).sourceId);
    if (imageVariant) {
      for (const [index, value] of imageVariant.options.entries()) {
        const radio = page.locator(`[data-option-index="${index}"]`).getByRole('radio', { name: value, exact: true });
        if (await radio.count()) await radio.check();
      }
      const expected = largestGallery.gallery.find(image => image.sourceId === imageVariant.imageId);
      await expect(main).toHaveAttribute('data-original-src', expected.src);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/catalog-gallery-${width}.png` });
    expect(errors).toEqual([]);
  });
}
