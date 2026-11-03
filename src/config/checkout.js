const { policySchema } = require('../validators/order.validator');
function readCheckoutPolicy(source = process.env, { databaseShipping = false } = {}) {
  try {
    if (source.CHECKOUT_ENABLED && !['true', 'false'].includes(source.CHECKOUT_ENABLED)) throw new Error();
    const enabled = source.CHECKOUT_ENABLED === 'true';
    if (enabled && !source.CHECKOUT_ORIGIN) throw new Error();
    const parsed = policySchema.parse({ enabled: databaseShipping ? false : enabled, origin: source.CHECKOUT_ORIGIN || undefined,
      shippingRates: JSON.parse(source.CHECKOUT_SHIPPING_RATES || '{}') });
    return { ...parsed, enabled };
  } catch { throw new Error('Invalid checkout configuration'); }
}
module.exports = { readCheckoutPolicy };
