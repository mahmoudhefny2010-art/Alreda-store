const { variantPrice } = require('../../src/services/purchase-selection.service');
const { productSchema } = require('../../src/validators/admin.validator');
const { createAdminManagementRepository } = require('../../src/repositories/admin-management.repository');
const product = { id: '26be682a-af63-42d3-8903-b9f0db579cb2', price_egp: 500, sale_price_egp: null, catalog_details: { presentation: { colorOffers: { Black: 350 } } } };
const black = { title: 'Black', options: '["Black"]', price_egp: 500, compare_at_egp: null };
const gold = { title: 'Gold', options: '["Gold"]', price_egp: 600, compare_at_egp: null };
it('applies an offer only to the selected product color and keeps the best eligible price', () => {
  expect(variantPrice(product,black,[])).toBe(350);
  expect(variantPrice(product,gold,[])).toBe(600);
  expect(variantPrice({...product,sale_price_egp:300},black,[])).toBe(300);
  const rule={scope:'PRODUCT',target:product.id,mode:'PERCENT',amount:50,is_active:true,starts_at:new Date(Date.now()-1000),ends_at:new Date(Date.now()+60000)};
  expect(variantPrice(product,black,[rule])).toBe(250);
  expect(variantPrice({...product,catalog_details:{presentation:{}}},black,[])).toBe(500);
});
it('lists product color discounts alongside imported compare-at offers', async () => {
  const prisma={products:{findMany:async()=>[{...product,product_variants:[black,gold]}]},discount_rules:{findMany:async()=>[]}};
  const offers=await createAdminManagementRepository(()=>prisma).productOffers();
  expect(offers).toHaveLength(1); expect(offers[0].offer_variants).toEqual([expect.objectContaining({color:'Black',sale_price_egp:350,regular_price_egp:500})]);
});
const image='https://res.cloudinary.com/pjwlhib7/image/upload/test/image.jpg';
const input={name:'Test',nameAr:'تجربة',categoryId:'1ac93ec3-2e14-4a25-a187-cc67d68fa331',priceEgp:500,stock:5,images:image};
it('validates color offer prices against their own regular or inherited type price',()=>{
  const colors=value=>JSON.stringify([{color:'Black',imageUrl:image,stock:5,...value}]);
  expect(productSchema.parse({...input,colorVariants:colors({salePriceEgp:400})}).colorVariants[0].salePriceEgp).toBe(400);
  expect(()=>productSchema.parse({...input,colorVariants:colors({salePriceEgp:500})})).toThrow('OFFER_PRICE_MUST_BE_LOWER');
  expect(productSchema.parse({...input,colorVariants:colors({priceEgp:700,salePriceEgp:600})}).colorVariants[0].salePriceEgp).toBe(600);
  const presentation=JSON.stringify({manageTypes:true,types:[{en:'Single',ar:'مفرد',imageUrl:image,stock:1,priceEgp:300},{en:'Double',ar:'مزدوج',imageUrl:image,stock:1,priceEgp:500}]});
  expect(()=>productSchema.parse({...input,presentation,colorVariants:colors({salePriceEgp:400})})).toThrow('OFFER_PRICE_MUST_BE_LOWER');
});
