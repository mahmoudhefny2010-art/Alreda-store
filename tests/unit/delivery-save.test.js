const request = require('supertest');
const { createApp } = require('../../src/app');
const secret = 'synthetic-delivery-session-secret-'.repeat(2);
const token = 'synthetic-session-token-'.repeat(2);
const userId = 'a836d7d7-65f9-4c40-9bc4-0b76581e35cc';
const configuration = { mode: 'CITY', flatFee: 0, zones: [{ city: 'Cairo', cityAr: 'القاهرة', fee: 77, enabled: true }] };
function setup(environment = 'test') {
  let stored = null;
  const settings = { shipping: vi.fn(async () => stored), saveShipping: vi.fn(async (actor, value) => { stored = value; }) };
  const app = createApp({ environment, mediaSettings: {}, whatsappSettings: {}, authSettings: { SESSION_SECRET: secret },
    authRepository: { findSession: async () => ({ users: { id: userId, name: 'Synthetic admin' } }) }, logger: { error: vi.fn() },
    orders: { policy: { enabled: false, shippingRates: {} }, settingsRepository: settings,
      repository: { principal: async () => ({ id: userId, role: 'admin', user_roles: [] }) } } });
  const post = () => request(app).post('/admin/delivery').set('Host', '127.0.0.1:666').set('Cookie', `alreda_session=${token}`).type('form');
  return { app, settings, post };
}
describe('delivery save security and persistence feedback', () => {
  it.each([
    ['Origin', 'http://127.0.0.1:666'], ['Origin', 'http://localhost:666'],
    ['Referer', 'http://127.0.0.1:666/admin/delivery'], ['Sec-Fetch-Site', 'same-origin'],
  ])('saves a legitimate form using %s: %s and verifies the committed value', async (header, value) => {
    const a = setup(); await a.post().set(header, value).send({ configuration: JSON.stringify(configuration) }).expect(303).expect('Location', '/admin/delivery?saved=1');
    expect(a.settings.saveShipping).toHaveBeenCalledWith(userId, configuration);
    expect(a.settings.shipping).toHaveBeenCalled();
    const result = await request(a.app).get('/admin/delivery?saved=1').set('Cookie', `alreda_session=${token}`).expect(200);
    expect(result.text).toContain('Delivery settings saved.'); expect(result.text).toContain('value="77"');
  });
  it('uses a session-bound token when the browser omits source headers', async () => {
    const a = setup(); const page = await request(a.app).get('/admin/delivery').set('Cookie', `alreda_session=${token}`).expect(200);
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
    await a.post().send({ configuration: JSON.stringify(configuration), _csrf: csrf }).expect(303);
  });
  it.each([
    ['Origin', 'null'], ['Origin', 'http://127.0.0.1:3000'],
    ['Referer', 'http://localhost:3000/admin/delivery'], ['Origin', 'rewritten-origin'],
  ])('accepts the verified session form token when %s is rewritten to %s', async (header, value) => {
    const a = setup();
    const page = await request(a.app).get('/admin/delivery').set('Cookie', `alreda_session=${token}`).expect(200);
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
    await a.post().set(header, value).send({ configuration: JSON.stringify(configuration), _csrf: csrf }).expect(303);
    expect(a.settings.saveShipping).toHaveBeenCalledWith(userId, configuration);
    const saved = await request(a.app).get('/admin/delivery?saved=1').set('Cookie', `alreda_session=${token}`).expect(200);
    expect(saved.text).toContain('Checkout now uses these prices.');
  });
  it('rejects an explicit cross-site submission even if it carries a valid token', async () => {
    const a = setup();
    const page = await request(a.app).get('/admin/delivery').set('Cookie', `alreda_session=${token}`).expect(200);
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
    await a.post().set('Origin', 'http://127.0.0.1:666').set('Sec-Fetch-Site', 'cross-site').send({ configuration: JSON.stringify(configuration), _csrf: csrf }).expect(403);
    expect(a.settings.saveShipping).not.toHaveBeenCalled();
  });
  it('rejects a token belonging to a different customer session', async () => {
    const a = setup();
    const page = await request(a.app).get('/admin/delivery').set('Cookie', `alreda_session=${token}`).expect(200);
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
    await a.post().set('Origin', 'null').set('Cookie', `alreda_session=${'other-session-token-'.repeat(3)}`).send({ configuration: JSON.stringify(configuration), _csrf: csrf }).expect(403);
    expect(a.settings.saveShipping).not.toHaveBeenCalled();
  });
  it.each(['missing', 'foreign', 'production-alias'])('rejects %s origin without losing the valid price draft', async mode => {
    const a = setup(mode === 'production-alias' ? 'production' : 'test'); let post = a.post();
    if (mode === 'foreign') post = post.set('Origin', 'https://foreign.invalid');
    if (mode === 'production-alias') post = post.set('Origin', 'http://localhost:666');
    const result = await post.send({ configuration: JSON.stringify(configuration), _csrf: 'invalid' }).expect(403);
    expect(a.settings.saveShipping).not.toHaveBeenCalled(); expect(result.text).toContain('REQUEST_ORIGIN_REJECTED'); expect(result.text).toContain('value="77"');
    expect(result.text).not.toContain('Administration temporarily unavailable');
  });
  it('retains valid edits and never reports success if writing or readback verification fails', async () => {
    for (const failure of ['write', 'readback']) {
      const a = setup();
      if (failure === 'write') a.settings.saveShipping.mockRejectedValueOnce(new Error('private database diagnostic'));
      else a.settings.shipping.mockResolvedValueOnce({ ...configuration, flatFee: 100 });
      const result = await a.post().set('Origin', 'http://127.0.0.1:666').send({ configuration: JSON.stringify(configuration) }).expect(503);
      expect(result.text).toContain('DELIVERY_SAVE_UNVERIFIED'); expect(result.text).toContain('value="77"');
      expect(result.text).not.toContain('private database diagnostic'); expect(result.text).not.toContain('Delivery settings saved.');
    }
  });
  it('rejects malformed settings without executing a write', async () => {
    const a = setup();
    const result = await a.post().set('Origin', 'http://127.0.0.1:666').send({ configuration: '{bad' }).expect(400);
    expect(result.text).toContain('INVALID_SETTINGS'); expect(a.settings.saveShipping).not.toHaveBeenCalled();
  });
});
