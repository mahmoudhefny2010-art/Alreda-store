const { Router } = require('express');
const { timingSafeEqual } = require('node:crypto');
const { z } = require('zod');
const { createNotificationWorker } = require('../services/notification-worker.service');
const { createCloudinaryCleanupWorker } = require('../services/cloudinary-cleanup-worker.service');

const secretSchema = z.string().min(32).max(256).regex(/^\S+$/);
// A scheduler invokes this route explicitly. Never start timers in a function.
function createBackgroundJobsRoutes({ secret = process.env.CRON_SECRET, logger = console,
  notificationFactory = createNotificationWorker, cleanupFactory = createCloudinaryCleanupWorker, clock = Date.now } = {}) {
  const router = Router();
  const configured = secretSchema.safeParse(secret);
  let running = false;
  router.all('/api/jobs/run', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') return res.set('Allow', 'GET').status(405).json({ ok: false });
    if (!configured.success) return res.status(503).json({ ok: false });
    const supplied = req.get('authorization') || '';
    const expected = `Bearer ${configured.data}`;
    const received = Buffer.from(supplied);
    const required = Buffer.from(expected);
    if (received.length !== required.length || !timingSafeEqual(received, required)) return res.status(401).json({ ok: false });
    if (running) return res.status(409).json({ ok: false });
    running = true;
    try {
      const started = clock();
      const notifications = await notificationFactory({ logger, batchSize: 20, reminderBatchSize: 100, maxRunMs: 35000 }).runOnce();
      // Existing provider requests have their own timeouts. This deadline stops
      // starting additional work; it never abandons an in-flight DB transaction.
      const remaining = 50000 - (clock() - started);
      if (remaining < 5000) return res.status(503).json({ ok: false });
      const cleanup = await cleanupFactory({ logger, batchSize: 20, maxRunMs: Math.min(10000, remaining - 4000), requestTimeoutMs: 4000 }).runOnce();
      const ok = !notifications?.failed && !cleanup?.failed;
      return res.status(ok ? 200 : 503).json({ ok });
    } catch {
      logger.error({ event: 'background_jobs_failed', code: 'JOB_RUN_FAILED' });
      return res.status(503).json({ ok: false });
    } finally { running = false; }
  });
  return router;
}
module.exports = { createBackgroundJobsRoutes };
