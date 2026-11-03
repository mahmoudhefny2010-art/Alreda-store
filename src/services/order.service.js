const { createHash } = require('node:crypto');
const { createOrderRepository } = require('../repositories/order.repository');
const { parseOrder, parseKey, policySchema, settlementSchema, OrderError } = require('../validators/order.validator');
function validStoredOrder(order, userId) {
  if (!order || order.user_id !== userId || !order.order_number || !order.customer_name || !order.customer_phone || !order.order_items.length) return false;
  try { const address = JSON.parse(order.address_snapshot); if (!address.address || !address.city || !address.email) return false; } catch { return false; }
  const subtotal = order.order_items.reduce((sum, item) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.unit_price_egp) || item.unit_price_egp < 0 || item.line_total_egp !== item.quantity * item.unit_price_egp) return NaN;
    return sum + item.line_total_egp;
  }, 0);
  return Number.isSafeInteger(subtotal) && subtotal === order.subtotal_egp && order.delivery_fee_egp >= 0 && subtotal + order.delivery_fee_egp === order.total_egp;
}
function publicOrder(order) {
  return { id: order.id, reference: order.order_number, customer: { name: order.customer_name, phone: order.customer_phone },
    shipping: JSON.parse(order.address_snapshot), items: order.order_items, subtotalEgp: order.subtotal_egp,
    shippingEgp: order.delivery_fee_egp, totalEgp: order.total_egp, status: order.status,
    paymentMethod: order.payment_method, paymentStatus: order.payment_status };
}
function fingerprint(input) { return createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
function persistedFingerprint(order) {
  try {
    const address = JSON.parse(order.address_snapshot);
    return fingerprint(parseOrder({ customer: { name: order.customer_name, phone: order.customer_phone, email: address.email },
      shipping: { country: address.country, city: address.city, address: address.address, ...(address.postalCode ? { postalCode: address.postalCode } : {}), ...(address.location ? { location: address.location } : {}) },
      items: order.order_items.map(item => ({ productId: item.product_id, ...(item.variant_id ? { variantId: item.variant_id } : {}), quantity: item.quantity, unitPriceEgp: item.unit_price_egp })),
      expectedTotalEgp: order.total_egp, paymentMethod: order.payment_method, ...(order.payment_proof ? { paymentProofId: order.payment_proof.id } : {}), notes: order.notes }));
  } catch { throw new Error('ORDER_VERIFICATION_FAILED'); }
}
function createOrderService({ repository = createOrderRepository(), policy = {}, paymentProvider, logger = console, shippingProvider, instapay = require('../config/instapay').readInstaPayConfig() } = {}) {
  const settings = shippingProvider ? { ...policySchema.parse({ ...policy, enabled: false }), enabled: policy.enabled === true } : policySchema.parse(policy);
  if (settings.enabled && !settings.origin) throw new Error('CHECKOUT_ORIGIN_REQUIRED');
  async function checkoutSettings() {
    if (!shippingProvider) return settings;
    try {
      const stored = await shippingProvider(settings.shippingRates);
      if (!Object.keys(stored.rates).length) throw new OrderError('SHIPPING_NOT_CONFIGURED', 503);
      const current = policySchema.parse({ ...settings, shippingRates: stored.rates });
      return { ...current, shippingLabels: stored.labels || {} };
    } catch (error) { if (error instanceof OrderError) throw error; throw new OrderError('SHIPPING_UNAVAILABLE', 503); }
  }
  function enabled() { if (!settings.enabled) throw new OrderError('CHECKOUT_UNAVAILABLE', 503); }
  const pending = () => ({ state: 'pending_verification', confirmed: false, retryWithSameKey: true });
  async function verify(userId, key, expectedHash) {
    const request = await repository.findRequest(userId, key);
    if (!request) return null;
    if (expectedHash && request.request_hash !== expectedHash) throw new OrderError('IDEMPOTENCY_CONFLICT');
    const order = await repository.getAdminOrder(request.order_id);
    if (!validStoredOrder(order, userId) || order.id !== request.order_id || persistedFingerprint(order) !== request.request_hash) throw new Error('ORDER_VERIFICATION_FAILED');
    if (order.status === 'CANCELLED') return { state: 'cancelled', confirmed: false, order: publicOrder(order) };
    if (order.payment_method === 'INSTAPAY' && order.payment_status !== 'PAID') return { state: 'awaiting_admin_confirmation', confirmed: false, recorded: true, order: publicOrder(order) };
    return { state: 'confirmed', confirmed: true, order: publicOrder(order) };
  }
  function log(stage) { logger.error({ event: 'order_reconciliation_required', stage }); }
  return {
    settings,
    checkoutSettings,
    async submit(userId, keyValue, body) {
      enabled();
      const key = parseKey(keyValue); const input = parseOrder(body);
      const hash = fingerprint(input);
      // Reconcile before applying today's pricing/shipping policy to a previously committed request.
      try { const previous = await verify(userId, key, hash); if (previous) return previous; }
      catch (error) { if (error instanceof OrderError) throw error; log('preflight'); return pending(); }
      const current = await checkoutSettings();
      if (input.paymentMethod === 'INSTAPAY' && !instapay.enabled) throw new OrderError('PAYMENT_METHOD_UNAVAILABLE', 400);
      const fee = current.shippingRates[input.shipping.city];
      if (!Object.hasOwn(current.shippingRates, input.shipping.city)) throw new OrderError('UNSUPPORTED_SHIPPING', 400);
      if (input.paymentMethod === 'ONLINE' && !paymentProvider?.verifyWebhook) throw new OrderError('PAYMENT_METHOD_UNAVAILABLE', 400);
      try { await repository.create({ userId, key, hash, input, shippingFee: fee }); }
      catch (error) {
        // Even an apparent transaction/network failure is reconciled before deciding its outcome.
        try { const existing = await verify(userId, key, hash); if (existing) return existing; }
        catch (lookupError) { if (lookupError instanceof OrderError) throw lookupError; log('transaction_reconcile'); return pending(); }
        if (error instanceof OrderError) throw error;
        log('transaction'); return pending();
      }
      try { const result = await verify(userId, key, hash); if (result) return result; }
      catch (error) { if (error instanceof OrderError) throw error; }
      log('post_commit'); return pending();
    },
    async reconcile(userId, keyValue) {
      const key = parseKey(keyValue);
      try { return await verify(userId, key) || pending(); }
      catch { log('recovery'); return pending(); }
    },
    async receivePayment(rawBody, headers) {
      if (!paymentProvider?.verifyWebhook || !Buffer.isBuffer(rawBody)) throw new OrderError('PAYMENT_METHOD_UNAVAILABLE', 503);
      // Only this server-injected provider adapter may verify signature, timestamp, event finality and currency.
      // Browser redirects, client-supplied "paid" fields and unsigned webhooks never reach persistence.
      let event;
      try { event = settlementSchema.parse(await paymentProvider.verifyWebhook(rawBody, headers)); }
      catch { throw new OrderError('PAYMENT_VERIFICATION_FAILED', 400); }
      try { await repository.settle(event); return { received: true }; }
      catch (error) { if (error instanceof OrderError) throw error; logger.error({ event: 'payment_reconciliation_required' }); throw new OrderError('PAYMENT_RETRY_REQUIRED', 503); }
    },
  };
}
module.exports = { createOrderService, validStoredOrder };
