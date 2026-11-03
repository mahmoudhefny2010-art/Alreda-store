const { createHash, randomBytes } = require('node:crypto');
const { getPrismaClient } = require('../config/prisma');
const { adminPermissions } = require('../services/admin-access.service');

const hash = value => createHash('sha256').update(value).digest('hex');
function createCustomerAuthRepository(clientProvider = getPrismaClient) {
  const db = () => clientProvider();
  return {
    async consumeAuthRateLimit(key_hash, windowStart, max) {
      const rows = await db().$queryRaw`INSERT INTO public.auth_rate_limits (key_hash, window_start, count, updated_at)
        VALUES (${key_hash}, ${windowStart}, 1, now())
        ON CONFLICT (key_hash, window_start) DO UPDATE SET count = public.auth_rate_limits.count + 1, updated_at = now()
        WHERE public.auth_rate_limits.count < ${max}
        RETURNING count`;
      return rows.length === 1;
    },
    async pruneAuthRateLimits(before) { return db().auth_rate_limits.deleteMany({ where: { window_start: { lt: before } } }); },
    async authenticateGoogle(claims) {
      return db().$transaction(async tx => {
        let user = await tx.users.findUnique({ where: { google_id: claims.sub } });
        if (user) {
          if (!user.is_active || user.email.toLowerCase() !== claims.email.toLowerCase()) throw new Error('GOOGLE_ACCOUNT_UNAVAILABLE');
          return user;
        }
        user = await tx.users.findUnique({ where: { email: claims.email.toLowerCase() } });
        if (user) {
          if (!user.is_active || user.google_id) throw new Error('GOOGLE_ACCOUNT_LINK_CONFLICT');
          // Link only through Google's verified email; keep the database role unchanged.
          return tx.users.update({ where: { id: user.id }, data: { google_id: claims.sub, name: user.name || claims.name, updated_at: new Date() } });
        }
        return tx.users.create({ data: { google_id: claims.sub, email: claims.email.toLowerCase(), name: claims.name.slice(0, 160), role: 'customer' } });
      }, { isolationLevel: 'Serializable' });
    },
    async linkGoogle(userId, claims) {
      return db().$transaction(async tx => {
        const owner = await tx.users.findUnique({ where: { google_id: claims.sub }, select: { id: true } });
        if (owner && owner.id !== userId) throw new Error('GOOGLE_ACCOUNT_LINK_CONFLICT');
        const user = await tx.users.findFirst({ where: { id: userId, is_active: true } });
        if (!user || user.email.toLowerCase() !== claims.email.toLowerCase() || (user.google_id && user.google_id !== claims.sub)) throw new Error('GOOGLE_ACCOUNT_LINK_CONFLICT');
        return tx.users.update({ where: { id: userId }, data: { google_id: claims.sub, updated_at: new Date() } });
      }, { isolationLevel: 'Serializable' });
    },
    async createSession(userId, lifetimeMs = 1000 * 60 * 60 * 24 * 14) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + lifetimeMs);
      await db().customer_sessions.create({ data: { token_hash: hash(token), user_id: userId, expires_at: expiresAt } });
      return { token, expiresAt };
    },
    async findSession(token) {
      const session = await db().customer_sessions.findFirst({ where: { token_hash: hash(token), expires_at: { gt: new Date() }, users: { is_active: true } },
        select: { token_hash: true, expires_at: true, users: { select: { id: true, email: true, name: true, google_id: true, role: true, user_roles: { select: { role: true } } } } } });
      if (session?.users) session.users.admin_permissions = await adminPermissions(db(), session.users);
      return session;
    },
    async dashboardPath(userId) {
      const user = await db().users.findFirst({ where: { id: userId, is_active: true }, select: { id: true, email: true, google_id: true, role: true, user_roles: { select: { role: true } } } });
      const permissions = user ? await adminPermissions(db(), user) : [];
      if (permissions.includes('roles') || permissions.includes('catalog')) return '/admin';
      if (permissions.includes('orders')) return '/admin';
      return '/';
    },
    async deleteSession(token) { await db().customer_sessions.deleteMany({ where: { token_hash: hash(token) } }); },
  };
}
module.exports = { createCustomerAuthRepository };
