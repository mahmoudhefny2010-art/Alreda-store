const { z } = require('zod');

const optionalValue = schema => z.preprocess(value => value === '' ? undefined : value, schema.optional());
const configSchema = z.object({
  WHATSAPP_BUSINESS_PHONE_NUMBER_ID: optionalValue(z.string().trim().regex(/^\d{5,30}$/)),
  WHATSAPP_ACCESS_TOKEN: optionalValue(z.string().trim().min(1).max(8192)),
  WHATSAPP_ORDER_RECIPIENT: optionalValue(z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).transform(value => value.replace(/^\+/, ''))),
  WHATSAPP_ORDER_TEMPLATE: z.preprocess(value => value === '' || value === undefined ? 'order_confirmation' : value,
    z.string().trim().regex(/^[a-z0-9_]{1,512}$/)),
  WHATSAPP_ORDER_TEMPLATE_LANGUAGE: z.preprocess(value => value === '' || value === undefined ? 'en_US' : value,
    z.string().trim().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/)),
  WHATSAPP_GRAPH_API_VERSION: z.preprocess(value => value === '' || value === undefined ? 'v23.0' : value,
    z.string().trim().regex(/^v\d{2}\.0$/)),
});

function limitedText(value, limit) {
  const clean = Array.from(String(value || ''), character => {
    const code = character.codePointAt(0);
    return code >= 32 && code !== 127 ? character : ' ';
  }).join('').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, limit).join('');
}

function orderParameters(order) {
  let shipping = {};
  try {
    const snapshot = JSON.parse(order.address_snapshot);
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) shipping = snapshot;
  } catch { /* Older free-form address snapshots have no structured fields. */ }
  const items = (order.order_items || []).map(item => `${limitedText(item.product_name, 90)} x ${item.quantity}`).join('; ');
  const address = [shipping.address, shipping.city, shipping.country].filter(Boolean).map(part => limitedText(part, 100)).join(', ');
  const values = [
    order.order_number,
    order.customer_name,
    order.customer_phone,
    address || 'Not provided',
    items || 'No items listed',
    String(order.total_egp),
  ].map(value => limitedText(value, 900));
  return values.map(text => ({ type: 'text', text: text || '-' }));
}

function createWhatsAppOrderService({ settings = process.env, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const result = configSchema.safeParse(settings);
  if (!result.success) throw new Error('Invalid WhatsApp order notification configuration.');
  const config = result.data;
  const required = ['WHATSAPP_BUSINESS_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_ORDER_RECIPIENT'];
  const configured = required.filter(key => config[key]);
  if (configured.length > 0 && configured.length < required.length) throw new Error('Incomplete WhatsApp order notification configuration.');
  if (configured.length === 0) return Object.freeze({ enabled: false, sendOrder: async () => ({ status: 'not_configured' }) });

  const endpoint = `https://graph.facebook.com/${config.WHATSAPP_GRAPH_API_VERSION}/${config.WHATSAPP_BUSINESS_PHONE_NUMBER_ID}/messages`;
  return Object.freeze({
    enabled: true,
    async sendOrder(order) {
      if (order.status !== 'CONFIRMED') return { status: 'not_confirmed' };
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: config.WHATSAPP_ORDER_RECIPIENT,
            type: 'template',
            template: {
              name: config.WHATSAPP_ORDER_TEMPLATE,
              language: { code: config.WHATSAPP_ORDER_TEMPLATE_LANGUAGE },
              components: [{ type: 'body', parameters: orderParameters(order) }],
            },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new Error('WHATSAPP_TIMEOUT', { cause: error });
        if (error?.name === 'TypeError') throw new Error('WHATSAPP_NETWORK_ERROR', { cause: error });
        throw error;
      }
      if (!response.ok) throw new Error(`WHATSAPP_HTTP_${response.status}`);
      const body = await response.json();
      const messageId = body?.messages?.[0]?.id;
      if (typeof messageId !== 'string' || !messageId) throw new Error('WHATSAPP_INVALID_RESPONSE');
      return { status: 'sent', messageId };
    },
  });
}

module.exports = { createWhatsAppOrderService, orderParameters };
