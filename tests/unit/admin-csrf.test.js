const { createAdminCsrfToken, verifyAdminCsrfToken } = require('../../src/security/admin-csrf');

describe('admin catalog CSRF tokens', () => {
  const session = 'verified-server-side-customer-session';
  const secret = 'a sufficiently long test secret for csrf tokens';

  it('creates a token tied to the authenticated session', () => {
    const token = createAdminCsrfToken(session, secret);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyAdminCsrfToken(session, secret, token)).toBe(true);
    expect(verifyAdminCsrfToken('another-session', secret, token)).toBe(false);
  });

  it('rejects missing, malformed, tampered, and unkeyed tokens', () => {
    const token = createAdminCsrfToken(session, secret);
    expect(verifyAdminCsrfToken(session, secret, '')).toBe(false);
    const tampered = `${token[0] === '0' ? '1' : '0'}${token.slice(1)}`;
    expect(verifyAdminCsrfToken(session, secret, tampered)).toBe(false);
    expect(createAdminCsrfToken(session, '')).toBe('');
    expect(verifyAdminCsrfToken(session, '', token)).toBe(false);
  });
});
