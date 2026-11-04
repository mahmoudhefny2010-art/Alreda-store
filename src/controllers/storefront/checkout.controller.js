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
function createCheckoutController({ service, repository, cartRepository, notificationWorker, logger = console, instapay = { enabled: false } }) {
  return {
    async page(req, res) {
      let policy;
      try { policy = service.checkoutSettings ? await service.checkoutSettings() : service.settings; }
      catch (error) {
        if (!['SHIPPING_UNAVAILABLE', 'SHIPPING_NOT_CONFIGURED'].includes(error.code)) throw error;
        return res.status(503).render('layouts/storefront', { title: res.locals.t('shipping'), contentView: '../storefront/shipping-pending', shippingError: error.code });
      }
      const [latestOrder, cart] = await Promise.all([
        repository.latestCustomerOrder(res.locals.orderUserId),
        cartRepository ? cartRepository.get({ userId: res.locals.orderUserId }) : null,
      ]);
      const savedDetails = savedCheckoutDetails(latestOrder, policy.shippingRates);
      const cartQuantities = Object.fromEntries((cart?.cart_items || []).map(item => [item.variant_id || item.product_id, item.quantity]));
      const products = cart?.cart_items?.length ? cart.cart_items.map(item => ({ ...item.products, variant_id: item.variant_id,
        stock_quantity: item.product_variants ? item.product_variants.stock_quantity : item.products.stock_quantity })) : await repository.products();
      res.render('layouts/storefront', { title: res.locals.t('checkoutTitle'), contentView: '../storefront/checkout', products, cartQuantities, savedDetails, policy, instapay, requestKey: randomUUID() });
    },
    async create(req, res) {
      const result = await service.submit(res.locals.orderUserId, req.get('Idempotency-Key'), req.body);
      if (result.order?.id && result.order.status === 'PLACED') {
        try { await notificationWorker?.processOrderPlaced(result.order.id); }
        catch { logger.error({ event: 'order_notification_dispatch_failed', code: 'WORKER_ERROR' }); }
      }
      res.status(result.state === 'pending_verification' ? 202 : 200).json(result);
    },
    async status(req, res) {
      const result = await service.reconcile(res.locals.orderUserId, req.params.key);
      res.status(result.state === 'pending_verification' ? 202 : 200).json(result);
    },
  };
}
module.exports = { createCheckoutController };
