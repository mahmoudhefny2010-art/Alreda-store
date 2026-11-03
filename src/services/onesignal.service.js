const { z } = require('zod');
const { renderMessage } = require('../config/push-messages');

const envSchema = z.object({ ONESIGNAL_APP_ID: z.string().uuid(), ONESIGNAL_REST_API_KEY: z.string().min(20) });
function createOneSignalService({ settings = process.env, fetchImpl = fetch } = {}) {
  const parsed = envSchema.safeParse(settings);
  return {
    get enabled() { return parsed.success; },
    async send({ subscriptionIds, eventType, payload, deliveryKey }) {
      if (!parsed.success) throw new Error('PROVIDER_NOT_CONFIGURED');
      if (!subscriptionIds.length) return { skipped: true, messageId: '' };
      const message = renderMessage(eventType, payload);
      // The provider expects an absolute HTTPS launch URL. On localhost, omit
      // it and use the website origin configured in the OneSignal dashboard.
      const launchPath = message.url;
      delete message.url;
      try {
        const origin = new URL(settings.CHECKOUT_ORIGIN || settings.GOOGLE_CALLBACK_URL);
        if (origin.protocol === 'https:' && !origin.username && !origin.password) message.url = new URL(launchPath, origin.origin).href;
      } catch { /* No public launch origin configured; use the provider default. */ }
      const response = await fetchImpl('https://api.onesignal.com/notifications', { method: 'POST', headers: { Authorization: `Key ${parsed.data.ONESIGNAL_REST_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: parsed.data.ONESIGNAL_APP_ID, include_subscription_ids: subscriptionIds, ...message,
          ...(deliveryKey ? { idempotency_key: z.uuid().parse(deliveryKey) } : {}), data: { eventType, reference: payload.reference || '' } }), signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`ONESIGNAL_HTTP_${response.status}`);
      let result;
      try { result = await response.json(); } catch { throw new Error('ONESIGNAL_INVALID_RESPONSE'); }
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('ONESIGNAL_INVALID_RESPONSE');
      if (!result.id || typeof result.id !== 'string') {
        const errors = Array.isArray(result.errors) ? result.errors : [];
        if (errors.some(value => typeof value === 'string' && /all included players are not subscribed/i.test(value))) {
          throw new Error('ONESIGNAL_NO_ACTIVE_SUBSCRIPTIONS');
        }
        throw new Error('ONESIGNAL_NO_MESSAGE');
      }
      return { skipped: false, messageId: typeof result.id === 'string' ? result.id.slice(0, 160) : '' };
    },
  };
}
module.exports = { createOneSignalService };
