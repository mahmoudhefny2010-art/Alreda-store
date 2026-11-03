const { getPrismaClient } = require('../config/prisma');
const { createOneSignalService } = require('./onesignal.service');
const { audienceWhere } = require('../repositories/store-settings.repository');
const { templateSchema, audienceSchema } = require('../validators/store-settings.validator');

const configuredReminderMinutes = Number(process.env.ABANDONED_CART_AFTER_MINUTES);
const defaultReminderMinutes = Number.isInteger(configuredReminderMinutes) && configuredReminderMinutes >= 15 && configuredReminderMinutes <= 10080 ? configuredReminderMinutes : 120;
function deliveryFailureCode(error) {
  if (/^ONESIGNAL_HTTP_[0-9]{3}$/.test(error?.message || '')) return error.message;
  if (error?.message === 'PROVIDER_NOT_CONFIGURED') return error.message;
  if (error?.message === 'ONESIGNAL_NO_ACTIVE_SUBSCRIPTIONS') return 'NO_ACTIVE_SUBSCRIPTIONS';
  if (error?.message === 'ONESIGNAL_INVALID_RESPONSE') return 'PROVIDER_INVALID_RESPONSE';
  if (error?.message === 'ONESIGNAL_NO_MESSAGE') return 'PROVIDER_INVALID_RESPONSE';
  if (error?.name === 'AbortError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.code) || error?.cause?.code === 'ETIMEDOUT') return 'PROVIDER_TIMEOUT';
  if (error?.name === 'TypeError' || ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error?.code) || ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error?.cause?.code)) return 'PROVIDER_NETWORK_ERROR';
  if (/^P\d{4}$/.test(error?.code || '')) return 'DATABASE_ERROR';
  return 'DELIVERY_FAILED';
}
function createNotificationWorker({ clientProvider = getPrismaClient, provider = createOneSignalService(), logger = console, clock = () => new Date(), abandonedAfterMinutes = defaultReminderMinutes } = {}) {
  const db = () => clientProvider();
  let running = false;
  async function scheduleAbandonedCarts() {
    const template = await db().site_settings.findUnique({ where: { setting_key: 'push_template:ABANDONED_CART' } });
    if (template && !templateSchema.parse(JSON.parse(template.value_en)).enabled) return;
    let reminderMinutes = abandonedAfterMinutes;
    try {
      const configured = await db().site_settings.findUnique({ where: { setting_key: 'abandoned_cart_after_minutes' }, select: { value_en: true } });
      const parsed = Number(configured?.value_en);
      if (Number.isInteger(parsed) && parsed >= 15 && parsed <= 10080) reminderMinutes = parsed;
    } catch { /* The documented environment default remains available if settings cannot be read. */ }
    const before = new Date(clock().getTime() - reminderMinutes * 60000);
    const carts = await db().shopping_carts.findMany({ where: { status: 'ACTIVE', user_id: { not: null }, updated_at: { lte: before }, cart_items: { some: {} }, cart_reminder: null,
      users: { is_active: true, notification_preferences: { is: { marketing_enabled: true } } } }, select: { id: true, user_id: true, updated_at: true }, take: 100, orderBy: { updated_at: 'asc' } });
    for (const cart of carts) {
      try {
        await db().$transaction(async tx => {
          const reminder = await tx.cart_reminders.create({ data: { cart_id: cart.id, user_id: cart.user_id, run_after: clock() }, select: { id: true } });
          await tx.notification_outbox.create({ data: { user_id: cart.user_id, reminder_id: reminder.id, event_type: 'ABANDONED_CART', dedupe_key: `abandoned-cart:${cart.id}:${clock().getTime()}`, payload: { cartId: cart.id }, available_at: clock() } });
        });
      } catch (error) { if (error.code !== 'P2002') logger.error({ event: 'cart_reminder_schedule_failed', code: 'DATABASE_ERROR' }); }
    }
  }
  async function claim() {
    return db().$transaction(async tx => {
      const rows = await tx.$queryRaw`WITH candidate AS (
        SELECT id FROM public.notification_outbox
        WHERE (status = 'PENDING' AND available_at <= now()) OR (status = 'SENDING' AND locked_until < now())
        ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE public.notification_outbox AS o SET status = 'SENDING', attempts = attempts + 1, locked_until = now() + interval '90 seconds'
        FROM candidate WHERE o.id = candidate.id RETURNING o.id, o.user_id, o.order_id, o.reminder_id, o.event_type, o.payload, o.attempts`;
      return rows[0] || null;
    });
  }
  async function processOne() {
    const job = await claim();
    if (!job) return false;
    try {
      const eventType = job.event_type;
      if (!['ORDER_PLACED', 'ORDER_STATUS', 'ABANDONED_CART', 'ADMIN_CAMPAIGN'].includes(eventType)) throw new Error('UNKNOWN_NOTIFICATION_EVENT');
      let payload = job.payload;
      let templateEnabled = true;
      if (eventType !== 'ADMIN_CAMPAIGN') {
        const saved = await db().site_settings.findUnique({ where: { setting_key: `push_template:${eventType}` } });
        if (saved) { const template = templateSchema.parse(JSON.parse(saved.value_en)); templateEnabled = template.enabled; payload = { ...payload, message: template.message }; }
      }
      const allowed = !templateEnabled ? null : eventType === 'ADMIN_CAMPAIGN'
        ? await db().users.findFirst({ where: { id: job.user_id, ...audienceWhere(audienceSchema.parse(payload.audience)) }, select: { id: true } })
        : eventType === 'ABANDONED_CART'
        ? await db().cart_reminders.findFirst({ where: { id: job.reminder_id, status: 'SCHEDULED', carts: { status: 'ACTIVE', cart_items: { some: {} } }, users: { is_active: true, notification_preferences: { is: { marketing_enabled: true } } } }, select: { id: true } })
        : await db().users.findFirst({ where: { id: job.user_id, is_active: true, notification_preferences: { is: { transactional_enabled: true } } }, select: { id: true } });
      const subscriptions = allowed ? await db().push_subscribers.findMany({ where: { user_id: job.user_id }, select: { onesignal_subscription_id: true } }) : [];
      const delivery = subscriptions.length ? await provider.send({ subscriptionIds: subscriptions.map(row => row.onesignal_subscription_id), eventType, payload, deliveryKey: job.id }) : { skipped: true, messageId: '' };
      await db().$transaction(async tx => {
        await tx.notification_attempts.create({ data: { outbox_id: job.id, status: delivery.skipped ? 'SKIPPED' : 'SENT', provider_message_id: delivery.messageId } });
        await tx.notification_outbox.update({ where: { id: job.id }, data: { status: 'SENT', sent_at: clock(), locked_until: null } });
        if (job.reminder_id) await tx.cart_reminders.deleteMany({ where: { id: job.reminder_id } });
      });
    } catch (error) {
      const code = deliveryFailureCode(error);
      const noActiveSubscriptions = code === 'NO_ACTIVE_SUBSCRIPTIONS';
      const terminal = noActiveSubscriptions || job.attempts >= 8;
      await db().$transaction(async tx => {
        await tx.notification_attempts.create({ data: { outbox_id: job.id, status: noActiveSubscriptions ? 'SKIPPED' : 'FAILED', error_code: code } });
        await tx.notification_outbox.update({ where: { id: job.id }, data: { status: terminal ? 'DEAD' : 'PENDING', locked_until: null, last_error_code: code, available_at: new Date(clock().getTime() + Math.min(3600000, 15000 * (2 ** (job.attempts - 1)))) } });
      }).catch(() => {});
      logger.error({ event: noActiveSubscriptions ? 'notification_delivery_skipped' : 'notification_delivery_failed', code });
    }
    return true;
  }
  async function runOnce() {
    if (running || !provider.enabled) return;
    running = true;
    try { await scheduleAbandonedCarts(); for (let i = 0; i < 20 && await processOne(); i++); }
    catch { logger.error({ event: 'notification_worker_failed', code: 'WORKER_ERROR' }); }
    finally { running = false; }
  }
  function start(intervalMs = 30000) { const timer = setInterval(() => { runOnce().catch(() => {}); }, intervalMs); timer.unref(); runOnce().catch(() => {}); return () => clearInterval(timer); }
  return { runOnce, processOne, start };
}
module.exports = { createNotificationWorker, deliveryFailureCode };
