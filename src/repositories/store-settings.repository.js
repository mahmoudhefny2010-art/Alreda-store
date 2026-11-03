const { getPrismaClient } = require('../config/prisma');
const { adminPermissions } = require('../services/admin-access.service');
const { shippingSchema, templateSchema, campaignSchema } = require('../validators/store-settings.validator');
const { createHash } = require('node:crypto');

function deliveryRates(config) {
  return { rates: Object.fromEntries(config.zones.filter(zone => zone.enabled).map(zone => [zone.city, config.mode === 'FLAT' ? config.flatFee : zone.fee])),
    labels: Object.fromEntries(config.zones.map(zone => [zone.city, zone.cityAr])) };
}
async function readDelivery(db, fallback = {}) {
  const row = await db.site_settings.findUnique({ where: { setting_key: 'delivery_configuration' } });
  if (!row) return { rates: fallback, labels: {} };
  return deliveryRates(shippingSchema.parse(JSON.parse(row.value_en)));
}
function audienceWhere(audience) {
  return { is_active: true, notification_preferences: { is: { marketing_enabled: true } }, push_subscribers: { some: {} },
    ...(audience === 'ACTIVE_CART' ? { shopping_carts: { some: { status: 'ACTIVE', cart_items: { some: {} } } } } : {}),
    ...(audience === 'CUSTOMERS_WITH_ORDERS' ? { orders_orders_user_idTousers: { some: {} } } : {}) };
}
function createStoreSettingsRepository(provider = getPrismaClient) {
  async function permit(tx, actorId) {
    const actor = await tx.users.findFirst({ where: { id: actorId, is_active: true }, include: { user_roles: true } });
    if (!actor || !(await adminPermissions(tx, actor)).includes('orders')) throw new Error('ADMIN_REQUIRED');
  }
  async function store(tx, key, value) {
    const json = JSON.stringify(value);
    return tx.site_settings.upsert({ where: { setting_key: key }, create: { setting_key: key, value_en: json }, update: { value_en: json, updated_at: new Date() } });
  }
  return {
    async shipping() {
      const row = await provider().site_settings.findUnique({ where: { setting_key: 'delivery_configuration' } });
      return row ? shippingSchema.parse(JSON.parse(row.value_en)) : null;
    },
    async saveShipping(actorId, value) {
      const config = shippingSchema.parse(value);
      return provider().$transaction(async tx => { await permit(tx, actorId); await store(tx, 'delivery_configuration', config);
        await tx.admin_audit_events.create({ data: { actor_id: actorId, action: 'DELIVERY_SETTINGS_UPDATED', target_id: 'delivery_configuration' } }); });
    },
    async templates() {
      const rows = await provider().site_settings.findMany({ where: { setting_key: { startsWith: 'push_template:' } } });
      return rows.map(row => templateSchema.parse(JSON.parse(row.value_en)));
    },
    async saveTemplate(actorId, value) {
      const template = templateSchema.parse(value);
      return provider().$transaction(async tx => { await permit(tx, actorId); await store(tx, `push_template:${template.eventType}`, template);
        await tx.admin_audit_events.create({ data: { actor_id: actorId, action: 'PUSH_TEMPLATE_UPDATED', target_id: template.eventType } }); });
    },
    async audienceCounts() {
      const db = provider();
      const values = await Promise.all(['ALL', 'ACTIVE_CART', 'CUSTOMERS_WITH_ORDERS'].map(async audience => [audience, await db.users.count({ where: audienceWhere(audience) })]));
      return Object.fromEntries(values);
    },
    async queueCampaign(actorId, value) {
      const input = campaignSchema.parse(value), hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      return provider().$transaction(async tx => {
        await permit(tx, actorId);
        // Serialize duplicate submissions without exposing recipient lists to logs or browser state.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestKey}))`;
        const key = `push_campaign:${input.requestKey}`;
        const previous = await tx.site_settings.findUnique({ where: { setting_key: key } });
        if (previous) { const saved = JSON.parse(previous.value_en); if (saved.hash !== hash || saved.actorId !== actorId) throw new Error('CAMPAIGN_KEY_CONFLICT'); return saved; }
        const recipients = await tx.users.findMany({ where: audienceWhere(input.audience), select: { id: true }, take: 5001, orderBy: { id: 'asc' } });
        if (!recipients.length) throw new Error('NO_ELIGIBLE_RECIPIENTS');
        if (recipients.length > 5000) throw new Error('CAMPAIGN_AUDIENCE_TOO_LARGE');
        await tx.notification_outbox.createMany({ data: recipients.map(user => ({ user_id: user.id, event_type: 'ADMIN_CAMPAIGN',
          dedupe_key: `campaign:${input.requestKey}:${user.id}`, payload: { campaignId: input.requestKey, audience: input.audience, message: input.message } })) });
        const saved = { hash, actorId, count: recipients.length, audience: input.audience, queuedAt: new Date().toISOString() };
        await store(tx, key, saved);
        await tx.admin_audit_events.create({ data: { actor_id: actorId, action: 'PUSH_CAMPAIGN_QUEUED', target_id: input.requestKey } });
        return saved;
      }, { maxWait: 5000, timeout: 30000 });
    },
    async campaign(key) { const row = await provider().site_settings.findUnique({ where: { setting_key: `push_campaign:${key}` } }); return row ? JSON.parse(row.value_en) : null; },
  };
}
module.exports = { createStoreSettingsRepository, readDelivery, deliveryRates, audienceWhere };
