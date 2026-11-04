const { test, expect } = require('@playwright/test');

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`scroll reveals and newly added product cards at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/products');
    await expect(page.locator('html')).toHaveClass(/has-scroll-reveal/);

    const lastCard = page.locator('.product-card').last();
    await lastCard.scrollIntoViewIfNeeded();
    await expect(lastCard).toHaveClass(/is-visible/);
    await expect(lastCard).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `test-results/scroll-reveal-${viewport.width}.png` });

    await page.locator('.product-card').first().evaluate(card => {
      const clone = card.cloneNode(true);
      clone.classList.remove('is-visible');
      clone.style.removeProperty('--reveal-delay');
      card.parentElement.append(clone);
      return clone;
    });
    const appendedCard = page.locator('.product-card').last();
    await appendedCard.scrollIntoViewIfNeeded();
    await expect(appendedCard).toHaveClass(/is-visible/);
    await expect(appendedCard).toHaveCSS('opacity', '1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('homepage collections reveal on scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const section = page.locator('.collections-section').first();
  await section.scrollIntoViewIfNeeded();
  await expect(section).toHaveClass(/is-visible/);
  await expect(section.locator('.category-card').first()).toHaveClass(/is-visible/);
});

test('card hover is subtle on desktop and disabled for touch input', async ({ browser }) => {
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto('/products');
  await desktopPage.locator('[data-welcome-close]').click();
  const desktopCard = desktopPage.locator('.product-card').first();
  await desktopCard.scrollIntoViewIfNeeded();
  await expect(desktopCard).toHaveClass(/is-visible/);
  await desktopCard.hover();
  await expect.poll(() => desktopCard.evaluate(card => new DOMMatrixReadOnly(getComputedStyle(card).transform).m42)).toBeCloseTo(-4, 0);
  await expect.poll(() => desktopCard.locator('.category-image').evaluate(image => new DOMMatrixReadOnly(getComputedStyle(image).transform).m11)).toBeCloseTo(1.03, 2);
  await expect(desktopCard).not.toHaveCSS('box-shadow', 'none');
  await desktopContext.close();

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const touchPage = await touchContext.newPage();
  await touchPage.goto('/products');
  await touchPage.locator('[data-welcome-close]').click();
  const touchCard = touchPage.locator('.product-card').first();
  await touchCard.scrollIntoViewIfNeeded();
  await expect(touchCard).toHaveClass(/is-visible/);
  expect(await touchPage.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(false);
  await touchCard.hover();
  await expect(touchCard).toHaveCSS('box-shadow', 'none');
  await expect(touchCard.locator('.category-image')).toHaveCSS('transform', 'none');
  await touchContext.close();
});

test('reduced motion and unavailable IntersectionObserver keep cards visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/products');
  await expect(page.locator('html')).not.toHaveClass(/has-scroll-reveal/);
  await expect(page.locator('.product-card').first()).toHaveCSS('opacity', '1');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  await page.goto('/products');
  await expect(page.locator('html')).not.toHaveClass(/has-scroll-reveal/);
  await expect(page.locator('.product-card').first()).toHaveCSS('opacity', '1');
});
