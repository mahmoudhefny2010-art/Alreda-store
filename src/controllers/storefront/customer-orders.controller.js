const { createCustomerOrdersService, customerOrderPresentation } = require('../../services/customer-orders.service');
function createCustomerOrdersController(repository) {
  const service = createCustomerOrdersService(repository);
  return {
    async index(req, res) {
      const presentation = customerOrderPresentation(res.locals.locale);
      const history = await service.list(res.locals.orderUserId, req.query);
      res.render('layouts/storefront', { title: presentation.copy.title, contentView: '../storefront/customer-orders', ...presentation, history, order: null });
    },
    async detail(req, res) {
      const presentation = customerOrderPresentation(res.locals.locale);
      const order = await service.detail(res.locals.orderUserId, req.params.id);
      res.render('layouts/storefront', { title: presentation.copy.title, contentView: '../storefront/customer-orders', ...presentation, history: null, order });
    },
  };
}
module.exports = { createCustomerOrdersController };
