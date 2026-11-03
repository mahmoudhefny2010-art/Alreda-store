const { randomUUID } = require('node:crypto');
const request = require('supertest');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const { startOrderDatabase } = require('../helpers/order-database');
const { createOrderRepository } = require('../../src/repositories/order.repository');
const { createOrderService } = require('../../src/services/order.service');
const { createApp } = require('../../src/app');
const { createAdminManagementRepository } = require('../../src/repositories/admin-management.repository');
const policy = { enabled:true, origin:'http://store.test', shippingRates:{ Cairo:25 } };
const logger = { error: vi.fn() };
let database, repository, owner, admin, stranger;
beforeAll(async () => {
  database = await startOrderDatabase(); repository = createOrderRepository(() => database.client);
  [owner,admin,stranger] = await Promise.all(['customer','admin','customer'].map(role => database.client.users.create({ data:{ name:'Synthetic account',email:`${randomUUID()}@example.invalid`,role } })));
},120000);
afterAll(async () => database?.stop(),30000);
const service = extra => createOrderService({ repository,policy,logger,instapay:{ enabled:true },...extra });
async function fixture(userId = owner.id) {
  const item = await database.client.products.create({ data:{ name:'Synthetic item',name_ar:'منتج تجريبي',slug:randomUUID(),price_egp:100,stock_quantity:5 } });
  const proof = await repository.createProof(userId,{ public_id:`synthetic/${randomUUID()}`,content_hash:randomUUID().replaceAll('-','').repeat(2),format:'png' });
  return { item,proof,input:{ customer:{ name:'Synthetic Buyer',email:'buyer@example.invalid',phone:'01000000000' },shipping:{ country:'EG',city:'Cairo',address:'Synthetic address' },items:[{ productId:item.id,quantity:1,unitPriceEgp:100 }],expectedTotalEgp:125,paymentMethod:'INSTAPAY',paymentProofId:proof.id } };
}
function app(userId,proofMedia = {}) { return createApp({ environment:'test',mediaSettings:{},whatsappSettings:{},authSettings:{},logger,orders:{ repository,policy,authenticate:async()=>userId?{userId}:null,instapay:{enabled:true},proofMedia } }); }
it('persists isolated color offers and uses the same price and selected inventory at checkout',async()=>{
  const f=await fixture();
  await database.client.products.update({where:{id:f.item.id},data:{stock_quantity:10}});
  const variants=await Promise.all(['Black','Gold'].map((color,index)=>database.client.product_variants.create({data:{product_id:f.item.id,source_id:randomUUID(),title:color,options:JSON.stringify([color]),price_egp:index?130:100,stock_quantity:5,is_available:true}})));
  const management=createAdminManagementRepository(()=>database.client);
  await expect(management.setColorOffer(owner.id,f.item.id,'Black',80)).rejects.toThrow('ADMIN_REQUIRED');
  await expect(management.setColorOffer(admin.id,f.item.id,'Black',100)).rejects.toThrow('OFFER_PRICE_MUST_BE_LOWER');
  await management.setColorOffer(admin.id,f.item.id,'Black',80);
  expect((await database.client.catalog_details.findUnique({where:{product_id:f.item.id}})).presentation.colorOffers).toEqual({Black:80});
  const {paymentProofId,...input}=f.input; expect(paymentProofId).toBeTruthy();
  const result=await service().submit(owner.id,randomUUID(),{...input,paymentMethod:'CASH_ON_DELIVERY',expectedTotalEgp:105,items:[{productId:f.item.id,variantId:variants[0].id,quantity:1,unitPriceEgp:80}]});
  expect(result.confirmed).toBe(true); expect(result.order.totalEgp).toBe(105);
  expect((await database.client.product_variants.findUnique({where:{id:variants[0].id}})).stock_quantity).toBe(4);
  expect((await database.client.product_variants.findUnique({where:{id:variants[1].id}})).stock_quantity).toBe(5);
  expect((await management.productOffers()).find(row=>row.id===f.item.id).offer_variants[0].sale_price_egp).toBe(80);
  await management.setColorOffer(admin.id,f.item.id,'Black',null);
  expect((await database.client.catalog_details.findUnique({where:{product_id:f.item.id}})).presentation.colorOffers).toEqual({});
});
it('shows database-backed customer history and rejects access to another customer order',async()=>{
  const f = await fixture(), result = await service().submit(owner.id, randomUUID(), f.input);
  const mine = await request(app(owner.id)).get('/account/orders');
  expect(mine.status).toBe(200); expect(mine.headers['cache-control']).toContain('no-store');
  expect(mine.text).toContain(result.order.reference);
  const detail = await request(app(owner.id)).get(`/account/orders/${result.order.id}`);
  expect(detail.status).toBe(200); expect(detail.text).toContain('Awaiting payment review');
  expect(detail.text).not.toContain('payment-proofs/');
  const other = await request(app(stranger.id)).get(`/account/orders/${result.order.id}`);
  expect(other.status).toBe(404); expect(other.text).not.toContain(result.order.reference);
  expect((await request(app(null)).get('/account/orders')).status).toBe(401);
  const injected = await request(app(stranger.id)).get(`/account/orders?userId=${owner.id}`);
  expect(injected.status).toBe(400);
  expect((await repository.listCustomerOrders(stranger.id, 1)).some(row=>row.id===result.order.id)).toBe(false);
});
it('keeps order history accessible when new checkout is disabled and validates pagination',async()=>{
  const disabled = createApp({environment:'test',mediaSettings:{},whatsappSettings:{},authSettings:{},logger,orders:{repository,policy:{enabled:false},authenticate:async()=>({userId:owner.id})}});
  expect((await request(disabled).get('/account/orders')).status).toBe(200);
  expect((await request(disabled).get('/account/orders?page=-1')).status).toBe(400);
  expect((await request(disabled).get('/account/orders/not-a-uuid')).status).toBe(404);
});
it('filters administrator order cards in PostgreSQL and keeps private details on the detail page',async()=>{
  const f = await fixture(), result = await service().submit(owner.id, randomUUID(), f.input);
  const administration = app(admin.id);
  const found = await request(administration).get('/admin/orders').query({q:result.order.reference,status:'PLACED',payment:'UNPAID',method:'INSTAPAY'});
  expect(found.status).toBe(200); expect(found.text).toContain('admin-order-card'); expect(found.text).toContain(result.order.reference);
  expect(found.text).not.toContain('Synthetic address'); expect(found.text).not.toContain('payment-review');
  const absent = await request(administration).get('/admin/orders').query({q:result.order.reference,payment:'PAID'});
  expect(absent.status).toBe(200); expect(absent.text).not.toContain(`<bdi>${result.order.reference}</bdi>`);
  expect((await repository.listAdminOrders(undefined,{q:result.order.reference,method:'CASH_ON_DELIVERY'})).length).toBe(0);
  expect((await request(administration).get('/admin/orders?status=INVALID')).status).toBe(400);
  expect((await request(app(owner.id)).get('/admin/orders')).status).toBe(403);
});
it('requires an owned, unused and unexpired proof before creating an InstaPay order',async()=>{
  const f = await fixture(stranger.id);
  await expect(service().submit(owner.id,randomUUID(),f.input)).rejects.toMatchObject({code:'PAYMENT_PROOF_REQUIRED'});
  const own = await fixture();
  await database.client.payment_proofs.update({where:{id:own.proof.id},data:{expires_at:new Date(0)}});
  await expect(service().submit(owner.id,randomUUID(),own.input)).rejects.toMatchObject({code:'PAYMENT_PROOF_REQUIRED'});
  const {paymentProofId,...missing} = own.input;
  expect(paymentProofId).toBeTruthy();
  await expect(service().submit(owner.id,randomUUID(),missing)).rejects.toMatchObject({code:'INVALID_ORDER'});
  expect((await database.client.products.findUnique({where:{id:f.item.id}})).stock_quantity).toBe(5);
});
it('records the order as awaiting review, never paid/confirmed, and reconciles retries without another stock deduction',async()=>{
  const f = await fixture(), key = randomUUID();
  const result = await service().submit(owner.id,key,f.input);
  expect(result).toMatchObject({state:'awaiting_admin_confirmation',confirmed:false,recorded:true});
  expect(result.order.paymentStatus).toBe('UNPAID');
  const again = await service().submit(owner.id,key,f.input); expect(again.order.id).toBe(result.order.id);
  expect((await database.client.products.findUnique({where:{id:f.item.id}})).stock_quantity).toBe(4);
  const proof = await repository.proofForAdmin(result.order.id); expect(proof.status).toBe('PENDING');
  await expect(service().submit(owner.id,randomUUID(),f.input)).rejects.toMatchObject({code:'PAYMENT_PROOF_REQUIRED'});
  await expect(repository.updateStatus(result.order.id,'CONFIRMED',admin.id)).rejects.toMatchObject({code:'PAYMENT_REVIEW_REQUIRED'});
});
it('requires manual verification and a unique bank reference before admin approval confirms payment',async()=>{
  const f = await fixture(), key = randomUUID(), result = await service().submit(owner.id,key,f.input);
  const administration = app(admin.id);
  await request(administration).post(`/admin/orders/${result.order.id}/payment-review`).set('Origin',policy.origin).set('Host','store.test').type('form').send({decision:'APPROVE',reference:'TEST-REF-001'}).expect(400);
  await request(app(owner.id)).post(`/admin/orders/${result.order.id}/payment-review`).set('Origin',policy.origin).set('Host','store.test').type('form').send({decision:'APPROVE',reference:'TEST-REF-001',verified:'on'}).expect(403);
  await request(administration).post(`/admin/orders/${result.order.id}/payment-review`).set('Origin',policy.origin).set('Host','store.test').type('form').send({decision:'APPROVE',reference:'TEST-REF-001',verified:'on'}).expect(303);
  await repository.reviewProof(result.order.id,admin.id,'APPROVE','TEST-REF-001');
  const confirmed = await service().reconcile(owner.id,key); expect(confirmed.confirmed).toBe(true); expect(confirmed.order.paymentStatus).toBe('PAID');
  const other = await fixture(), pending = await service().submit(owner.id,randomUUID(),other.input);
  await expect(repository.reviewProof(pending.order.id,admin.id,'APPROVE','TEST-REF-001')).rejects.toMatchObject({code:'PAYMENT_REFERENCE_USED'});
  expect((await repository.getAdminOrder(pending.order.id)).payment_status).toBe('UNPAID');
  expect((await repository.proofForAdmin(pending.order.id)).status).toBe('PENDING');
});
it('rejects proofs atomically, restores stock once and prevents later approval',async()=>{
  const f = await fixture(),key=randomUUID(),result=await service().submit(owner.id,key,f.input);
  await expect(repository.reviewProof(result.order.id,owner.id,'REJECT','')).rejects.toMatchObject({code:'ADMIN_REQUIRED'});
  await repository.reviewProof(result.order.id,admin.id,'REJECT','');
  await repository.reviewProof(result.order.id,admin.id,'REJECT','');
  expect((await database.client.products.findUnique({where:{id:f.item.id}})).stock_quantity).toBe(5);
  expect((await service().reconcile(owner.id,key)).state).toBe('cancelled');
  await expect(repository.reviewProof(result.order.id,admin.id,'APPROVE','OTHER-REF')).rejects.toMatchObject({code:'PAYMENT_REVIEW_CONFLICT'});
});
it('rolls back stock and leaves proof unused when totals fail validation',async()=>{
  const f = await fixture();
  await expect(service().submit(owner.id,randomUUID(),{...f.input,expectedTotalEgp:1})).rejects.toMatchObject({code:'PRICE_CHANGED'});
  expect((await database.client.products.findUnique({where:{id:f.item.id}})).stock_quantity).toBe(5);
  expect((await database.client.payment_proofs.findUnique({where:{id:f.proof.id}})).status).toBe('UPLOADED');
});
it('recovers a commit timeout as awaiting admin review rather than confirmation or a replacement order',async()=>{
  const f=await fixture(),key=randomUUID();
  const timeout={...repository,create:async args=>{await repository.create(args);throw new Error('synthetic timeout');}};
  const first=await service({repository:timeout}).submit(owner.id,key,f.input);
  expect(first.state).toBe('awaiting_admin_confirmation'); expect(first.confirmed).toBe(false);
  expect((await service().submit(owner.id,key,f.input)).order.id).toBe(first.order.id);
});
it('serves proof bytes only to authorized admins and never exposes the Cloudinary identifier or URL in public responses',async()=>{
  const f=await fixture(),result=await service().submit(owner.id,randomUUID(),f.input);
  const image=await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();
  const media={read:vi.fn(async()=>image)};
  await request(app(owner.id,media)).get(`/admin/orders/${result.order.id}/payment-proof`).expect(403);
  await request(app(null,media)).get(`/admin/orders/${result.order.id}/payment-proof`).expect(401);
  await request(app(admin.id,media)).get(`/admin/orders/${result.order.id}/payment-proof`).expect(200).expect('Content-Type',/image\/png/).expect('Cache-Control','private, no-store');
  const html=await request(app(admin.id)).get(`/admin/orders/${result.order.id}`).expect(200);
  expect(html.text).toContain('Approve payment and confirm order'); expect(JSON.stringify(result)).not.toContain(f.proof.public_id);
});
it('accepts an authenticated screenshot upload and persists only private media metadata',async()=>{
  const uploader=await database.client.users.create({data:{name:'Synthetic uploader',email:`${randomUUID()}@example.invalid`,role:'customer'}});
  const image=await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();
  const media={upload:vi.fn(async()=>({public_id:`synthetic/${randomUUID()}`,content_hash:randomUUID().replaceAll('-','').repeat(2),format:'png'})),remove:vi.fn(async()=>{})};
  const response=await request(app(uploader.id,media)).post('/api/payments/instapay/proof').set('X-Requested-With','alreda-checkout').attach('proof',image,'receipt.png').expect(201);
  expect(response.body.proofId).toMatch(/^[0-9a-f-]{36}$/); expect(response.body).not.toHaveProperty('public_id');
  const stored=await database.client.payment_proofs.findUnique({where:{id:response.body.proofId}});expect(stored.user_id).toBe(uploader.id);expect(stored.status).toBe('UPLOADED');
  await request(app(uploader.id,media)).post('/api/payments/instapay/proof').set('Sec-Fetch-Site','cross-site').set('X-Requested-With','alreda-checkout').attach('proof',image,'receipt.png').expect(403);
});
it('refuses migration rollback after proof/order data exists',async()=>{
  const sql=fs.readFileSync(path.resolve('prisma/proposed/instapay-review.rollback.sql'),'utf8');
  await expect(database.sql.query(sql)).rejects.toThrow(); await database.sql.query('ROLLBACK');
  expect(await database.client.payment_proofs.count()).toBeGreaterThan(0);
});
