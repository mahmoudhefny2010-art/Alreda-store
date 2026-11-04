const { z } = require('zod');
const text = (min, max) => z.string().trim().min(min).max(max).refine(value => [...value].every(char => char.codePointAt(0) >= 32 && char.codePointAt(0) !== 127));
const integerMoney = z.number().int().min(0).max(100000000);
function normalizeEgyptianPhone(value) {
  const digits = value.trim().replace(/[\s().-]/g, '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
  const local = digits.replace(/^\+?20/, '');
  const national = local.startsWith('0') ? local : `0${local}`;
  return /^01[0125]\d{8}$/.test(national) ? `+20${national.slice(1)}` : '';
}
const egyptianPhone = z.string().trim().min(8).max(24).transform(normalizeEgyptianPhone).pipe(z.string().regex(/^\+201[0125]\d{8}$/));
const deliveryLocationSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(1000000).optional() }).strict();
const orderInput = z.object({
  customer: z.object({ name: text(2, 160), email: z.email().max(254), phone: egyptianPhone }).strict(),
  shipping: z.object({ country: z.literal('EG'), city: text(2, 80), address: text(5, 300), postalCode: z.string().regex(/^[0-9]{5}$/).optional(), location: deliveryLocationSchema.optional() }).strict(),
  items: z.array(z.object({ productId: z.uuid().transform(value => value.toLowerCase()), variantId: z.uuid().transform(value => value.toLowerCase()).optional(), quantity: z.number().int().min(1).max(50), unitPriceEgp: integerMoney }).strict()).min(1).max(30),
  expectedTotalEgp: integerMoney,
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'ONLINE', 'INSTAPAY']),
  paymentProofId: z.uuid().transform(value => value.toLowerCase()).optional(),
  notes: text(0, 500).default(''),
}).strict().superRefine((value, ctx) => {
  if ((value.paymentMethod === 'INSTAPAY') !== Boolean(value.paymentProofId)) ctx.addIssue({ code: 'custom', path: ['paymentProofId'], message: 'PAYMENT_PROOF_REQUIRED' });
  if (new Set(value.items.map(item => `${item.productId}:${item.variantId || ''}`)).size !== value.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Duplicate selections' });
});
const policySchema = z.object({ enabled: z.boolean().default(false), origin: z.url().optional(),
  shippingRates: z.record(z.string().min(2).max(80), integerMoney).default({}) }).strict().superRefine((value, ctx) => {
  if (value.enabled && (!value.origin || !Object.keys(value.shippingRates).length)) ctx.addIssue({ code: 'custom', message: 'Enabled checkout requires origin and shipping rates' });
});
const settlementSchema = z.object({ provider: text(1, 64), eventId: text(1, 160), paymentReference: text(1, 160),
  orderId: z.uuid(), amountEgp: integerMoney.positive(), currency: z.literal('EGP'), status: z.literal('paid') }).strict();
class OrderError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
function parseOrder(input) {
  const parsed = orderInput.safeParse(input);
  if (!parsed.success) throw new OrderError('INVALID_ORDER', 400);
  return { ...parsed.data, items: parsed.data.items.sort((a, b) => `${a.productId}:${a.variantId || ''}`.localeCompare(`${b.productId}:${b.variantId || ''}`)) };
}
function parseKey(value) { const result = z.uuid().safeParse(value); if (!result.success) throw new OrderError('INVALID_IDEMPOTENCY_KEY', 400); return result.data.toLowerCase(); }
module.exports = { parseOrder, parseKey, policySchema, settlementSchema, deliveryLocationSchema, OrderError, normalizeEgyptianPhone };
