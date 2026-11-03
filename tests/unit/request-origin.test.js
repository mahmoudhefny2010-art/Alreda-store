const { sameOrigin } = require('../../src/routes/auth.routes');

function request({ origin, referer, host = '127.0.0.1:3000', protocol = 'http', env = 'development', fetchSite } = {}) {
  const headers = { origin, referer, host, 'sec-fetch-site': fetchSite };
  return { get: name => headers[name.toLowerCase()] || null, protocol, app: { get: () => env } };
}

describe('same-origin request validation', () => {
  it('accepts the current origin and localhost loopback aliases during development', () => {
    expect(sameOrigin(request({ origin: 'http://127.0.0.1:3000' }))).toBe(true);
    expect(sameOrigin(request({ origin: 'http://localhost:3000' }))).toBe(true);
  });

  it('rejects mismatched ports and loopback aliases in production', () => {
    expect(sameOrigin(request({ origin: 'http://localhost:3001' }))).toBe(false);
    expect(sameOrigin(request({ origin: 'http://localhost:3000', env: 'production' }))).toBe(false);
  });

  it('uses browser same-origin metadata when Origin and Referer are missing or rewritten', () => {
    expect(sameOrigin(request({ fetchSite: 'same-origin' }))).toBe(true);
    expect(sameOrigin(request({ origin: 'http://store.internal', fetchSite: 'same-origin' }))).toBe(true);
    expect(sameOrigin(request({ fetchSite: 'cross-site' }))).toBe(false);
    expect(sameOrigin(request({ fetchSite: 'same-site' }))).toBe(false);
    expect(sameOrigin(request())).toBe(false);
  });
});
