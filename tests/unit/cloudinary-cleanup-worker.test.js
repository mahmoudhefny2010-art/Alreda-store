const { createCloudinaryCleanupWorker } = require('../../src/services/cloudinary-cleanup-worker.service');

describe('Cloudinary cleanup worker schema recovery', () => {
  it('pauses after the cleanup table is missing instead of repeating the same error every minute', async () => {
    const repository = { pendingCloudinaryCleanupJobs: vi.fn().mockRejectedValue({ code: 'P2021' }) };
    const logger = { error: vi.fn() };
    const worker = createCloudinaryCleanupWorker({ repository, media: { deleteCatalogAsset: vi.fn() }, logger });

    await worker.runOnce();
    await worker.runOnce();

    expect(repository.pendingCloudinaryCleanupJobs).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(JSON.stringify({ event: 'cloudinary_cleanup_schema_unavailable', code: 'P2021' }));
  });
});
