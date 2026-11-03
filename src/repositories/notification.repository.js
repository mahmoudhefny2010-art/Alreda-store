const { getPrismaClient } = require('../config/prisma');

function createNotificationRepository(clientProvider = getPrismaClient) {
  const db = () => clientProvider();
  return {
    async ownsSubscription(userId, subscriptionId) {
      return Boolean(await db().push_subscribers.findFirst({ where: { user_id: userId, onesignal_subscription_id: subscriptionId, users: { is_active: true } }, select: { id: true } }));
    },
    async savePreferences(userId, transactional, marketing) {
      return db().notification_preferences.upsert({ where: { user_id: userId }, create: { user_id: userId, transactional_enabled: transactional, marketing_enabled: marketing },
        update: { transactional_enabled: transactional, marketing_enabled: marketing, updated_at: new Date() } });
    },
    async registerSubscription(userId, subscriptionId) {
      return db().$transaction(async tx => {
        const user = await tx.users.findFirst({ where: { id: userId, is_active: true }, select: { id: true } });
        if (!user) throw new Error('CUSTOMER_UNAVAILABLE');
        const existing = await tx.push_subscribers.findUnique({ where: { onesignal_subscription_id: subscriptionId }, select: { user_id: true } });
        if (existing && existing.user_id !== userId) throw new Error('SUBSCRIPTION_CONFLICT');
        return tx.push_subscribers.upsert({ where: { onesignal_subscription_id: subscriptionId }, create: { user_id: userId, external_id: userId, onesignal_subscription_id: subscriptionId }, update: { external_id: userId } });
      });
    },
    async unregisterSubscription(userId, subscriptionId) {
      return db().push_subscribers.deleteMany({ where: { user_id: userId, ...(subscriptionId ? { onesignal_subscription_id: subscriptionId } : {}) } });
    },
    async listHistory(limit = 100) {
      return db().notification_attempts.findMany({ take: limit, orderBy: [{ attempted_at: 'desc' }, { id: 'desc' }], include: { outbox: { select: { event_type: true, user_id: true, order_id: true, status: true, dedupe_key: true, payload: true } } } });
    },
    async reminderMinutes() {
      const record = await db().site_settings.findUnique({ where: { setting_key: 'abandoned_cart_after_minutes' }, select: { value_en: true } });
      const parsed = Number(record?.value_en);
      return Number.isInteger(parsed) && parsed >= 15 && parsed <= 10080 ? parsed : 120;
    },
    async saveReminderMinutes(minutes) {
      return db().site_settings.upsert({ where: { setting_key: 'abandoned_cart_after_minutes' }, create: { setting_key: 'abandoned_cart_after_minutes', value_en: String(minutes) },
        update: { value_en: String(minutes), updated_at: new Date() } });
    },
  };
}
module.exports = { createNotificationRepository };
