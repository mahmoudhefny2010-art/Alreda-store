const { Router } = require('express');
const { z } = require('zod');
const { orderIdentity } = require('../middleware/order-identity.middleware');
const { createOrderRepository } = require('../repositories/order.repository');
const { createAdminManagementRepository } = require('../repositories/admin-management.repository');
const { productSchema, categorySchema, homeSectionSchema, homepageLayoutSchema, discountSchema, offerPriceSchema, colorOfferSchema, grantSchema } = require('../validators/admin.validator');
const { readCloudinaryConfig } = require('../config/cloudinary');
const { createCloudinaryService } = require('../services/cloudinary.service');
const { createUploadMiddleware } = require('../middleware/upload.middleware');
const sanitizeDescription = require('../utils/sanitizeProductDescription');
const { colorOptions, resolveColorSwatches } = require('../config/catalog-colors');
const { sameOrigin } = require('./auth.routes');
const { typeOptions } = require('../config/catalog-types');
const { translateCatalogText } = require('../services/catalog-translation.service');
const { createAdminCsrfToken, verifyAdminCsrfToken } = require('../security/admin-csrf');

function adminErrorCode(error, requestPath = '') {
  if (error?.message === 'OFFER_PRICE_MUST_BE_LOWER') return 'OFFER_PRICE_MUST_BE_LOWER';
  if (error instanceof z.ZodError) {
    if (requestPath.startsWith('/admin/promotions')) {
      const fields = new Set(error.issues.flatMap(issue => issue.path).map(String));
      if (fields.has('nameAr')) return 'DISCOUNT_ARABIC_NAME_REQUIRED';
      if (fields.has('name')) return 'DISCOUNT_NAME_REQUIRED';
      if (fields.has('amount')) return 'DISCOUNT_AMOUNT_INVALID';
      if (fields.has('target')) return 'DISCOUNT_TARGET_REQUIRED';
      if (fields.has('startsAt') || fields.has('endsAt')) return 'DISCOUNT_DATES_INVALID';
    }
    return 'INVALID_INPUT';
  }
  if (error?.code === 'P2002') return 'DUPLICATE_VALUE';
  if (['P2003', 'P2025'].includes(error?.code)) return 'RELATED_RECORD_MISSING';
  if (['P1001', 'P1002', 'P2024'].includes(error?.code)) return 'DATABASE_UNAVAILABLE';
  if (['P2021', 'P2022'].includes(error?.code)) return 'DATABASE_SCHEMA_OUTDATED';
  return /^[A-Z_]{1,64}$/.test(error?.message || '') ? error.message : 'ADMIN_OPERATION_FAILED';
}

function createAdminManagementRoutes({ repository = createAdminManagementRepository(), identities = createOrderRepository(), authenticate = req => req.customer ? { userId: req.customer.id } : null, csrfSecret = '',
  cloudinaryService = createCloudinaryService({ config: readCloudinaryConfig(), authorize: context => Boolean(context?.verifiedCatalogAdmin) }) } = {}) {
  const router = Router();
  const guard = permission => orderIdentity({ authenticate, repository: identities, admin: true, permission });
  const roles = guard('roles'); const catalog = guard('catalog');
  router.use(['/admin/access', '/admin/catalog', '/admin/promotions', '/api/admin'], (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const origin = (req, res, next) => sameOrigin(req) ? next() : res.status(403).send('REQUEST_ORIGIN_REJECTED');
  const productSaveOrigin = (req, res, next) => sameOrigin(req)
    || verifyAdminCsrfToken(req.customerSessionToken, csrfSecret, req.body?._csrf)
    ? next() : res.status(403).send('REQUEST_ORIGIN_REJECTED');
  const uploadImages = createUploadMiddleware({ authorizeAdmin: req => Boolean(req.catalogUploadAuthorized) });
  function adminBackPath(path) {
    if (path.startsWith('/admin/catalog/homepage')) return '/admin/catalog/homepage';
    if (path.startsWith('/admin/catalog')) return '/admin/catalog';
    if (path.startsWith('/admin/promotions')) return '/admin/promotions';
    if (path.startsWith('/admin/access')) return '/admin/access';
    return '/admin';
  }
  async function bilingual(data) {
    const copy = { ...data };
    for (const key of ['name', 'description', 'color', 'type']) {
      if (key === 'type' && copy.type && !copy.typeAr) {
        const translated = translateCatalogText(copy.type, 'en');
        if (translated.complete) copy.typeAr = translated.translated;
      }
      if (copy[key] || copy[`${key}Ar`]) {
        z.string().trim().min(1).parse(copy[key]);
        z.string().trim().min(1).max({ name: 160, description: 10000, color: 100, type: 120 }[key]).parse(copy[`${key}Ar`]);
      }
    }
    return copy;
  }
  function render(res, view, data = {}) { return res.render('layouts/admin', { title: res.locals.a('title'), contentView: `../admin/${view}`, sanitizeDescription, ...data, colorOptions, resolveColorSwatches, typeOptions, buildVariantEditor:require('../services/variant-editor.service').buildVariantEditor }); }
  router.post('/api/admin/catalog/translate', catalog, origin, (req, res) => {
    const input = z.object({ text: z.string().trim().max(10000), source: z.enum(['en', 'ar']), rich: z.boolean().default(false) }).strict().parse(req.body);
    res.json(translateCatalogText(input.text, input.source, input.rich));
  });
  router.get('/admin/access', roles, async (req, res) => render(res, 'access', { grants: await repository.grants() }));
  router.post('/admin/access', roles, origin, async (req, res) => { const data = grantSchema.parse(req.body); await repository.grant(res.locals.orderUserId, data.email, data.role); res.redirect(303, '/admin/access'); });
  router.post('/admin/access/:id/revoke', roles, origin, async (req, res) => { await repository.revoke(res.locals.orderUserId, z.uuid().parse(req.params.id)); res.redirect(303, '/admin/access'); });
  router.get('/admin/catalog', catalog, async (req, res) => {
    const query = z.object({ edit: z.uuid().optional(), category: z.uuid().optional(), saved: z.enum(['product', 'category', 'archived']).optional() }).strict().parse(req.query);
    const data = await repository.catalog();
    render(res, 'catalog', { ...data, products: query.category ? data.products.filter(product => product.category_id === query.category || product.product_categories?.some(item => item.category_id === query.category)) : data.products,
      selectedCategory: query.category || '', editing: query.edit ? data.products.find(product => product.id === query.edit) || null : null,
      csrfToken: createAdminCsrfToken(req.customerSessionToken, csrfSecret), savedMessage: query.saved === 'product' ? 'productSaved' : query.saved === 'category' ? 'categorySaved' : query.saved === 'archived' ? 'archiveSaved' : '' });
  });
  router.get('/admin/catalog/archived', catalog, async (req, res) => {
    const query = z.object({ saved: z.enum(['archived', 'restored', 'deleted']).optional(), cleanup: z.enum(['queued']).optional() }).strict().parse(req.query);
    const data = await repository.catalog({ includeArchived: true });
    return render(res, 'archived-products', { ...data, csrfToken: createAdminCsrfToken(req.customerSessionToken, csrfSecret), savedMessage: query.saved || '', cleanupQueued: query.cleanup === 'queued' });
  });
  router.post('/admin/catalog/products/:id/archive', catalog, productSaveOrigin, async (req, res) => {
    await repository.archiveProduct(res.locals.orderUserId, z.uuid().parse(req.params.id));
    res.redirect(303, '/admin/catalog?saved=archived');
  });
  router.post('/admin/catalog/products/:id/restore', catalog, productSaveOrigin, async (req, res) => {
    await repository.restoreProduct(res.locals.orderUserId, z.uuid().parse(req.params.id));
    res.redirect(303, '/admin/catalog/archived?saved=restored');
  });
  router.post('/admin/catalog/products/:id/permanent-delete', catalog, productSaveOrigin, async (req, res) => {
    const result = await repository.permanentlyDeleteProduct(res.locals.orderUserId, z.uuid().parse(req.params.id));
    let cleanupQueued = result.queuedAssets > 0;
    if (cleanupQueued && typeof cloudinaryService.deleteCatalogAsset === 'function') {
      try {
        const jobs = await repository.pendingCloudinaryCleanupJobs(20);
        for (const job of jobs) {
          const cleanup = await cloudinaryService.deleteCatalogAsset({ public_id: job.public_id, asset_id: job.asset_id }, { verifiedCatalogAdmin: true });
          if (cleanup.deleted) await repository.completeCloudinaryCleanupJob(job.id);
          else await repository.retryCloudinaryCleanupJob(job.id, cleanup.code);
        }
        cleanupQueued = await repository.hasPendingCloudinaryCleanup(result.assetPublicIds);
      } catch { cleanupQueued = true; }
    }
    res.redirect(303, `/admin/catalog/archived?saved=deleted${cleanupQueued ? '&cleanup=queued' : ''}`);
  });
  router.get('/admin/catalog/products/:id/edit', catalog, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const data = await repository.catalog();
    const editing = data.products.find(product => product.id === id);
    if (!editing) return res.status(404).render('layouts/admin', { title: res.locals.a('error'), contentView: '../admin/message', code: 'RELATED_RECORD_MISSING', backPath: '/admin/catalog' });
    return render(res, 'catalog', { ...data, editing, selectedCategory: '', csrfToken: createAdminCsrfToken(req.customerSessionToken, csrfSecret) });
  });
  router.post('/api/admin/catalog/images', catalog, origin, (req, res, next) => {
    req.catalogUploadAuthorized = true;
    next();
  }, uploadImages, async (req, res, next) => {
    try {
      const kind = z.enum(['product', 'category']).parse(req.body.kind);
      if (kind === 'category' && req.files.length !== 1) throw new Error('ONE_CATEGORY_IMAGE_REQUIRED');
      const entityId = z.string().trim().min(1).max(200).parse(req.body.entityId);
      const slug = z.string().trim().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().parse(req.body.slug || undefined);
      const altText = z.string().trim().max(500).default('').parse(req.body.altText || '');
      const results = [];
      for (const [index, file] of req.files.entries()) {
        const input = kind === 'category' ? { slug, entityId, altText, displayOrder: index } : { entityId, altText, displayOrder: index };
        const asset = kind === 'category'
          ? await cloudinaryService.uploadCategoryImage(file.buffer, input, { verifiedCatalogAdmin: true, userId: res.locals.orderUserId })
          : await (index === 0 ? cloudinaryService.uploadProductMainImage : cloudinaryService.uploadProductGalleryImage)(file.buffer, input, { verifiedCatalogAdmin: true, userId: res.locals.orderUserId });
        results.push({ secureUrl: asset.secureUrl, width: asset.width, height: asset.height, format: asset.format });
      }
      return res.json({ images: results });
    } catch (error) { return next(error); }
  });
  router.get('/admin/catalog/homepage', catalog, async (req, res) => render(res, 'homepage-layout', await repository.homepageLayout()));
  router.post('/admin/catalog/homepage/sections', catalog, origin, async (req, res) => {
    await repository.createHomeSection(res.locals.orderUserId, homeSectionSchema.parse(req.body));
    res.redirect(303, '/admin/catalog/homepage');
  });
  router.post('/admin/catalog/homepage/sections/:id/delete', catalog, origin, async (req, res) => {
    await repository.deleteHomeSection(res.locals.orderUserId, z.uuid().parse(req.params.id));
    res.redirect(303, '/admin/catalog/homepage');
  });
  router.post('/api/admin/homepage-layout', catalog, origin, async (req, res) => {
    const data = homepageLayoutSchema.parse(req.body);
    await repository.saveHomepageLayout(res.locals.orderUserId, data);
    res.json({ saved: true });
  });
  router.post('/admin/catalog/products', catalog, productSaveOrigin, async (req, res) => {
    const productInput = { ...(req.body || {}) };
    delete productInput._csrf;
    const data = await bilingual(productSchema.parse(productInput));
    await repository.saveProduct(res.locals.orderUserId, data);
    res.redirect(303, '/admin/catalog?saved=product');
  });
  router.post('/admin/catalog/categories', catalog, origin, async (req, res) => { const data = categorySchema.parse(await bilingual(categorySchema.parse(req.body))); if (!data.nameAr) throw new Error('ARABIC_REQUIRED'); await repository.saveCategory(res.locals.orderUserId, data); res.redirect(303, '/admin/catalog?saved=category'); });
  router.get('/admin/promotions', catalog, async (req, res) => {
    const data = await repository.catalog();
    const savedMessage = req.query.saved === 'offer-removed' ? 'offerRemoved' : req.query.saved === 'offer-set' ? 'offerSaved' : '';
    return render(res, 'promotions', { ...data, csrfToken: createAdminCsrfToken(req.customerSessionToken, csrfSecret), offerProducts: await repository.productOffers(), discounts: await repository.discounts(), savedMessage });
  });
  router.post('/admin/promotions/products/:id/offer', catalog, productSaveOrigin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = { ...req.body }; delete body._csrf;
    const { salePriceEgp } = offerPriceSchema.parse(body);
    await repository.setProductOffer(res.locals.orderUserId, id, salePriceEgp);
    res.redirect(303, '/admin/promotions?saved=offer-set');
  });
  router.post('/admin/promotions/products/:id/color-offer', catalog, productSaveOrigin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = { ...req.body }; delete body._csrf;
    const input = colorOfferSchema.parse(body);
    await repository.setColorOffer(res.locals.orderUserId, id, input.color, input.salePriceEgp);
    res.redirect(303, '/admin/promotions?saved=offer-set');
  });
  router.post('/admin/promotions/products/:id/remove', catalog, productSaveOrigin, async (req, res) => {
    await repository.removeProductOffer(res.locals.orderUserId, z.uuid().parse(req.params.id));
    res.redirect(303, '/admin/promotions?saved=offer-removed');
  });
  router.post('/admin/promotions', catalog, productSaveOrigin, async (req, res) => {
    const raw = { ...req.body };
    delete raw._csrf;
    const data = discountSchema.parse(raw); await repository.saveDiscount(res.locals.orderUserId, data); res.redirect(303, '/admin/promotions');
  });
  router.post('/admin/promotions/:id/disable', catalog, productSaveOrigin, async (req, res) => { await repository.disableDiscount(res.locals.orderUserId, z.uuid().parse(req.params.id)); res.redirect(303, '/admin/promotions'); });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const code = adminErrorCode(error, req.path);
    const providerCode = [error?.code, error?.meta?.code, error?.cause?.code].find(value => typeof value === 'string' && /^(P\d{4}|E[A-Z0-9]+|[A-Z0-9]{5})$/.test(value));
    const errorType = typeof error?.constructor?.name === 'string' && /^[A-Za-z0-9]+$/.test(error.constructor.name) ? error.constructor.name : 'Error';
    console.error(JSON.stringify({ event: 'admin_save_failed', operation: req.route?.path || 'admin-route', code, errorType, ...(providerCode ? { providerCode } : {}) }));
    const status = error.status || (code === 'DATABASE_UNAVAILABLE' ? 503 : code === 'ADMIN_OPERATION_FAILED' ? 500 : code === 'DUPLICATE_VALUE' || code === 'HOMEPAGE_LAYOUT_STALE' || code === 'PRODUCT_EDIT_STALE' ? 409 : code === 'RELATED_RECORD_MISSING' ? 404 : error instanceof z.ZodError ? 422 : 400);
    if (req.path.startsWith('/api/')) return res.status(status).json({ code });
    return res.status(status).render('layouts/admin', { title: res.locals.a('error'), contentView: '../admin/message', code, backPath: adminBackPath(req.path) });
  });
  return router;
}
module.exports = { createAdminManagementRoutes, adminErrorCode };
