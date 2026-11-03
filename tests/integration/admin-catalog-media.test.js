const request = require('supertest');
const express = require('express');
const sharp = require('sharp');
const path = require('node:path');
const ejs = require('ejs');
const { createAdminManagementRoutes } = require('../../src/routes/admin-management.routes');
const { colorOptions, resolveColorSwatches } = require('../../src/config/catalog-colors');
const sanitizeDescription = require('../../src/utils/sanitizeProductDescription');

const adminId = 'd2e4097a-4c78-44c8-b411-9ed4acec2380';
const categoryId = '1ac93ec3-2e14-4a25-a187-cc67d68fa331';
const productId = '26be682a-af63-42d3-8903-b9f0db579cb2';
function appFor({ authenticated = true } = {}) {
  const calls = [];
  const cloudinaryService = Object.fromEntries(['uploadCategoryImage', 'uploadProductMainImage', 'uploadProductGalleryImage'].map(method => [method, async (buffer, input) => {
    calls.push({ method, size: buffer.length, input });
    return { secureUrl: `https://res.cloudinary.com/test/image/upload/${input.entityId}/${calls.length}.jpg`, width: 32, height: 48, format: 'jpeg' };
  }]));
  const identities = { principal: async id => ({ id, role: 'admin', user_roles: [], admin_permissions: [] }) };
  const saves = [];
  const removedOffers = [];
  const setOffers = [];
  const repository = { saveProduct: async (actorId, data) => saves.push({ actorId, data }), catalog: async () => ({ categories: [{ id: categoryId, name: 'Bathroom', name_ar: 'حمام' }], sections: [], details: [], products: [
    { id: productId, name: 'Primary item', name_ar: 'منتج أساسي', category_id: categoryId, product_categories: [{ category_id: categoryId }], product_images: [], image_url: '', stock_quantity: 2, price_egp: 500 },
    { id: adminId, name: 'Assigned item', name_ar: 'منتج مرتبط', category_id: null, product_categories: [{ category_id: categoryId }], product_images: [], image_url: '', stock_quantity: 1, price_egp: 250 },
  ] }) };
  repository.discounts = async () => [];
  repository.setProductOffer = async (actorId, id, price) => setOffers.push({ actorId, id, price });
  repository.productOffers = async () => (await repository.catalog()).products.filter(item => item.sale_price_egp != null);
  repository.removeProductOffer = async (actorId, id) => removedOffers.push({ actorId, id });
  const catalog = repository.catalog;
  repository.catalog = async () => { const data = await catalog(); data.products[0].sale_price_egp = 350; return data; };
  const management = createAdminManagementRoutes({ identities, cloudinaryService, csrfSecret: 'synthetic-csrf-secret-that-is-at-least-32-characters', authenticate: req => authenticated && req.customer ? { userId: req.customer.id } : null, repository });
  const app = express();
  app.use((req, res, next) => {
    req.customer = authenticated ? { id: adminId } : null;
    req.customerSessionToken = authenticated ? 'synthetic-admin-session-token' : '';
    const getHeader = req.get.bind(req);
    req.get = name => name.toLowerCase() === 'host' ? 'store.test' : getHeader(name);
    res.locals.a = key => key;
    res.render = (view, data) => res.json({ view, contentView: data.contentView, selectedCategory: data.selectedCategory || '', productIds: data.products?.map(item => item.id) || [], offerProductIds: data.offerProducts?.map(item => item.id) || [], editingId: data.editing?.id || '', csrfToken: data.csrfToken || '', savedMessage: data.savedMessage || '' });
    next();
  });
  app.use(express.urlencoded({ extended: false }));
  app.use(management);
  return { app, calls, saves, removedOffers, setOffers };
}
const png = () => sharp({ create: { width: 32, height: 48, channels: 3, background: '#abc' } }).png().toBuffer();

describe('admin catalog Cloudinary image upload', () => {
  it('shows database-backed offers and confirms removal', async () => {
    const { app, removedOffers } = appFor();
    const listing = await request(app).get('/admin/promotions').expect(200);
    expect(listing.body.offerProductIds).toEqual([productId]);
    await request(app).post(`/admin/promotions/products/${productId}/remove`).type('form').send({ _csrf: listing.body.csrfToken }).expect(303);
    expect(removedOffers).toEqual([{ actorId: adminId, id: productId }]);
    const confirmation = await request(app).get('/admin/promotions?saved=offer-removed').expect(200);
    expect(confirmation.body.savedMessage).toBe('offerRemoved');
  });

  it('saves a direct product offer from the searchable product card', async () => {
    const { app, setOffers } = appFor();
    const listing = await request(app).get('/admin/promotions').expect(200);
    await request(app).post(`/admin/promotions/products/${productId}/offer`).type('form').send({ _csrf: listing.body.csrfToken, salePriceEgp: '350' }).expect(303);
    expect(setOffers).toEqual([{ actorId: adminId, id: productId, price: 350 }]);
    const confirmation = await request(app).get('/admin/promotions?saved=offer-set').expect(200);
    expect(confirmation.body.savedMessage).toBe('offerSaved');
  });

  it('saves stock when a known Arabic product type can be completed locally', async () => {
    const { app, saves } = appFor();
    const response = await request(app).post('/admin/catalog/products').set('Origin', 'http://store.test').type('form').send({
      id: productId, name: 'Primary item', nameAr: '\u0645\u0646\u062a\u062c \u0623\u0633\u0627\u0633\u064a', description: '', descriptionAr: '', categoryId,
      priceEgp: '500', salePriceEgp: '350', stock: '10', color: '', colorAr: '', colorVariants: '[]', type: 'Bathroom Accessories', typeAr: '',
      presentation: '{}', images: 'https://res.cloudinary.com/pjwlhib7/image/upload/test/product.jpg', available: 'on',
    }).expect(303);
    expect(response.headers.location).toBe('/admin/catalog?saved=product');
    const confirmation = await request(app).get('/admin/catalog?saved=product').expect(200);
    expect(confirmation.body.savedMessage).toBe('productSaved');
    expect(saves).toHaveLength(1);
    expect(saves[0].data.stock).toBe(10);
    expect(saves[0].data.salePriceEgp).toBe(350);
    expect(saves[0].data.typeAr).toMatch(/[\u0600-\u06ff]/u);
  });

  it('renders image-led category and product cards and a safe rich description editor', async () => {
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin/catalog.ejs'), {
      a: key => key, locale: 'en', colorOptions, resolveColorSwatches, categories: [{ id: adminId, slug: 'bathroom', name: 'Bathroom', name_ar: 'حمام', image_url: '', previewImage: '/assets/images/collections/sample.webp' }],
      sections: [], products: [], editing: { id: adminId, name: 'Example', name_ar: 'مثال', description: '<p><strong>Clean text</strong></p><script>alert(1)</script>', description_ar: '',
        catalog_details: {}, category_id: adminId, product_images: [], image_url: '/assets/images/product.webp', price_egp: 500, sale_price_egp: 350, stock_quantity: 4, is_available: true }, selectedCategory: '', sanitizeDescription,
    });
    expect(html).not.toContain('catalog-category-grid');
    expect(html).toContain('contenteditable="true"');
    expect(html).toContain('<strong>Clean text</strong>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('data-image-files');
    expect(html).toContain('name="salePriceEgp"');
    expect(html).toContain('value="350"');
    const categoryHtml = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin/catalog.ejs'), {
      a: key => key, locale: 'en', colorOptions, resolveColorSwatches, categories: [{ id: adminId, slug: 'bathroom', name: 'Bathroom', name_ar: 'حمام', image_url: '/assets/images/collections/sample.webp' }],
      sections: [], products: [], editing: null, selectedCategory: '', sanitizeDescription,
    });
    expect(categoryHtml).toContain('catalog-category-card');
    expect(categoryHtml).toContain('sample.webp');
  });

  it('renders offers as a concise product list with a direct remove action', async () => {
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin/promotions.ejs'), {
      a: key => key, locale: 'en', csrfToken: 'synthetic-csrf-token', savedMessage: '', offerProducts: [{ id: productId, name: 'Offer item', name_ar: 'منتج عرض', price_egp: 500, sale_price_egp: 350, offer_source: 'product', product_images: [], image_url: '' },
        { id: adminId, name: 'Variant offer', name_ar: 'عرض لون', price_egp: 2250, sale_price_egp: 1250, offer_regular_price_egp: 2250, offer_source: 'variant', offer_variants: [{ title: 'Black', title_ar: 'أسود', sale_price_egp: 1250, regular_price_egp: 2250 }], product_images: [], image_url: '' }],
      products: [{ id: adminId, name: 'Bathroom towel set', name_ar: 'طقم مناشف', category_id: categoryId, price_egp: 450, image_url: 'https://res.cloudinary.com/pjwlhib7/image/upload/store/towel-set.jpg', product_images: [] }], categories: [{ id: categoryId, name: 'Bathroom collection', name_ar: 'مجموعة الحمام', slug: 'bathroom', image_url: 'https://res.cloudinary.com/pjwlhib7/image/upload/store/bathroom.jpg' }], details: [], discounts: [],
    });
    expect(html).toContain('Offer item');
    expect(html).toContain('EGP 350');
    expect(html).toContain('Variant offer'); expect(html).toContain('Black:'); expect(html).toContain('EGP 1250');
    expect(html).toContain(`/admin/promotions/products/${productId}/remove`);
    expect(html).toContain('<details class="workspace-panel admin-campaigns">');
    expect(html).toContain('admin-campaign-category-card');
    expect(html).toContain('value="' + categoryId + '"');
    expect(html).toContain('bathroom.jpg');
    expect(html).toContain('data-product-search');
    expect(html).toContain('admin-campaign-product-card');
    expect(html).toContain('towel-set.jpg');
  });

  it('requires the verified catalog permission before accepting image files', async () => {
    const { app } = appFor({ authenticated: false });
    await request(app).post('/api/admin/catalog/images').set('Origin', 'http://store.test').field('kind', 'product').field('entityId', 'draft').attach('images', await png(), 'item.png').expect(401);
  });

  it('uploads a product gallery to Cloudinary and returns safe URLs for the catalog save form', async () => {
    const { app, calls } = appFor();
    const response = await request(app).post('/api/admin/catalog/images').set('Origin', 'http://store.test').field('kind', 'product').field('entityId', 'draft-product-1')
      .attach('images', await png(), 'front.png').attach('images', await png(), 'side.png').expect(200);
    expect(calls.map(call => call.method)).toEqual(['uploadProductMainImage', 'uploadProductGalleryImage']);
    expect(response.body.images).toHaveLength(2);
    expect(response.body.images[0].secureUrl).toContain('res.cloudinary.com');
    expect(response.body).not.toHaveProperty('api_secret');
  });

  it('uploads one category image under a validated slug', async () => {
    const { app, calls } = appFor();
    const response = await request(app).post('/api/admin/catalog/images').set('Origin', 'http://store.test').field('kind', 'category').field('entityId', 'bathroom')
      .field('slug', 'bathroom-accessories').attach('images', await png(), 'category.png').expect(200);
    expect(calls[0].method).toBe('uploadCategoryImage');
    expect(calls[0].input.slug).toBe('bathroom-accessories');
    expect(response.body.images).toHaveLength(1);
  });

  it('offers reusable color presets and shows saved colors on admin product cards', async () => {
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin/catalog.ejs'), {
      a: key => key, locale: 'en', colorOptions, resolveColorSwatches, sanitizeDescription,
      categories: [{ id: categoryId, name: 'Bathroom', name_ar: 'حمام', slug: 'bathroom', image_url: '' }], sections: [], editing: null, selectedCategory: '', savedMessage: 'productSaved',
      products: [{ id: productId, name: 'Color sample', name_ar: 'عينة لون', category_id: categoryId, catalog_details: { color_en: 'Black, Gold' }, product_images: [], image_url: '', stock_quantity: 2, price_egp: 300 }],
    });
    expect(html).toContain('data-catalog-color-picker');
    expect(html).toContain('data-color-en="Black"');
    expect(html).toContain('data-color-ar="أسود"');
    expect(html).toContain('catalog-card-colors');
    expect(html).toContain('catalog-save-success');
    expect(html).toContain('catalog-stock-left');
    expect(html).toContain('remainingStock');
    expect(html).toContain('>2</strong>');
    expect(html).toContain('style="--swatch-color:#c5a35c"');
  });

  it('preselects saved color variants with their own Cloudinary photos and per-color stock', async () => {
    const blackImage = 'https://res.cloudinary.com/pjwlhib7/image/upload/store/black.jpg';
    const goldImage = 'https://res.cloudinary.com/pjwlhib7/image/upload/store/gold.jpg';
    const html = await ejs.renderFile(path.resolve(__dirname, '../../src/views/admin/catalog.ejs'), {
      a: key => key, locale: 'en', colorOptions, resolveColorSwatches, sanitizeDescription,
      categories: [{ id: categoryId, name: 'Bathroom', name_ar: 'حمام', slug: 'bathroom', image_url: '' }], sections: [], products: [], selectedCategory: '',
      editing: { id: productId, name: 'Color sample', name_ar: 'عينة', description: '', description_ar: '', category_id: categoryId, image_url: blackImage,
        catalog_details: { color_en: 'Black, Gold', color_ar: 'أسود, ذهبي', type_en: '', type_ar: '' },
        product_images: [{ source_id: 'photo-black', secure_url: blackImage }, { source_id: 'photo-gold', secure_url: goldImage }],
        product_variants: [
          { options: '["Black"]', source_image_id: 'photo-black', stock_quantity: 3 },
          { options: '["Gold"]', source_image_id: 'photo-gold', stock_quantity: 2 },
        ],
      },
    });
    expect(html).toMatch(/data-color-en="Black"[^>]+aria-pressed="true"/);
    expect(html).toMatch(/data-color-en="Gold"[^>]+aria-pressed="true"/);
    expect(html).toContain('black.jpg');
    expect(html).toContain('gold.jpg');
    expect(html).toContain('&#34;stock&#34;:3');
    expect(html).toContain('&#34;stock&#34;:2');
  });

  it('opens a category-only product page and a separate edit route', async () => {
    const { app } = appFor();
    const category = await request(app).get(`/admin/catalog?category=${categoryId}`).expect(200);
    expect(category.body.selectedCategory).toBe(categoryId);
    expect(category.body.productIds).toEqual([productId, adminId]);
    const edit = await request(app).get(`/admin/catalog/products/${productId}/edit`).expect(200);
    expect(edit.body.editingId).toBe(productId);
  });
});
