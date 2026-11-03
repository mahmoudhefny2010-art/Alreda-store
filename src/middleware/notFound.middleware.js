module.exports = (req, res) => {
  res.status(404).render('layouts/storefront', { title: res.locals.t('notFoundTitle'), contentView: '../errors/404' });
};
