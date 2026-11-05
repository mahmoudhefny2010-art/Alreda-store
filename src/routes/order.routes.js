const { Router, raw, json, urlencoded } = require('express');
const { readCheckoutPolicy } = require('../config/checkout');
const { createOrderRepository } = require('../repositories/order.repository');
const { createOrderService } = require('../services/order.service');
const { createCheckoutController } = require('../controllers/storefront/checkout.controller');
const { createAdminOrdersController } = require('../controllers/admin/orders.controller');
const { orderIdentity } = require('../middleware/order-identity.middleware');
const { OrderError } = require('../validators/order.validator');
const { createNotificationRepository } = require('../repositories/notification.repository');
const { createNotificationWorker } = require('../services/notification-worker.service');
const dashboard = require('../controllers/admin/dashboard.controller');
const { z } = require('zod');
const multer = require('multer');
const { readInstaPayConfig } = require('../config/instapay');
const { createPaymentProofMedia } = require('../services/payment-proof-media.service');
const { createStoreSettingsRepository } = require('../repositories/store-settings.repository');
const { shippingSchema, templateSchema, campaignSchema } = require('../validators/store-settings.validator');
const { defaults: pushDefaults } = require('../config/push-messages');
const { createOneSignalService } = require('../services/onesignal.service');
const { createWhatsAppOrderService } = require('../services/whatsapp-order.service');
const { cityName } = require('../config/storefront-i18n');
const { randomUUID } = require('node:crypto');
const { sameOrigin } = require('./auth.routes');
const { createAdminCsrfToken, verifyAdminCsrfToken } = require('../security/admin-csrf');
function createOrderRoutes({ authenticate, repository = createOrderRepository(), policy = readCheckoutPolicy(process.env, { databaseShipping: true }), paymentProvider, logger = console, cartRepository, notificationRepository = createNotificationRepository(),
  notificationWorker = createNotificationWorker({ logger }),
  settingsRepository = repository.storeSettings?.() || createStoreSettingsRepository(), pushEnabled = createOneSignalService().enabled, csrfSecret = '', instapay = readInstaPayConfig(), proofMedia = createPaymentProofMedia(),
  whatsappOrderService = createWhatsAppOrderService() } = {}) {
  const router = Router();
  const service = createOrderService({ repository, policy, paymentProvider, logger, instapay, shippingProvider: repository.shippingRates ? fallback => repository.shippingRates(fallback) : undefined });
  const checkout = createCheckoutController({ service, repository, cartRepository, notificationWorker, logger, instapay });
  const dispatchConfirmedOrder = async orderId => {
    const order = await repository.getAdminOrder(orderId);
    if (!order) throw new OrderError('ORDER_NOT_FOUND', 404);
    return whatsappOrderService.sendOrder(order);
  };
  const admin = createAdminOrdersController(repository, { csrfSecret, dispatchStatusNotification: notificationWorker.processOrderStatus, dispatchConfirmedOrder, logger });
  const customerGuard = orderIdentity({ authenticate, repository });
  const customerPageGuard = async (req, res, next) => {
    let identity = req.customer ? { userId: req.customer.id } : null;
    try { if (!identity && authenticate) identity = await authenticate(req); }
    catch (error) { return next(error); }
    if (!identity?.userId) {
      if (req.app.locals.googleAuthEnabled) return res.redirect(303, `/auth/google?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }
    return customerGuard(req, res, next);
  };
  const customerOrders = require('../controllers/storefront/customer-orders.controller').createCustomerOrdersController(repository);
  router.use('/account/orders', (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.get('/account/orders', customerPageGuard, customerOrders.index);
  router.get('/account/orders/:id', customerPageGuard, customerOrders.detail);
  const adminGuard = orderIdentity({ authenticate, repository, admin: true, permission: 'orders' });
  const dashboardGuard = orderIdentity({ authenticate, repository, allowAnyAdmin: true });
  router.use(['/checkout', '/api/orders', '/api/payments/webhook', '/admin'], (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const available = (req, res, next) => service.settings.enabled ? next() : next(new OrderError('CHECKOUT_UNAVAILABLE', 503));
  router.get('/checkout', available, customerPageGuard, checkout.page);
  const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5242880, files: 1, fields: 0, parts: 2 } }).single('proof');
  router.post('/api/payments/instapay/proof', available, customerGuard, async (req, res, next) => {
    try {
      if (!instapay.enabled) throw new OrderError('PAYMENT_METHOD_UNAVAILABLE', 400);
      if (req.get('sec-fetch-site') === 'cross-site' || !sameOrigin(req) && req.get('x-requested-with') !== 'alreda-checkout') throw new OrderError('REQUEST_ORIGIN_REJECTED', 403);
      if (!await repository.canUploadProof(res.locals.orderUserId)) throw new OrderError('PAYMENT_UPLOAD_LIMIT', 429);
      receiptUpload(req, res, async error => {
        let asset;
        try {
          if (error || !req.file || !['image/png','image/jpeg','image/webp'].includes(req.file.mimetype)) throw new OrderError('INVALID_PAYMENT_IMAGE', 400);
          asset = await proofMedia.upload(req.file.buffer, req.file.mimetype);
          const saved = await repository.createProof(res.locals.orderUserId, asset);
          if (saved.public_id !== asset.public_id) await proofMedia.remove(asset);
          res.set('Cache-Control', 'no-store').status(201).json({ proofId: saved.id });
        } catch (failure) {
          if (asset) await proofMedia.remove(asset).catch(() => {});
          next(failure instanceof OrderError ? failure : new OrderError('PAYMENT_PROOF_UPLOAD_FAILED', 503));
        }
      });
    } catch (error) { next(error); }
  });
  router.get('/admin/orders/:id/payment-proof', adminGuard, async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new OrderError('INVALID_ORDER_ID', 400);
    const proof = await repository.proofForAdmin(id.data);
    if (!proof) throw new OrderError('PAYMENT_PROOF_NOT_FOUND', 404);
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="payment-proof.png"' }).type('png').send(await proofMedia.read(proof));
  });
  router.post('/admin/orders/:id/payment-review', adminGuard, urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
    if (req.get('sec-fetch-site') === 'cross-site' || !sameOrigin(req) && !verifyAdminCsrfToken(req.customerSessionToken, csrfSecret, req.body?._csrf)) throw new OrderError('REQUEST_ORIGIN_REJECTED', 403);
    const id = z.uuid().safeParse(req.params.id);
    const input = z.object({ decision: z.enum(['APPROVE','REJECT']), reference: z.string().trim().max(120).default(''), verified: z.literal('on').optional(), _csrf: z.string().optional() }).strict().safeParse(req.body);
    if (!id.success || !input.success || input.data.decision === 'APPROVE' && (input.data.verified !== 'on' || !/^[A-Za-z0-9_:/-]{3,120}$/.test(input.data.reference))) throw new OrderError('INVALID_PAYMENT_REVIEW', 400);
    const reviewed = await repository.reviewProof(id.data, res.locals.orderUserId, input.data.decision, input.data.reference.toUpperCase());
    await notificationWorker.processOrderStatus(id.data);
    const whatsappStatus = input.data.decision === 'APPROVE' && reviewed.changed
      ? await admin.dispatchConfirmedWhatsApp(id.data) : '';
    res.redirect(303, `/admin/orders/${id.data}${whatsappStatus ? `?whatsapp=${whatsappStatus}` : ''}`);
  });
  router.post('/api/orders', available, customerGuard, json({ limit: '16kb' }), (req, res, next) => {
    if (!req.is('application/json') || !service.settings.origin || !sameOrigin(req)) return next(new OrderError('REQUEST_ORIGIN_REJECTED', 403));
    next();
  }, checkout.create);
  router.get('/api/orders/requests/:key', customerGuard, checkout.status);
  router.get('/api/admin/orders/updates', adminGuard, async (req, res) => {
    const since = z.iso.datetime().safeParse(req.query.since);
    if (!since.success) throw new OrderError('INVALID_ORDER_UPDATE_CURSOR', 400);
    const orders = await repository.newAdminOrdersSince(new Date(since.data));
    res.set('Cache-Control', 'private, no-store').json({ orders });
  });
  router.get('/admin/orders', adminGuard, admin.index);
  router.get('/admin', dashboardGuard, dashboard.createDashboardController(repository));
  const origin = (req, res, next) => sameOrigin(req) ? next() : next(new OrderError('REQUEST_ORIGIN_REJECTED', 403));
  const adminMutationOrigin = (req, res, next) => {
    const crossSite = req.get('sec-fetch-site') === 'cross-site';
    const validCsrf = verifyAdminCsrfToken(req.customerSessionToken, csrfSecret, req.body?._csrf);
    if (crossSite || !sameOrigin(req) && !validCsrf) return next(new OrderError('REQUEST_ORIGIN_REJECTED', 403));
    return next();
  };
  function parseSettings(schema, raw) {
    try { return schema.parse(JSON.parse(z.string().max(30000).parse(raw))); }
    catch { throw new OrderError('INVALID_SETTINGS', 400); }
  }
  function deliveryPage(req, res, configuration, { saved = false, usingDatabase = true, errorCode = '' } = {}) {
    return res.render('layouts/admin', { title: req.locale === 'ar' ? 'أسعار التوصيل' : 'Delivery prices', contentView: '../admin/delivery', configuration, saved, usingDatabase, errorCode,
      csrfToken: createAdminCsrfToken(req.customerSessionToken, csrfSecret) });
  }
  router.get('/admin/delivery', adminGuard, async (req, res) => {
    const stored = await settingsRepository.shipping();
    const cities = ['Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Red Sea', 'Beheira', 'Kafr El Sheikh', 'Dakahlia', 'Damietta', 'Port Said', 'Ismailia', 'Suez', 'Sharqia', 'Gharbia', 'Monufia', 'Fayoum', 'BeniSuef', 'Minya', 'Assiut', 'Sohag', 'Qena', 'Aswan', 'Luxor', 'New Valley', 'Matrouh', 'North Sinai', 'South Sinai'];
    const configured = stored || { mode: 'CITY', flatFee: 0, zones: Object.entries(policy.shippingRates).map(([city, fee]) => ({ city, cityAr: cityName(city, 'ar'), fee, enabled: true })) };
    // Seed the suggested Egyptian areas only until the admin saves a delivery configuration.
    // After that, the saved list is authoritative so deleted areas stay deleted.
    const zones = [...configured.zones];
    if (!stored) for (const city of cities) if (!zones.some(zone => zone.city.toLowerCase() === city.toLowerCase())) zones.push({ city, cityAr: cityName(city, 'ar'), fee: 0, enabled: false });
    return deliveryPage(req, res, { ...configured, zones }, { saved: req.query.saved === '1' && Boolean(stored), usingDatabase: Boolean(stored) });
  });
  router.post('/admin/delivery', adminGuard, urlencoded({ extended: false, limit: '32kb' }), async (req, res) => {
    let configuration;
    try {
      configuration = parseSettings(shippingSchema, req.body?.configuration);
      const crossSite = req.get('sec-fetch-site') === 'cross-site';
      // A session-bound form token also authenticates a legitimate submission
      // when privacy tools/proxies rewrite Origin to null or an old local URL.
      const tokenValid = verifyAdminCsrfToken(req.customerSessionToken, csrfSecret, req.body?._csrf);
      if (crossSite || !sameOrigin(req) && !tokenValid) throw new OrderError('REQUEST_ORIGIN_REJECTED', 403);
      await settingsRepository.saveShipping(res.locals.orderUserId, configuration);
      const stored = await settingsRepository.shipping();
      if (JSON.stringify(stored) !== JSON.stringify(configuration)) throw new OrderError('DELIVERY_SAVE_UNVERIFIED', 503);
      return res.redirect(303, '/admin/delivery?saved=1');
    } catch (error) {
      const code = error instanceof OrderError ? error.code : error.message === 'ADMIN_REQUIRED' ? 'ADMIN_REQUIRED' : 'DELIVERY_SAVE_UNVERIFIED';
      logger.error({ event: 'delivery_save_failed', code });
      if (!configuration) {
        try { configuration = await settingsRepository.shipping(); } catch { /* Render a safe empty editor while storage is unavailable. */ }
      }
      configuration ||= { mode: 'CITY', flatFee: 0, zones: [{ city: '', cityAr: '', fee: 0, enabled: false }] };
      res.status(error instanceof OrderError ? error.status : code === 'ADMIN_REQUIRED' ? 403 : 503);
      return deliveryPage(req, res, configuration, { errorCode: code });
    }
  });
  router.get('/admin/notifications', adminGuard, async (req, res) => {
    const attempts = await notificationRepository.listHistory();
    const reminderMinutes = await notificationRepository.reminderMinutes();
    const [templates, audienceCounts] = await Promise.all([settingsRepository.templates(), settingsRepository.audienceCounts()]);
    const campaignKey = z.uuid().safeParse(req.query.campaign);
    const queuedCampaign = campaignKey.success ? await settingsRepository.campaign(campaignKey.data) : null;
    res.render('layouts/admin', { title: res.locals.dashboardText('notificationTitle'), contentView: '../admin/notifications', attempts, reminderMinutes,
      templates: Object.entries(pushDefaults).map(([eventType, message]) => templates.find(item => item.eventType === eventType) || { eventType, enabled: true, message }),
      audienceCounts, pushEnabled, queuedCampaign, requestKey: randomUUID(), templateSaved: req.query.saved === 'template' });
  });
  router.get('/admin/notifications/templates', adminGuard, (req, res) => res.redirect(303, '/admin/notifications'));
  router.post('/admin/notifications/templates', adminGuard, origin, urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
    await settingsRepository.saveTemplate(res.locals.orderUserId, parseSettings(templateSchema, req.body.configuration));
    res.redirect(303, '/admin/notifications?saved=template');
  });
  router.post('/admin/notifications/campaigns', adminGuard, origin, urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
    if (!pushEnabled) throw new OrderError('NOTIFICATIONS_UNAVAILABLE', 503);
    const input = parseSettings(campaignSchema, req.body.configuration);
    try { await settingsRepository.queueCampaign(res.locals.orderUserId, input); }
    catch (error) {
      if (['NO_ELIGIBLE_RECIPIENTS', 'CAMPAIGN_KEY_CONFLICT', 'CAMPAIGN_AUDIENCE_TOO_LARGE'].includes(error.message)) throw new OrderError(error.message, 409);
      throw error;
    }
    res.redirect(303, `/admin/notifications?campaign=${input.requestKey}`);
  });
  router.post('/admin/notifications/settings', adminGuard, urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
    if (!sameOrigin(req)) throw new OrderError('REQUEST_ORIGIN_REJECTED', 403);
    const minutes = Number(req.body?.abandonedCartMinutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10080) throw new OrderError('INVALID_REMINDER_INTERVAL', 400);
    await notificationRepository.saveReminderMinutes(minutes);
    return res.redirect(303, '/admin/notifications');
  });
  router.get('/admin/orders/:id', adminGuard, admin.detail);
  router.post('/admin/orders/:id/status', adminGuard, urlencoded({ extended: false, limit: '2kb' }), adminMutationOrigin, admin.updateStatus);
  router.post('/admin/orders/:id/whatsapp', adminGuard, urlencoded({ extended: false, limit: '2kb' }), adminMutationOrigin, admin.retryWhatsApp);
  router.post('/api/payments/webhook', raw({ type: 'application/json', limit: '64kb' }), async (req, res) => {
    res.json(await service.receivePayment(req.body, req.headers));
  });
  router.use((error, req, res, next) => {
    // This router is mounted only for its exact feature paths, so errors elsewhere use the existing handler.
    if (res.headersSent) return next(error);
    const safe = error instanceof OrderError ? error : error.type === 'entity.parse.failed' ? new OrderError('INVALID_ORDER', 400)
      : error.type === 'entity.too.large' ? new OrderError('REQUEST_TOO_LARGE', 413) : new OrderError('ORDERS_UNAVAILABLE', 503);
    if (!(error instanceof OrderError)) logger.error({ event: 'orders_request_failed' });
    if (req.path.startsWith('/api/')) return res.status(safe.status).json({ confirmed: false, code: safe.code });
    if (req.path.startsWith('/account/orders')) {
      if (safe.code === 'AUTHENTICATION_REQUIRED' && req.app.locals.googleAuthEnabled) return res.redirect(303, '/auth/google?returnTo=%2Faccount%2Forders');
      return res.status(safe.status).render('layouts/storefront', { title: res.locals.t(safe.status === 404 ? 'notFoundTitle' : 'errorTitle'), contentView: '../storefront/customer-orders-error', signInRequired: safe.status === 401, missingOrder: safe.status === 404 });
    }
    if (req.path === '/admin' || req.path.startsWith('/admin/')) {
      // Send unauthenticated navigation through the existing verified Google flow.
      // Keep the return path fixed and local; never redirect failed mutations.
      if (safe.code === 'AUTHENTICATION_REQUIRED' && req.method === 'GET' && req.app.locals.googleAuthEnabled) return res.redirect(303, '/auth/google?returnTo=%2Fadmin');
      const prefix = safe.code === 'AUTHENTICATION_REQUIRED' ? 'adminSignIn' : safe.code === 'ADMIN_REQUIRED' ? 'adminDenied' : 'adminUnavailable';
      return res.status(safe.status).render('layouts/storefront', {
        title: res.locals.t(`${prefix}Title`), contentView: '../storefront/admin-unavailable', code: safe.code,
        adminAccessTitle: `${prefix}Title`, adminAccessBody: `${prefix}Body`,
        diagnosticCode: safe.diagnosticCode || safe.code,
      });
    }
    res.status(safe.status).render('layouts/storefront', { title: res.locals.t('ordersUnavailable'), contentView: '../storefront/order-unavailable', code: safe.code });
  });
  return router;
}
module.exports = { createOrderRoutes };
