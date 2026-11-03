const { createAdminManagementRepository } = require('../repositories/admin-management.repository');
const { readCloudinaryConfig } = require('../config/cloudinary');
const { createCloudinaryService } = require('./cloudinary.service');

function createCloudinaryCleanupWorker({ repository = createAdminManagementRepository(), media = createCloudinaryService({ config: readCloudinaryConfig(), authorize: context => Boolean(context?.verifiedCatalogAdmin) }), logger = console, intervalMs = 60000 } = {}) {
  let timer;
  let running = false;
  let schemaUnavailable = false;
  async function runOnce() {
    if (running || schemaUnavailable) return;
    running = true;
    try {
      const jobs = await repository.pendingCloudinaryCleanupJobs(20);
      for (const job of jobs) {
        const result = await media.deleteCatalogAsset({ public_id: job.public_id, asset_id: job.asset_id }, { verifiedCatalogAdmin: true });
        if (result.deleted) await repository.completeCloudinaryCleanupJob(job.id);
        else await repository.retryCloudinaryCleanupJob(job.id, result.code);
      }
    } catch (error) {
      const code = ['P1001', 'P1002', 'P2024', 'P2021', 'P2022'].includes(error?.code) ? error.code : 'CLEANUP_WORKER_FAILED';
      if (code === 'P2021' || code === 'P2022') {
        // The lifecycle migration is not installed yet. Stop polling this
        // process; retrying every minute only floods logs and cannot delete
        // anything safely. A normal server restart after migration resumes it.
        schemaUnavailable = true;
        logger.error(JSON.stringify({ event: 'cloudinary_cleanup_schema_unavailable', code }));
      } else logger.error(JSON.stringify({ event: 'cloudinary_cleanup_worker_failed', code }));
    } finally { running = false; }
  }
  return { start() {
    if (!readCloudinaryConfig().enabled || timer) return () => {};
    void runOnce();
    timer = setInterval(runOnce, intervalMs);
    timer.unref?.();
    return () => { clearInterval(timer); timer = undefined; };
  }, runOnce };
}
module.exports = { createCloudinaryCleanupWorker };
