const { z } = require('zod');

const whatsappSchema = z.object({
  WHATSAPP_PHONE: z.preprocess(value => value === '' ? undefined : value,
    z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).transform(value => value.replace('+', '')).optional()),
  WHATSAPP_GREETING: z.string().trim().min(1).max(500).default('Hello Alreda Store, I would like to ask about your products.'),
});

function createWhatsAppConfig(source = process.env) {
  const result = whatsappSchema.safeParse(source);
  if (!result.success) throw new Error('Invalid WhatsApp configuration. Check WHATSAPP_PHONE and WHATSAPP_GREETING.');
  if (!result.data.WHATSAPP_PHONE) return null;
  const href = new URL(`https://wa.me/${result.data.WHATSAPP_PHONE}`);
  href.searchParams.set('text', result.data.WHATSAPP_GREETING);
  return Object.freeze({ href: href.toString() });
}

module.exports = { createWhatsAppConfig, whatsappSchema };
