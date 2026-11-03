const { dashboardText } = require('../../config/admin-dashboard-i18n');

exports.createDashboardController = repository => async (req, res) => {
  const permissions = res.locals.adminPermissions || [];
  const { stats, latestOrders } = await repository.dashboard(permissions);
  const t = key => dashboardText(req.locale, key);
  res.set('Cache-Control', 'no-store');
  res.render('layouts/admin', { title: t('title'), contentView: '../admin/dashboard', stats, latestOrders });
};
