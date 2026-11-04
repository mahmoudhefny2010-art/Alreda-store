const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { z } = require('zod');
const { getPrismaClient } = require('../config/prisma');
const filename = path.resolve(__dirname, '../../data/media/reconciliation.jsonl');
const eventSchema = z.object({
  event: z.enum(['asset_uploaded', 'upload_reconciliation_required', 'association_failed', 'asset_delete_started', 'asset_deleted', 'asset_cleanup_pending', 'replacement_association_failed']),
  publicId: z.string().min(1).max(240), assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(),
  mediaId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(), code: z.string().regex(/^[A-Z_]{1,64}$/).optional(),
});
// Local imports retain their journal. Serverless admin operations use the existing
// durable audit table; grouped rows fit its existing columns without a migration.
async function recordMediaEvent(event, context = {}) {
  const parsed = eventSchema.safeParse(event);
  if (!parsed.success) throw new Error('INVALID_MEDIA_EVENT');
  const safe = parsed.data;
  if (process.env.VERCEL) {
    if (!context.verifiedCatalogAdmin) throw new Error('MEDIA_JOURNAL_CONTEXT_REQUIRED');
    const actor = z.uuid().safeParse(context.userId);
    const client = getPrismaClient();
    if (!actor.success) {
      // Scheduled cleanup already has a durable job whose outcome the worker saves.
      // Never invent an administrator identity for that system operation.
      if (['asset_deleted', 'asset_cleanup_pending'].includes(safe.event)) {
        const job = await client.cloudinary_cleanup_jobs.findUnique({ where: { public_id: safe.publicId }, select: { asset_id: true, status: true } });
        if (job?.status === 'PENDING' && (!safe.assetId || job.asset_id === safe.assetId)) return;
      }
      throw new Error('MEDIA_JOURNAL_CONTEXT_REQUIRED');
    }
    const action = `MEDIA_${safe.event.toUpperCase()}:${randomBytes(8).toString('hex')}`;
    const identifiers = [['public', safe.publicId], ['asset', safe.assetId], ['media', safe.mediaId], ['code', safe.code]].filter(([, value]) => value);
    await client.admin_audit_events.createMany({ data: identifiers.map(([kind, value]) => ({ actor_id: actor.data, action, target_id: `${kind}:${value}` })) });
    return;
  }
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.appendFile(filename, JSON.stringify({ ...safe, at: new Date().toISOString() }) + '\n');
}
module.exports = { recordMediaEvent };
