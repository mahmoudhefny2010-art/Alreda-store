const { createCustomerAuthRepository } = require('../repositories/customer-auth.repository');

function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}

function createCustomerSessionMiddleware({ repository = createCustomerAuthRepository(), secure = process.env.NODE_ENV === 'production', cookieName = 'alreda_session' } = {}) {
  return async (req, res, next) => {
    res.locals.customer = null;
    const token = readCookie(req.get('cookie'), cookieName);
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return next();
    try {
      const stored = await repository.findSession(token);
      if (!stored) {
        res.set('Set-Cookie', `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
        return next();
      }
      req.customer = stored.users;
      req.customerSessionToken = token;
      res.locals.customer = stored.users;
      return next();
    } catch {
      // A database outage never authenticates from client-supplied session state.
      return next();
    }
  };
}

module.exports = { createCustomerSessionMiddleware, readCookie };
