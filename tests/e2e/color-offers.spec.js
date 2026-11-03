const { test, expect } = require('@playwright/test');
const ejs = require('ejs');
const path = require('node:path');
const { colorOptions } = require('../../src/config/catalog-colors');
const { adminText } = require('../../src/config/admin-i18n');
const { createAdminManagementRepository } = require('../../src/repositories/admin-management.repository');
for (const locale of ['en', 'ar']) for (const width of [390, 1440]) {
  test(`color editor offers and existing promotion cards ${locale} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/assets/**', route => route.fulfill({ path: path.resolve('src/public', new URL(route.request().url()).pathname.slice('/assets/'.length)) }));
    const a=key=>adminText(locale,key);
    const initial=[{color:'Black',imageUrl:'/synthetic-photo.svg',stock:10,priceEgp:1000,salePriceEgp:800},{color:'Gold',imageUrl:'/synthetic-photo.svg',stock:9,priceEgp:null,salePriceEgp:null}];
    await page.route('**/synthetic-photo.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#ddd"/></svg>'}));
    const choices=colorOptions.slice(0,5).map(color=>`<button type="button" class="catalog-color-choice" data-color-choice data-color-en="${color.en}" data-color-ar="${color.ar}"><i class="catalog-color-dot" style="--swatch-color:${color.hex}"></i>${locale==='ar'?color.ar:color.en}</button>`).join('');
    await page.route('**/synthetic-color-offers',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="${locale}" dir="${locale==='ar'?'rtl':'ltr'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/pages/admin-catalog.css"></head><body><div class="admin-management" data-admin-catalog><form class="admin-form"><label>${a('price')}<input name="priceEgp" value="1000"></label><input data-image-urls type="hidden" value="/synthetic-photo.svg"><fieldset class="catalog-color-picker" data-catalog-color-picker data-color-offer-label="${a('offerPrice')}" data-color-stock-label="${a('stock')}" data-existing-color-offers='{"Gold":900}'><legend>${a('chooseColor')}</legend><div class="catalog-color-options">${choices}</div><input data-color-variants type="hidden" value='${JSON.stringify(initial)}'><div data-color-image-list></div></fieldset></form></div><script src="/assets/js/admin-catalog.js"></script></body></html>`}));
    await page.goto('/synthetic-color-offers');
    await expect(page.locator('[data-color-offer]').first()).toHaveValue('800');
    await expect(page.locator('[data-color-offer]').nth(1)).toHaveValue('');
    await expect(page.locator('.catalog-color-current-offer')).toContainText('900');
    await page.locator('[data-color-offer]').first().fill('750');
    expect(JSON.parse(await page.locator('[data-color-variants]').inputValue())[0].salePriceEgp).toBe(750);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`alreda-store-verification-screenshots/color-offer-editor-${locale}-${width}.png`,fullPage:true});
    const product={id:'26be682a-af63-42d3-8903-b9f0db579cb2',name:'Synthetic bathroom set',name_ar:'طقم حمام تجريبي',price_egp:1000,sale_price_egp:null,catalog_details:{presentation:{colorOffers:{Gold:700}}},product_images:[],product_variants:[{title:'Black',title_ar:'أسود',options:'["Black"]',price_egp:800,compare_at_egp:1000},{title:'Gold',title_ar:'ذهبي',options:'["Gold"]',price_egp:1000,compare_at_egp:null}]};
    const offerProducts=await createAdminManagementRepository(()=>({products:{findMany:async()=>[product]},discount_rules:{findMany:async()=>[]}})).productOffers();
    const body=await ejs.renderFile(path.resolve('src/views/admin/promotions.ejs'),{locale,a,products:[product],offerProducts,categories:[],details:[],discounts:[],savedMessage:'',csrfToken:'synthetic-only',colorOptions});
    await page.route('**/synthetic-promotions',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="${locale}" dir="${locale==='ar'?'rtl':'ltr'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/assets/css/pages/admin-catalog.css"></head><body>${body}</body></html>`}));
    await page.goto('/synthetic-promotions');
    await expect(page.locator('.admin-offer-card')).toHaveCount(1);
    await expect(page.locator('.admin-offer-variant')).toHaveCount(2);
    await page.locator('.admin-offer-card .promotion-color-offers summary').click();
    await expect(page.locator('.admin-offer-card [name="salePriceEgp"]').nth(1)).toHaveValue('700');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`alreda-store-verification-screenshots/color-offer-dashboard-${locale}-${width}.png`,fullPage:true});
  });
}
