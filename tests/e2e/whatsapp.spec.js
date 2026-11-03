const { test, expect } = require('@playwright/test');

async function freezeBeforeLoad(page) {
  await page.clock.install({ time: new Date('2026-11-01T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-01T12:00:01Z'));
  await page.goto('/');
}

test('intro timing is once per load and never moves or enlarges the icon', async ({ page }) => {
  await freezeBeforeLoad(page);
  const contact = page.locator('[data-whatsapp-contact]');
  const link = contact.getByRole('link');
  const label = contact.locator('.whatsapp-contact__label');
  const before = await link.boundingBox();
  expect(before.width).toBe(44);
  expect(before.height).toBe(44);
  const viewport = page.viewportSize();
  expect(viewport.width - before.x - before.width).toBe(20);
  expect(viewport.height - before.y - before.height).toBe(20);
  await expect(link).toBeVisible();
  await page.clock.runFor(399);
  await expect(contact).not.toHaveClass(/is-revealed/);
  await page.clock.runFor(1);
  await expect(contact).toHaveClass(/is-revealed/);
  await expect(label).toHaveCSS('transition-duration', '0.45s, 0.45s, 0s');
  await expect(label).toHaveCSS('transition-timing-function', 'ease-in-out, ease-in-out, ease');
  await page.clock.runFor(450);
  await expect(label).toHaveCSS('opacity', '1');
  await page.clock.runFor(1999);
  await expect(contact).toHaveClass(/is-revealed/);
  await page.clock.runFor(1);
  await expect(contact).not.toHaveClass(/is-revealed/);
  await page.clock.runFor(450);
  await expect(label).toHaveCSS('opacity', '0');
  await expect(label).toHaveCSS('pointer-events', 'none');
  expect(await link.boundingBox()).toEqual(before);
  await page.clock.runFor(10000);
  await expect(contact).not.toHaveClass(/is-revealed/);
  await expect(link).toBeVisible();
});

test('desktop hover and keyboard focus reveal the label', async ({ page }) => {
  await freezeBeforeLoad(page);
  await page.clock.runFor(400);
  const contact = page.locator('[data-whatsapp-contact]');
  const link = contact.getByRole('link');
  const label = contact.locator('.whatsapp-contact__label');
  await link.hover();
  await expect(contact).not.toHaveClass(/is-revealed/);
  await expect(label).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/whatsapp-label-desktop.png' });
  const labelBox = await label.boundingBox();
  const iconBox = await link.boundingBox();
  expect(labelBox.x).toBeLessThan(iconBox.x);
  expect(labelBox.x + labelBox.width).toBeLessThan(iconBox.x + iconBox.width);
  await page.mouse.move(0, 0);
  await expect(label).toHaveCSS('opacity', '0');
  await link.focus();
  await expect(link).toBeFocused();
  await expect(label).toHaveCSS('opacity', '1');
  await expect(link).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  await expect(link).not.toBeFocused();
});

test('contact link opens an encoded greeting in a safe new tab', async ({ page, context }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Contact Alreda Store on WhatsApp (opens in a new tab)' });
  const href = new URL(await link.getAttribute('href'));
  expect(href.origin).toBe('https://wa.me');
  expect(href.pathname).toBe('/15550100100');
  expect(href.searchParams.get('text')).toContain('Hello Alreda Store');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  // Intercept locally: never contact WhatsApp or send a message.
  await context.route('https://wa.me/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Contact link verified</title>' }));
  const popup = page.waitForEvent('popup');
  await link.click();
  await expect(await popup).toHaveTitle('Contact link verified');
});

for (const width of [1440, 390]) {
  test(`stays above footer content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const contact = page.locator('[data-whatsapp-contact]');
    const footer = page.locator('.shop-footer');
    await footer.scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      const button = await contact.boundingBox();
      const rectangle = await footer.boundingBox();
      return button.y + button.height <= rectangle.y - 11;
    }).toBe(true);
    const button = await contact.boundingBox();
    expect(button.y).toBeGreaterThanOrEqual(12);
    await expect(contact.getByRole('link')).toBeVisible();
    await page.screenshot({ path: `test-results/whatsapp-footer-${width}.png` });
  });
}

test('reduced motion skips the intro and removes transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freezeBeforeLoad(page);
  const contact = page.locator('[data-whatsapp-contact]');
  const label = contact.locator('.whatsapp-contact__label');
  await page.clock.runFor(5000);
  await expect(contact).not.toHaveClass(/is-revealed/);
  await expect(label).toHaveCSS('transition-duration', '0s');
  await contact.getByRole('link').focus();
  await expect(label).toHaveCSS('opacity', '1');
});

test.describe('touch device', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('uses a 40px icon at 14px edges without requiring hover', async ({ page }) => {
    await freezeBeforeLoad(page);
    const contact = page.locator('[data-whatsapp-contact]');
    const box = await contact.boundingBox();
    expect(box.width).toBe(40);
    expect(box.height).toBe(40);
    expect(390 - box.x - box.width).toBe(14);
    expect(844 - box.y - box.height).toBe(14);
    await page.clock.runFor(400);
    await expect(contact).toHaveClass(/is-revealed/);
    await page.clock.runFor(2450);
    await expect(contact).not.toHaveClass(/is-revealed/);
    await expect(contact.getByRole('link')).toBeVisible();
  });
});
