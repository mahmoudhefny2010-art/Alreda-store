const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { buildVariantEditor } = require('../../src/services/variant-editor.service');

const image = `https://res.cloudinary.com/${require('../../src/config/cloudinary-media.json').cloudName}/image/upload/test/variant.jpg`;
const ids = ['26be682a-af63-42d3-8903-b9f0db579cb2', '4f273d5c-117f-4aed-a940-f1d7e8ad6396'];

for (const locale of ['en', 'ar']) for (const width of [390, 1280]) {
  test(`variant matrix editing is clear and responsive (${locale}, ${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/assets/**', route => route.fulfill({ path: path.resolve('src/public', new URL(route.request().url()).pathname.slice('/assets/'.length)) }));
    const editing = { id: 'product-id', source_id: 'custom-product', image_url: image,
      catalog_details: { presentation: { variantEditor: { enabled: true, options: [{ name: 'Color', nameAr: 'اللون' }, { name: 'Type', nameAr: 'النوع' }], ids }, variantOffers: { [ids[1]]: 600 } } },
      product_images: [{ source_id: 'image-id', secure_url: image }],
      product_variants: ids.map((id, index) => ({ id, source_id: `admin-matrix-${id}`, options: JSON.stringify([index ? 'Gold' : 'Black', index ? 'Double' : 'Single']), price_egp: index ? 700 : 500, stock_quantity: index ? 3 : 4, is_available: true, title_ar: index ? 'ذهبي / مزدوج' : 'أسود / مفرد', source_image_id: 'image-id' })) };
    const html = await ejs.renderFile(path.resolve('src/views/admin/variant-editor.ejs'), { locale, editing, buildVariantEditor });
    await page.route('**/variant-matrix-editor', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/pages/admin-variant-editor.css"><style>*{box-sizing:border-box}body{margin:0}</style></head><body><main><form class="admin-form"><input name="priceEgp" value="500"><input name="stock" value="7"><input data-image-urls type="hidden" value="${image}"><input data-color-variants type="hidden" value="[]"><label class="admin-check presentation-type-toggle"><input type="checkbox" data-manage-types>Old types</label>${html}</form></main><script src="/assets/js/admin-variant-editor.js"></script></body></html>` }));
    await page.goto('/variant-matrix-editor');
    await expect(page.locator('.variant-combination-card')).toHaveCount(2);
    await expect(page.locator('[data-variant-stock]').first()).toHaveValue('4');
    await expect(page.locator('[data-variant-price]').nth(1)).toHaveValue('700');
    await expect(page.locator('[data-variant-offer]').nth(1)).toHaveValue('600');
    await page.locator('.variant-generator summary').click();
    await page.getByRole('button', { name: locale === 'ar' ? 'إضافة بُعد للاختيار' : 'Add option dimension' }).click();
    await page.locator('[data-variant-values="2"]').fill('50 cm, 60 cm');
    await page.getByRole('button', { name: locale === 'ar' ? 'إنشاء الاختيارات الناقصة' : 'Generate missing combinations' }).click();
    await expect(page.locator('.variant-combination-card')).toHaveCount(8);
    expect(JSON.parse(await page.locator('[data-variant-editor-value]').inputValue()).rows.find(row => row.values.includes('50 cm') && row.values.includes('Single')).stock).toBe(4);
    const overflow = await page.evaluate(() => ({ document:document.documentElement.scrollWidth, viewport:innerWidth, elements:[...document.querySelectorAll('body *')].filter(node=>{const r=node.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1;}).slice(0,8).map(node=>({tag:node.tagName,cls:node.className,right:Math.round(node.getBoundingClientRect().right),left:Math.round(node.getBoundingClientRect().left),width:Math.round(node.getBoundingClientRect().width),parent:node.parentElement?.outerHTML.slice(0,200),box:getComputedStyle(node).boxSizing})) }));
    expect(overflow.document <= overflow.viewport, JSON.stringify(overflow)).toBe(true);
  });
}
