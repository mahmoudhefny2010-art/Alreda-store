const crypto = require('node:crypto');
const request = require('supertest');
const { readAuthConfig } = require('../../src/config/auth');
const { verifyIdToken } = require('../../src/services/google-oidc.service');
const { createAuthRoutes, createAuthRateLimiter } = require('../../src/routes/auth.routes');

describe('customer Google authentication', () => {
  it('reports the local callback and stays disabled without credentials', () => {
    const config = readAuthConfig({ NODE_ENV: 'test', PORT: '3100' });
    expect(config.callbackUrl).toBe('http://127.0.0.1:3100/auth/google/callback');
    expect(config.enabled).toBe(false);
    expect(readAuthConfig({ NODE_ENV: 'test', PORT: '3000', GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret' }).enabled).toBe(true);
  });

  it('starts OAuth with state, nonce and PKCE, and refuses an unconfigured login', async () => {
    const config = { enabled: true, clientId: 'client-id', clientSecret: 'client-secret', callbackUrl: 'http://127.0.0.1:3000/auth/google/callback', sessionSecret: 'x'.repeat(48), secureCookie: false };
    const app = require('express')(); app.use(createAuthRoutes({ config, repository: { consumeAuthRateLimit: async () => true }, cartRepository: {} }));
    const response = await request(app).get('/auth/google?returnTo=%2Fproducts').expect(302);
    const location = new URL(response.headers.location);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe(config.callbackUrl);
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    const disabled = require('express')(); disabled.use(createAuthRoutes({ config: { ...config, enabled: false }, repository: { consumeAuthRateLimit: async () => true }, cartRepository: {} }));
    await request(disabled).get('/auth/google').expect(503);
  });

  it('limits authentication starts across repeated requests without retaining raw IP addresses', async () => {
    let count = 0; let storedKey = '';
    const limiter = createAuthRateLimiter({ clock: () => 60000, secret: 'x'.repeat(48), repository: { consumeAuthRateLimit: async (key, start, max) => { storedKey = key; count += 1; expect(start).toBeInstanceOf(Date); return count <= max; }, pruneAuthRateLimits: vi.fn() } });
    const req = { ip: '203.0.113.7', socket: {}, path: '/auth/google' };
    const makeRes = () => ({ status: vi.fn(function status(value) { this.code = value; return this; }), set: vi.fn(function set() { return this; }), send: vi.fn() });
    for (let i = 0; i < 8; i++) { const res = makeRes(); await limiter(req, res, () => {}); expect(res.code).toBeUndefined(); }
    const limited = makeRes(); await limiter(req, limited, () => {});
    expect(limited.code).toBe(429);
    expect(storedKey).not.toContain('203.0.113.7');
  });

  it('verifies Google signature and mandatory claims before accepting a profile', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const now = Math.floor(Date.now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'RS256', kid: `test-${crypto.randomUUID()}` });
    const payload = encode({ iss: 'https://accounts.google.com', aud: 'client-id', sub: 'google-subject', email: 'Buyer@Example.com', email_verified: true, name: 'Buyer', nonce: 'nonce-value', exp: now + 300, iat: now });
    const unsigned = `${header}.${payload}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
    const token = `${unsigned}.${signature}`;
    const fetchImpl = async () => ({ ok: true, headers: { get: () => 'max-age=30' }, json: async () => ({ keys: [{ ...jwk, kid: `test-${crypto.randomUUID()}`, use: 'sig' }] }) });
    // Use a key ID matching the generated JWK for this token.
    const tokenKid = JSON.parse(Buffer.from(header, 'base64url')).kid;
    const matchingFetch = async () => ({ ok: true, headers: { get: () => 'max-age=30' }, json: async () => ({ keys: [{ ...jwk, kid: tokenKid, use: 'sig' }] }) });
    expect(fetchImpl).toBeDefined();
    await expect(verifyIdToken(token, { clientId: 'client-id', nonce: 'nonce-value', fetchImpl: matchingFetch })).resolves.toMatchObject({ sub: 'google-subject', email: 'buyer@example.com' });
    await expect(verifyIdToken(token, { clientId: 'client-id', nonce: 'wrong', fetchImpl: matchingFetch })).rejects.toThrow('GOOGLE_CLAIMS_INVALID');
  });
});
