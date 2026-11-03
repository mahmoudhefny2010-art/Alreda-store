const crypto = require('node:crypto');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let jwksCache;
let jwksExpiresAt = 0;

async function getJwks(fetchImpl = fetch) {
  if (jwksCache && Date.now() < jwksExpiresAt) return jwksCache;
  const response = await fetchImpl(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('GOOGLE_KEYS_UNAVAILABLE');
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error('GOOGLE_KEYS_INVALID');
  jwksCache = body.keys;
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 300);
  jwksExpiresAt = Date.now() + Math.min(maxAge, 3600) * 1000;
  return jwksCache;
}

async function verifyIdToken(token, { clientId, nonce, fetchImpl = fetch, now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 12000) throw new Error('GOOGLE_TOKEN_INVALID');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('GOOGLE_TOKEN_INVALID');
  let header; let claims;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); }
  catch { throw new Error('GOOGLE_TOKEN_INVALID'); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('GOOGLE_TOKEN_INVALID');
  const key = (await getJwks(fetchImpl)).find(value => value.kid === header.kid && value.kty === 'RSA' && value.use === 'sig');
  if (!key) { jwksExpiresAt = 0; throw new Error('GOOGLE_KEY_NOT_FOUND'); }
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  if (!verifier.verify(crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('GOOGLE_SIGNATURE_INVALID');
  const nowSeconds = Math.floor(now / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || !audience.includes(clientId) ||
      (audience.length > 1 && claims.azp !== clientId) || (claims.azp && claims.azp !== clientId) || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds ||
      !Number.isFinite(claims.iat) || claims.iat > nowSeconds + 60 || claims.iat < nowSeconds - 86400 || claims.nonce !== nonce || claims.email_verified !== true ||
      typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 160 || typeof claims.email !== 'string' || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) throw new Error('GOOGLE_CLAIMS_INVALID');
  return { sub: claims.sub, email: claims.email.trim().toLowerCase(), name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 160) : claims.email.split('@')[0] };
}

module.exports = { verifyIdToken };
