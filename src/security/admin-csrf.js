const { createHmac, timingSafeEqual } = require('node:crypto');

function createAdminCsrfToken(sessionToken, secret) {
  if (typeof sessionToken !== 'string' || !sessionToken || typeof secret !== 'string' || secret.length < 32) return '';
  return createHmac('sha256', secret).update(`admin-catalog:${sessionToken}`).digest('hex');
}

function verifyAdminCsrfToken(sessionToken, secret, candidate) {
  if (typeof candidate !== 'string' || !/^[a-f0-9]{64}$/i.test(candidate)) return false;
  const expected = createAdminCsrfToken(sessionToken, secret);
  if (!expected) return false;
  const actualBuffer = Buffer.from(candidate, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

module.exports = { createAdminCsrfToken, verifyAdminCsrfToken };
