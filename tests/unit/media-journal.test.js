/* global beforeEach, afterEach */
const fs = require('node:fs/promises');
const prisma = require('../../src/config/prisma');
const filename = require.resolve('../../src/repositories/media-journal.repository');
const actor = '123e4567-e89b-12d3-a456-426614174001';
let originalProvider, originalVercel, client;
beforeEach(() => {
  originalProvider = prisma.getPrismaClient; originalVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  client = { admin_audit_events: { createMany: vi.fn(async () => ({ count: 2 })) }, cloudinary_cleanup_jobs: { findUnique: vi.fn() } };
  prisma.getPrismaClient = () => client;
  vi.spyOn(fs, 'mkdir').mockRejectedValue(Object.assign(new Error('Read-only filesystem'), { code: 'EROFS' }));
  delete require.cache[filename];
});
afterEach(() => {
  prisma.getPrismaClient = originalProvider;
  if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
  vi.restoreAllMocks(); delete require.cache[filename];
});
it('journals verified admin uploads durably without writing to Vercel filesystem', async () => {
  const { recordMediaEvent } = require(filename);
  await expect(recordMediaEvent({ event: 'asset_uploaded', publicId: 'alreda-store/products/sample', assetId: 'synthetic-asset', token: 'must-not-be-stored' },
    { verifiedCatalogAdmin: true, userId: actor })).resolves.toBeUndefined();
  expect(fs.mkdir).not.toHaveBeenCalled();
  const records = client.admin_audit_events.createMany.mock.calls[0][0].data;
  expect(records).toHaveLength(2);
  expect(records.every(row => row.actor_id === actor)).toBe(true);
  expect(new Set(records.map(row => row.action)).size).toBe(1);
  expect(records.map(row => row.target_id)).toEqual(['public:alreda-store/products/sample', 'asset:synthetic-asset']);
  expect(JSON.stringify(records)).not.toContain('must-not-be-stored');
});
it('uses the existing persistent cleanup job for a system worker without inventing an actor', async () => {
  const { recordMediaEvent } = require(filename);
  client.cloudinary_cleanup_jobs.findUnique.mockResolvedValue({ asset_id: 'synthetic-asset', status: 'PENDING' });
  await recordMediaEvent({ event: 'asset_deleted', publicId: 'alreda-store/products/sample', assetId: 'synthetic-asset' }, { verifiedCatalogAdmin: true });
  expect(client.admin_audit_events.createMany).not.toHaveBeenCalled();
  expect(fs.mkdir).not.toHaveBeenCalled();
});
it('rejects serverless uploads without a verified actor or a persistent cleanup job', async () => {
  const { recordMediaEvent } = require(filename);
  await expect(recordMediaEvent({ event: 'asset_uploaded', publicId: 'alreda-store/products/sample' }, { userId: actor })).rejects.toThrow('MEDIA_JOURNAL_CONTEXT_REQUIRED');
  expect(client.admin_audit_events.createMany).not.toHaveBeenCalled();
});
