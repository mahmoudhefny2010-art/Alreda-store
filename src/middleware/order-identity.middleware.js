const { z } = require('zod');
const { OrderError } = require('../validators/order.validator');
function orderIdentity({ authenticate, repository, admin = false, permission = 'orders', allowAnyAdmin = false }) {
  return async (req, res, next) => {
    try {
      // No HTTP header, body user ID, role or cookie is trusted here without the authentication adapter.
      const identity = authenticate ? await authenticate(req) : null;
      const result = z.uuid().safeParse(identity?.userId);
      if (!result.success) throw new OrderError('AUTHENTICATION_REQUIRED', 401);
      const principal = await repository.principal(result.data);
      if (!principal) throw new OrderError('AUTHENTICATION_REQUIRED', 401);
      const permissions = principal.role === 'admin' || principal.user_roles.some(value => value.role === 'admin')
        ? ['orders', 'catalog', 'roles'] : principal.admin_permissions || [];
      if (admin && !permissions.includes(permission) || allowAnyAdmin && permissions.length === 0) throw new OrderError('ADMIN_REQUIRED', 403);
      res.locals.orderUserId = principal.id;
      res.locals.adminPermissions = permissions;
      next();
    } catch (error) {
      if (error instanceof OrderError) return next(error);
      const failure = new OrderError('ORDERS_UNAVAILABLE', 503);
      // Keep diagnostics bounded: provider messages may contain connection details.
      failure.diagnosticCode = /^P\d{4}$/.test(error?.code || '') ? error.code : 'IDENTITY_LOOKUP_FAILED';
      req.app.locals.logger?.error({ event: 'order_identity_failed', code: failure.diagnosticCode });
      next(failure);
    }
  };
}
module.exports = { orderIdentity };
