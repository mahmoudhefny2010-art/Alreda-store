const request = require('supertest');
const { createApp } = require('../../src/app');
const { translate } = require('../../src/config/storefront-i18n');
const userId = 'a836d7d7-65f9-4c40-9bc4-0b76581e35cc';
const logger = { error: vi.fn() };
function application({ role, fail = false, google = false } = {}) {
  return createApp({ environment: 'test', logger, authSettings: google ? { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' } : {},
    orders: { authenticate: async () => role ? { userId } : null,
      repository: { principal: async () => {
        if (fail) throw new Error('sensitive database detail');
        return { id: userId, role, user_roles: [] };
      }, dashboard: async () => ({ stats: {}, latestOrders: [] }), listAdminOrders: async () => [] } },
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
});
