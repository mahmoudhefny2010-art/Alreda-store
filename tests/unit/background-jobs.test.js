const express = require('express');
const request = require('supertest');
const { createBackgroundJobsRoutes } = require('../../src/routes/background-jobs.routes');
const { createNotificationWorker } = require('../../src/services/notification-worker.service');
const { createCloudinaryCleanupWorker } = require('../../src/services/cloudinary-cleanup-worker.service');
const { createCloudinaryService } = require('../../src/services/cloudinary.service');

const secret = 'synthetic-cron-secret-with-over-32-characters';
function fixture(options = {}) {
  const notificationFactory = vi.fn(() => ({ runOnce: vi.fn(async () => ({ processed: 1 })) }));
  const cleanupFactory = vi.fn(() => ({ runOnce: vi.fn(async () => ({ processed: 1 })) }));
  const logger = { error: vi.fn() };
  const app = express();
  app.use(createBackgroundJobsRoutes({ secret, notificationFactory, cleanupFactory, logger, ...options }));
  return { app, notificationFactory, cleanupFactory, logger };
}

describe('explicit serverless background job invocation', () => {
  it.each([undefined, '', 'short', 'a'.repeat(257), 'with whitespace ' + 'a'.repeat(32)])('fails closed for an absent or invalid configured secret', async value => {
    const f = fixture({ secret: value === undefined ? '' : value });
    await request(f.app).get('/api/jobs/run').set('Authorization', `Bearer ${secret}`).expect(503);
    expect(f.notificationFactory).not.toHaveBeenCalled();
    expect(f.cleanupFactory).not.toHaveBeenCalled();
  });

  it.each(['', 'Bearer wrong', `Basic ${secret}`, `Bearer ${secret.slice(0, -1)}x`])('rejects an invalid Authorization header without constructing workers', async authorization => {
    const f = fixture();
    const response = await request(f.app).get(`/api/jobs/run?secret=${secret}`).set('Authorization', authorization).expect(401);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(f.notificationFactory).not.toHaveBeenCalled();
    expect(f.cleanupFactory).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  it('runs one bounded batch in each worker and does not start background timers', async () => {
    const f = fixture();
    const response = await request(f.app).get('/api/jobs/run').set('Authorization', `Bearer ${secret}`).expect(200);
    expect(response.body).toEqual({ ok: true });
    expect(f.notificationFactory).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 20, reminderBatchSize: 100, maxRunMs: 35000 }));
    expect(f.cleanupFactory).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 20, maxRunMs: 10000, requestTimeoutMs: 4000 }));
    expect(f.notificationFactory.mock.results[0].value.runOnce).toHaveBeenCalledTimes(1);
    expect(f.cleanupFactory.mock.results[0].value.runOnce).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported methods without running work', async () => {
    const f = fixture();
    const response = await request(f.app).post('/api/jobs/run').set('Authorization', `Bearer ${secret}`).expect(405);
    expect(response.headers.allow).toBe('GET');
    expect(f.notificationFactory).not.toHaveBeenCalled();
  });

  it('returns a safe failure and releases the local concurrency guard after errors', async () => {
    const notificationFactory = vi.fn().mockImplementationOnce(() => { throw new Error('sensitive provider detail'); })
      .mockImplementation(() => ({ runOnce: async () => ({ processed: 0 }) }));
    const f = fixture({ notificationFactory });
    const response = await request(f.app).get('/api/jobs/run').set('Authorization', `Bearer ${secret}`).expect(503);
    expect(response.body).toEqual({ ok: false });
    expect(f.logger.error).toHaveBeenCalledWith({ event: 'background_jobs_failed', code: 'JOB_RUN_FAILED' });
    await request(f.app).get('/api/jobs/run').set('Authorization', `Bearer ${secret}`).expect(200);
  });

  it('reports a worker infrastructure failure instead of claiming success', async () => {
    const f = fixture({ cleanupFactory: () => ({ runOnce: async () => ({ failed: true }) }) });
    await request(f.app).get('/api/jobs/run').set('Authorization', `Bearer ${secret}`).expect(503);
  });

  it('stops before starting the next worker when the invocation time budget is exhausted', async () => {
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(45001);
    const f = fixture({ clock });
    await request(f.app).get('/api/jobs/run').set('Authorization', `Bearer ${secret}`).expect(503);
    expect(f.cleanupFactory).not.toHaveBeenCalled();
  });

  it('reduces the cleanup batch deadline to the remaining function budget', async () => {
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(42000);
    const f = fixture({ clock });
    await request(f.app).get('/api/jobs/run').set('Authorization', `Bearer ${secret}`).expect(200);
    expect(f.cleanupFactory).toHaveBeenCalledWith(expect.objectContaining({ maxRunMs: 4000, requestTimeoutMs: 4000 }));
  });

  it('does not overlap invocations in the same function instance', async () => {
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture({ notificationFactory: () => ({ runOnce: async () => { entered(); await gate; return { processed: 0 }; } }) });
    const first = request(f.app).get('/api/jobs/run').set('Authorization', `Bearer ${secret}`).then(response => response);
    await started;
    try { await request(f.app).get('/api/jobs/run').set('Authorization', `Bearer ${secret}`).expect(409); }
    finally { release(); }
    expect((await first).status).toBe(200);
  });
});

describe('bounded worker batches without provider calls', () => {
  it('passes the serverless cleanup timeout to the Cloudinary request while keeping the local default', async () => {
    const config = { enabled: true, cloudName: 'synthetic', apiKey: '123', apiSecret: 'synthetic-only', rootFolder: 'test-store' };
    const client = { api: { delete_resources: vi.fn(async () => ({ deleted: { 'test-store/products/synthetic': 'deleted' } })) } };
    const journal = vi.fn();
    const context = { verifiedCatalogAdmin: true };
    const media = createCloudinaryService({ config, client, journal, authorize: async () => true, requestTimeoutMs: 4000 });
    await media.deleteCatalogAsset({ public_id: 'test-store/products/synthetic' }, context);
    expect(client.api.delete_resources).toHaveBeenLastCalledWith(['test-store/products/synthetic'], expect.objectContaining({ timeout: 4000 }));
    const localMedia = createCloudinaryService({ config, client, journal, authorize: async () => true });
    await localMedia.deleteCatalogAsset({ public_id: 'test-store/products/synthetic' }, context);
    expect(client.api.delete_resources).toHaveBeenLastCalledWith(['test-store/products/synthetic'], expect.objectContaining({ timeout: 60000 }));
  });
  it('uses the notification reminder limit and stops when its cooperative deadline is reached', async () => {
    const client = {
      site_settings: { findUnique: vi.fn(async () => null) },
      shopping_carts: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
    const elapsedClock = vi.fn().mockReturnValueOnce(0).mockReturnValue(10);
    const worker = createNotificationWorker({ clientProvider: () => client, provider: { enabled: true }, reminderBatchSize: 3, batchSize: 1, maxRunMs: 10, elapsedClock });
    expect(await worker.runOnce()).toEqual({ processed: 0, skipped: false });
    expect(client.shopping_carts.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('honors the cleanup batch cap even if a repository returns extra jobs', async () => {
    const repository = { pendingCloudinaryCleanupJobs: vi.fn(async () => [{ id: '1', public_id: 'one' }, { id: '2', public_id: 'two' }]), completeCloudinaryCleanupJob: vi.fn() };
    const media = { deleteCatalogAsset: vi.fn(async () => ({ deleted: true })) };
    const worker = createCloudinaryCleanupWorker({ repository, media, batchSize: 1 });
    expect(await worker.runOnce()).toEqual({ processed: 1, skipped: false });
    expect(repository.pendingCloudinaryCleanupJobs).toHaveBeenCalledWith(1);
    expect(media.deleteCatalogAsset).toHaveBeenCalledTimes(1);
  });

  it('does not begin deleting another asset after the cooperative deadline', async () => {
    const repository = { pendingCloudinaryCleanupJobs: vi.fn(async () => [{ id: '1' }]) };
    const media = { deleteCatalogAsset: vi.fn() };
    const elapsedClock = vi.fn().mockReturnValueOnce(0).mockReturnValue(10);
    const worker = createCloudinaryCleanupWorker({ repository, media, maxRunMs: 10, elapsedClock });
    expect(await worker.runOnce()).toEqual({ processed: 0, skipped: false });
    expect(media.deleteCatalogAsset).not.toHaveBeenCalled();
  });
});
