const { Router } = require('express');
const { z } = require('zod');
const { createNotificationRepository } = require('../repositories/notification.repository');
const { sameOrigin } = require('./auth.routes');
const { createHash } = require('node:crypto');
const { createOneSignalService } = require('../services/onesignal.service');
const { createCustomerAuthRepository } = require('../repositories/customer-auth.repository');

const preferences = z.object({ transactional: z.boolean(), marketing: z.boolean() }).strict();
const subscription = z.object({ subscriptionId: z.string().min(8).max(120).regex(/^[A-Za-z0-9_-]+$/) }).strict();
function createNotificationRoutes({ repository = createNotificationRepository(), enabled = Boolean(process.env.ONESIGNAL_APP_ID), provider = createOneSignalService(), rateRepository = createCustomerAuthRepository(), clock = Date.now } = {}) {
  const router = Router();
  router.use('/api/notifications', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use('/api/notifications', (req, res, next) => req.customer ? next() : res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' }));
  router.post('/api/notifications/preferences', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'REQUEST_ORIGIN_REJECTED' });
    if (!enabled) return res.status(503).json({ error: 'NOTIFICATIONS_UNAVAILABLE' });
    const parsed = preferences.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PREFERENCES' });
    try { await repository.savePreferences(req.customer.id, parsed.data.transactional, parsed.data.marketing); return res.json({ saved: true }); }
    catch { return res.status(503).json({ error: 'NOTIFICATIONS_UNAVAILABLE' }); }
  });
  router.post('/api/notifications/subscriptions', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'REQUEST_ORIGIN_REJECTED' });
    if (!enabled) return res.status(503).json({ error: 'NOTIFICATIONS_UNAVAILABLE' });
    const parsed = subscription.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_SUBSCRIPTION' });
    try { await repository.registerSubscription(req.customer.id, parsed.data.subscriptionId); return res.status(201).json({ saved: true }); }
    catch (error) { return res.status(error.message === 'SUBSCRIPTION_CONFLICT' ? 409 : 503).json({ error: error.message === 'SUBSCRIPTION_CONFLICT' ? error.message : 'NOTIFICATIONS_UNAVAILABLE' }); }
  });
  router.post('/api/notifications/test', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'REQUEST_ORIGIN_REJECTED' });
    if (!enabled || !provider.enabled) return res.status(503).json({ error: 'NOTIFICATIONS_UNAVAILABLE' });
    const parsed = subscription.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_SUBSCRIPTION' });
    try {
      // Never accept a recipient user ID or send to another customer's device.
      if (!await repository.ownsSubscription(req.customer.id, parsed.data.subscriptionId)) return res.status(404).json({ error: 'SUBSCRIPTION_NOT_CONNECTED' });
      const windowStart = new Date(Math.floor(clock() / 60000) * 60000);
      const key = createHash('sha256').update(`push-test:${req.customer.id}`).digest('hex');
      if (!await rateRepository.consumeAuthRateLimit(key, windowStart, 1)) return res.status(429).set('Retry-After', '60').json({ error: 'TRY_AGAIN_LATER' });
      const hash = createHash('sha256').update(`${key}:${parsed.data.subscriptionId}:${windowStart.toISOString()}`).digest('hex');
      const deliveryKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      await provider.send({ subscriptionIds: [parsed.data.subscriptionId], eventType: 'DEVICE_TEST', deliveryKey,
        payload: { message: { titleEn: 'Alreda Store', titleAr: 'متجر الرضا', bodyEn: 'Your notifications are connected. This is a test notification.', bodyAr: 'تم ربط إشعاراتك بنجاح. هذا إشعار تجريبي.', url: '/' } } });
      return res.status(202).json({ accepted: true });
    } catch { return res.status(503).json({ error: 'TEST_NOTIFICATION_UNAVAILABLE' }); }
  });
  router.delete('/api/notifications/subscriptions', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'REQUEST_ORIGIN_REJECTED' });
    const parsed = z.object({ subscriptionId: z.string().min(8).max(120).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_SUBSCRIPTION' });
    try { await repository.unregisterSubscription(req.customer.id, parsed.data.subscriptionId); return res.json({ removed: true }); }
    catch { return res.status(503).json({ error: 'NOTIFICATIONS_UNAVAILABLE' }); }
  });
  return router;
}
module.exports = { createNotificationRoutes };
