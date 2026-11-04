const { randomUUID } = require('node:crypto');
function savedCheckoutDetails(order, shippingRates) {
  let shipping = {};
  try {
    const snapshot = JSON.parse(order?.address_snapshot || '');
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) shipping = snapshot;
  } catch { /* Older orders may not have a structured delivery snapshot. */ }
  return {
    name: typeof order?.customer_name === 'string' ? order.customer_name : '',
    phone: typeof order?.customer_phone === 'string' ? order.customer_phone : '',
    email: typeof shipping.email === 'string' ? shipping.email : '',
    address: typeof shipping.address === 'string' ? shipping.address : '',
    city: typeof shipping.city === 'string' && Object.hasOwn(shippingRates, shipping.city) ? shipping.city : '',
    postalCode: typeof shipping.postalCode === 'string' ? shipping.postalCode : '',
  };
}
function createCheckoutController({ service, repository, cartRepository, instapay = { enabled: false } }) {
  return {
    async page(req, res) {
      let policy;
      try { policy = service.checkoutSettings ? await service.checkoutSettings() : service.settings; }
      catch (error) {
        if (!['SHIPPING_UNAVAILABLE', 'SHIPPING_NOT_CONFIGURED'].includes(error.code)) throw error;
        return res.status(503).render('layouts/storefront', { title: res.locals.t('shipping'), contentView: '../storefront/shipping-pending', shippingError: error.code });
      }
      let products = await repository.products();
      const savedDetails = savedCheckoutDetails(await repository.latestCustomerOrder(res.locals.orderUserId), policy.shippingRates);
      const cart = cartRepository ? await cartRepository.get({ userId: res.locals.orderUserId }) : null;
      const cartQuantities = Object.fromEntries((cart?.cart_items || []).map(item => [item.variant_id || item.product_id, item.quantity]));
      if (cart?.cart_items?.length) products = cart.cart_items.map(item => ({ ...item.products, variant_id: item.variant_id, stock_quantity: item.product_variants?.stock_quantity ?? item.products.stock_quantity }));
      res.render('layouts/storefront', { title: res.locals.t('checkoutTitle'), contentView: '../storefront/checkout', products, cartQuantities, savedDetails, policy, instapay, requestKey: randomUUID() });
    },
    async create(req, res) {
      const result = await service.submit(res.locals.orderUserId, req.get('Idempotency-Key'), req.body);
      res.status(result.state === 'pending_verification' ? 202 : 200).json(result);
    },
    async status(req, res) {
      const result = await service.reconcile(res.locals.orderUserId, req.params.key);
      res.status(result.state === 'pending_verification' ? 202 : 200).json(result);
    },
  };
}
module.exports = { createCheckoutController };
