const { z } = require('zod');
const amount = z.coerce.number().int().min(0).max(1000000);
const plain = max => z.string().trim().min(1).max(max).refine(value => !/[<>]/.test(value) && [...value].every(char => char.codePointAt(0) >= 32 || char === '\n' || char === '\r'));
const singleLine = max => plain(max).refine(value => !/[\r\n]/.test(value));
const localPath = z.string().trim().max(500).default('/').refine(value => {
  try { const url = new URL(value, 'https://store.invalid'); return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && url.origin === 'https://store.invalid'; } catch { return false; }
});
const shippingSchema = z.object({ mode: z.enum(['FLAT', 'CITY']), flatFee: amount,
  zones: z.array(z.object({ city: singleLine(80), cityAr: singleLine(100), fee: amount, enabled: z.boolean() }).strict()).max(100),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.zones.map(zone => zone.city.toLowerCase())).size !== value.zones.length) ctx.addIssue({ code: 'custom', message: 'Duplicate delivery area' });
});
const messageSchema = z.object({ titleEn: singleLine(100), titleAr: singleLine(100), bodyEn: plain(500), bodyAr: plain(500), url: localPath }).strict();
const eventSchema = z.enum(['ORDER_PLACED', 'ORDER_STATUS', 'ABANDONED_CART']);
const templateSchema = z.object({ eventType: eventSchema, enabled: z.boolean(), message: messageSchema }).strict();
const audienceSchema = z.enum(['ALL', 'ACTIVE_CART', 'CUSTOMERS_WITH_ORDERS']);
const campaignSchema = z.object({ requestKey: z.uuid().transform(value => value.toLowerCase()), audience: audienceSchema, message: messageSchema }).strict();
module.exports = { shippingSchema, messageSchema, templateSchema, campaignSchema, audienceSchema, eventSchema };
