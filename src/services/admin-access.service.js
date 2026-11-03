const allPermissions = ['orders', 'catalog', 'roles'];
function permissionsForRole(role) { return role === 'admin' ? allPermissions : role === 'catalog_manager' ? ['catalog'] : role === 'order_manager' ? ['orders'] : []; }
async function adminPermissions(db, user) {
  if (user.role === 'admin' || user.user_roles?.some(entry => entry.role === 'admin')) return allPermissions;
  if (!user.google_id || !user.email) return [];
  const grant = await db.admin_access_grants.findUnique({ where: { email: user.email.toLowerCase() }, select: { role: true, is_active: true } });
  return grant?.is_active ? permissionsForRole(grant.role) : [];
}
module.exports = { adminPermissions, permissionsForRole };
