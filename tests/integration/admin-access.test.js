const request = require('supertest');
const { createApp } = require('../../src/app');
const { translate } = require('../../src/config/storefront-i18n');
const userId = 'a836d7d7-65f9-4c40-9bc4-0b76581e35cc';
const logger = { error: vi.fn() };
function application({ role, fail = false, google = false, notificationWorker, notificationRepository, settingsRepository, reviewProof = vi.fn(), updateStatus = vi.fn() } = {}) {
  return createApp({ environment: 'test', logger, authSettings: google ? { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' } : {},
    orders: { authenticate: async () => role ? { userId } : null,
      repository: { principal: async () => {
        if (fail) throw new Error('sensitive database detail');
        return { id: userId, role, user_roles: [] };
      }, dashboard: async () => ({ stats: {}, latestOrders: [] }), listAdminOrders: async () => [], reviewProof, updateStatus },
      ...(notificationWorker ? { notificationWorker } : {}),
      ...(notificationRepository ? { notificationRepository } : {}),
      ...(settingsRepository ? { settingsRepository } : {}) },
  });
}
describe('admin access failure recovery', () => {
  it('sends guests to Google sign-in with a fixed admin return path', async () => {
    await request(application({ google: true })).get('/admin').expect(303).expect('Location', '/auth/google?returnTo=%2Fadmin');
  });
  it.each(['en', 'ar'])('explains missing administrator permission in %s without exposing orders', async locale => {
    const response = await request(application({ role: 'customer' })).get('/admin').set('Cookie', `alreda_locale=${locale}`).expect(403);
    expect(response.text).toContain(translate(locale, 'adminDeniedTitle'));
    expect(response.text).not.toContain(translate(locale, 'checkoutUnavailable'));
  });
  it('shows a safe administration error on a database lookup failure', async () => {
    const response = await request(application({ role: 'admin', fail: true })).get('/admin').expect(503);
    expect(response.text).toContain('Administration temporarily unavailable');
    expect(response.text).not.toContain('sensitive database detail');
  });
  it('allows a verified administrator to view the dashboard even with checkout disabled', async () => {
    const response = await request(application({ role: 'admin' })).get('/admin').expect(200);
    expect(response.text).toContain('Database-backed orders');
  });
  it('does not redirect unauthenticated status mutations into sign-in', async () => {
    await request(application({ google: true })).post(`/admin/orders/${userId}/status`).send({ status: 'CONFIRMED' }).expect(401);
  });
  it('immediately dispatches a status notification after an authorized order change', async () => {
    const updateStatus = vi.fn();
    const notificationWorker = { processOrderStatus: vi.fn(async () => ({ processed: 1, skipped: false })) };
    await request(application({ role: 'admin', notificationWorker, updateStatus }))
      .post(`/admin/orders/${userId}/status`).set('Host', 'store.test').set('Origin', 'http://store.test').type('form').send({ status: 'CONFIRMED' })
      .expect(303).expect('Location', `/admin/orders/${userId}`);
    expect(updateStatus).toHaveBeenCalledWith(userId, 'CONFIRMED', userId);
    expect(notificationWorker.processOrderStatus).toHaveBeenCalledWith(userId);
  });
  it('immediately dispatches an order-status notification after payment review', async () => {
    const reviewProof = vi.fn();
    const notificationWorker = { processOrderStatus: vi.fn(async () => ({ processed: 1, skipped: false })) };
    await request(application({ role: 'admin', notificationWorker, reviewProof }))
      .post(`/admin/orders/${userId}/payment-review`).set('Host', 'store.test').set('Origin', 'http://store.test').type('form').send({ decision: 'REJECT' })
      .expect(303).expect('Location', `/admin/orders/${userId}`);
    expect(reviewProof).toHaveBeenCalledWith(userId, userId, 'REJECT', '');
    expect(notificationWorker.processOrderStatus).toHaveBeenCalledWith(userId);
  });
  it('redirects the old template URL to the notifications workspace for authorized admins', async () => {
    await request(application({ role: 'admin' })).get('/admin/notifications/templates').expect(303).expect('Location', '/admin/notifications');
  });
  it('saves notification templates when a trusted proxy reports the same-origin fetch protocol', async () => {
    const settingsRepository = { saveTemplate: vi.fn() };
    const configuration = { eventType: 'ORDER_STATUS', enabled: true, message: {
      titleEn: 'Order update', titleAr: 'تحديث الطلب', bodyEn: 'Order {reference}: {status}', bodyAr: 'الطلب {reference}: {status}', url: '/',
    } };
    await request(application({ role: 'admin', settingsRepository }))
      .post('/admin/notifications/templates').set('Host', 'store.test').set('Origin', 'https://store.test')
      .set('Sec-Fetch-Site', 'same-origin').type('form').send({ configuration: JSON.stringify(configuration) })
      .expect(303).expect('Location', '/admin/notifications?saved=template');
    expect(settingsRepository.saveTemplate).toHaveBeenCalledWith(userId, configuration);
  });
  it('saves notification settings when a trusted proxy reports the same-origin fetch protocol', async () => {
    const notificationRepository = { saveReminderMinutes: vi.fn() };
    await request(application({ role: 'admin', notificationRepository }))
      .post('/admin/notifications/settings').set('Host', 'store.test').set('Origin', 'https://store.test')
      .set('Sec-Fetch-Site', 'same-origin').type('form').send({ abandonedCartMinutes: '90' })
      .expect(303).expect('Location', '/admin/notifications');
    expect(notificationRepository.saveReminderMinutes).toHaveBeenCalledWith(90);
  });
});
