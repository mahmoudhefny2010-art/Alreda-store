const { shippingSchema, messageSchema } = require('../../src/validators/store-settings.validator');
const { createOneSignalService } = require('../../src/services/onesignal.service');
const { deliveryRates } = require('../../src/repositories/store-settings.repository');
const { renderMessage } = require('../../src/config/push-messages');
const message = { titleEn: 'Hello', titleAr: 'مرحبًا', bodyEn: 'Your order {reference}: {status}', bodyAr: 'طلبك {reference}: {status}', url: '/products' };
it('validates delivery areas and supports free/flat shipping without enabling unselected areas', () => {
  const config = shippingSchema.parse({ mode: 'FLAT', flatFee: 0, zones: [{ city: 'Cairo', cityAr: 'القاهرة', fee: 30, enabled: true }, { city: 'Giza', cityAr: 'الجيزة', fee: 40, enabled: false }] });
  expect(deliveryRates(config).rates).toEqual({ Cairo: 0 });
  expect(() => shippingSchema.parse({ ...config, zones: [...config.zones, config.zones[0]] })).toThrow();
});
it('rejects external and unsafe notification links and renders localized order placeholders', () => {
  for (const url of ['https://example.com', '//example.com', '/\\example.com']) expect(() => messageSchema.parse({ ...message, url })).toThrow();
  expect(() => messageSchema.parse({ ...message, bodyEn: '<script>bad()</script>' })).toThrow();
  expect(renderMessage('ORDER_STATUS', { message, reference: 'AS-TEST', status: 'CONFIRMED' })).toMatchObject({ contents: { en: 'Your order AS-TEST: Confirmed', ar: 'طلبك AS-TEST: مؤكد' } });
});
it('sends custom bilingual content with retry deduplication and rejects an empty provider receipt', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'synthetic-message' }) }));
  const service = createOneSignalService({ settings: { ONESIGNAL_APP_ID: '7f862239-6261-47e9-a54a-63f21437f14e', ONESIGNAL_REST_API_KEY: 'synthetic-provider-key-not-real', CHECKOUT_ORIGIN: 'https://store.example' }, fetchImpl });
  const deliveryKey = 'a836d7d7-65f9-4c40-9bc4-0b76581e35cc';
  await service.send({ subscriptionIds: ['synthetic-subscription'], eventType: 'ADMIN_CAMPAIGN', payload: { message }, deliveryKey });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ idempotency_key: deliveryKey, headings: { en: 'Hello', ar: 'مرحبًا' }, contents: { en: expect.any(String) }, url: 'https://store.example/products' });
  fetchImpl.mockResolvedValue({ ok: true, json: async () => ({}) });
  await expect(service.send({ subscriptionIds: ['synthetic-subscription'], eventType: 'ADMIN_CAMPAIGN', payload: { message }, deliveryKey })).rejects.toThrow('ONESIGNAL_NO_MESSAGE');
});
