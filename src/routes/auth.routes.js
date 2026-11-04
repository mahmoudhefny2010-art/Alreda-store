const { Router } = require('express');
const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { readAuthConfig } = require('../config/auth');
const { createCustomerAuthRepository } = require('../repositories/customer-auth.repository');
const { createCartRepository } = require('../repositories/cart.repository');
const { verifyIdToken } = require('../services/google-oidc.service');
const { readCookie } = require('../middleware/customer-session.middleware');

function safeReturn(value) { return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') && !value.startsWith('/auth') ? value : '/'; }
function sameOrigin(req) {
  // Browsers normally send Origin on POSTs. Fall back to Referer for clients
  // that omit Origin. Fetch Metadata is a browser-controlled fallback for
  // same-origin form submissions when a proxy or privacy setting strips both.
  const supplied = req.get('origin') || req.get('referer');
  const fetchSite = req.get('sec-fetch-site');
  if (!req.get('host')) return false;
  if (!supplied) return fetchSite === 'same-origin';
  try {
    const actual = new URL(supplied);
    const expected = new URL(`${req.protocol}://${req.get('host')}`);
    if (actual.username || actual.password || actual.origin === 'null' || !['http:', 'https:'].includes(actual.protocol)) return false;
    if (actual.protocol !== expected.protocol && fetchSite !== 'same-origin') return false;
    if (actual.origin === expected.origin) return true;
    // Allow localhost/127.0.0.1 aliases only on the local development server.
    const loopback = name => ['localhost', '127.0.0.1', '[::1]'].includes(name);
    const developmentAlias = req.app?.get('env') !== 'production'
      && loopback(actual.hostname) && loopback(expected.hostname)
      && actual.port === expected.port;
    return developmentAlias || fetchSite === 'same-origin';
  } catch { return false; }
}
function logoutCsrfToken(sessionToken, secret) {
  return sessionToken && secret ? createHmac('sha256', secret).update(`logout:${sessionToken}`).digest('hex') : '';
}
function createAuthRateLimiter({ clock = Date.now, repository, secret = '', windowMs = 10 * 60 * 1000 } = {}) {
  let checks = 0;
  return async (req, res, next) => {
    const source = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.path.startsWith('/auth/google/callback') ? 'callback' : 'authorize'}`;
    const key = createHmac('sha256', secret || 'disabled-auth-rate-limit-key').update(source).digest('hex');
    const now = clock();
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const isCallback = req.path.startsWith('/auth/google/callback');
    const max = isCallback ? 20 : 8;
    try {
      if (!await repository.consumeAuthRateLimit(key, windowStart, max)) return res.status(429).set('Retry-After', String(Math.ceil((windowStart.getTime() + windowMs - now) / 1000))).send('Please wait before trying Google sign-in again.');
      if (++checks % 128 === 0) await repository.pruneAuthRateLimits(new Date(now - windowMs * 2));
    } catch { return res.status(503).send('Sign-in is temporarily unavailable.'); }
    return next();
  };
}
function createAuthRoutes({ config = readAuthConfig(), repository = createCustomerAuthRepository(), cartRepository = createCartRepository(), fetchImpl = fetch, clock = Date.now } = {}) {
  const router = Router();
  const rateLimit = createAuthRateLimiter({ clock, repository, secret: config.sessionSecret });
  const cookieName = 'alreda_oauth';
  const sessionName = 'alreda_session';
  const clearCookie = name => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${config.secureCookie ? '; Secure' : ''}`;
  const cookie = (name, value, age) => `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${config.secureCookie ? '; Secure' : ''}`;
  function signature(value) { return createHmac('sha256', config.sessionSecret).update(value).digest('base64url'); }
  function secureEqual(a, b) {
    const left = Buffer.from(a); const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  function readOAuthCookie(req) {
    const value = readCookie(req.get('cookie'), cookieName);
    const separator = value.lastIndexOf('.');
    if (separator < 0) return null;
    const payload = value.slice(0, separator); const received = value.slice(separator + 1);
    if (!secureEqual(signature(payload), received)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url'));
      if (data.expires < clock() || typeof data.state !== 'string' || typeof data.nonce !== 'string' || typeof data.verifier !== 'string') return null;
      return data;
    } catch { return null; }
  }
  router.get('/auth/google', rateLimit, (req, res) => start(req, res, 'signin'));
  router.get('/auth/google/link', rateLimit, (req, res) => req.customer ? start(req, res, 'link') : res.redirect(303, '/auth/google'));
  function start(req, res, action) {
    res.set('Cache-Control', 'no-store');
    if (!config.enabled) return res.status(503).send('Google sign-in is not configured.');
    if (action === 'link' && !req.customer) return res.redirect(303, '/auth/google');
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ state, nonce, verifier, action, userId: action === 'link' ? req.customer.id : '', returnTo: safeReturn(req.query.returnTo), expires: clock() + 600000 })).toString('base64url');
    res.append('Set-Cookie', cookie(cookieName, `${payload}.${signature(payload)}`, 600));
    const parameters = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.callbackUrl, response_type: 'code', scope: 'openid email profile', state, nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
    return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${parameters}`);
  }
  router.get('/auth/google/callback', rateLimit, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const tx = readOAuthCookie(req);
    res.append('Set-Cookie', clearCookie(cookieName));
    if (!config.enabled || !tx || typeof req.query.state !== 'string' || !secureEqual(tx.state, req.query.state) || typeof req.query.code !== 'string' || req.query.code.length > 4096) return res.redirect(303, '/?auth=failed');
    try {
      const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: req.query.code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.callbackUrl, grant_type: 'authorization_code', code_verifier: tx.verifier }), signal: AbortSignal.timeout(8000) });
      if (!tokenResponse.ok) throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
      const tokens = await tokenResponse.json();
      const identity = await verifyIdToken(tokens.id_token, { clientId: config.clientId, nonce: tx.nonce, fetchImpl, now: clock() });
      const user = tx.action === 'link' ? await repository.linkGoogle(tx.userId, identity) : await repository.authenticateGoogle(identity);
      if (tx.action !== 'link') await cartRepository.mergeGuest(user.id, readCookie(req.get('cookie'), 'alreda_guest_cart'));
      const session = await repository.createSession(user.id);
      res.append('Set-Cookie', cookie(sessionName, session.token, Math.floor((session.expiresAt.getTime() - clock()) / 1000)));
      if (tx.action !== 'link') res.append('Set-Cookie', clearCookie('alreda_guest_cart'));
      const destination = safeReturn(tx.returnTo);
      return res.redirect(303, destination === '/' && tx.action !== 'link' && repository.dashboardPath ? await repository.dashboardPath(user.id) : destination);
    } catch (error) {
      // Only a stable internal error code is logged; no OAuth codes, claims or credentials.
      req.app.locals.logger?.error?.({ event: 'google_signin_failed', code: /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : 'GOOGLE_SIGNIN_FAILED' });
      return res.redirect(303, '/?auth=failed');
    }
  });
  router.post('/auth/logout', require('express').urlencoded({ extended: false, limit: '16kb' }), async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const fetchSite = req.get('sec-fetch-site');
    const submitted = typeof req.body?._csrf === 'string' ? req.body._csrf : '';
    const expected = logoutCsrfToken(req.customerSessionToken, config.sessionSecret);
    const csrfValid = /^[a-f0-9]{64}$/i.test(submitted) && secureEqual(submitted, expected);
    if (fetchSite === 'cross-site' || (!sameOrigin(req) && !csrfValid)) return next(Object.assign(new Error('REQUEST_ORIGIN_REJECTED'), { status: 403 }));
    const token = readCookie(req.get('cookie'), sessionName);
    if (token) {
      try { await repository.deleteSession(token); }
      catch {
        req.app.locals.logger?.error?.({ event: 'customer_logout_failed', code: 'SESSION_REVOCATION_FAILED' });
        res.append('Set-Cookie', clearCookie(sessionName));
        return res.status(503).send('Sign-out could not be verified. Please try again.');
      }
    }
    res.append('Set-Cookie', clearCookie(sessionName));
    return res.redirect(303, '/');
  });
  return router;
}

module.exports = { createAuthRoutes, safeReturn, sameOrigin, createAuthRateLimiter, logoutCsrfToken };
