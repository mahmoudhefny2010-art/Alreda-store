const { buildDetailPlan, applyDetailPlan } = require('../../scripts/catalog-import/refresh-details');
const { createHash } = require('node:crypto');
const record = () => ({ id: '10', handle: 'product', title: 'Product', body_html: '<p>Complete source details</p>', images: [],
  options: [], variants: [{ id: '20', title: 'Default Title', price: '100.00' }] });
const catalog = () => ({ products: [{ sourceId: '10', slug: 'product', descriptionHtml: '<p>Old details</p>', descriptionArHtml: '' }] });
const plan = () => buildDetailPlan(catalog(), [record()], [{ ...record(), body_html: '<p>تفاصيل المنتج كاملة</p>' }]);
function database(overrides = {}) {
  const row = { id: 'uuid', source_id: '10', slug: 'product', description: '<p>Old details</p>', description_ar: '', ...overrides };
  const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn(), products: {
    findMany: vi.fn().mockResolvedValue([row]), update: vi.fn().mockImplementation(async ({ data }) => Object.assign(row, data)),
  } };
  return { tx, $transaction: fn => fn(tx) };
}
describe('source detail refresh safety', () => {
  it('validates both source locales and keeps complete HTML', () => {
    expect(plan()).toMatchObject({ sourceProducts: 1, sourceVariants: 1, sourceImages: 0, changedSnapshotDescriptions: 1 });
    expect(plan().changes[0].after.description).toBe(record().body_html);
  });
  it('rejects identity mismatches, incomplete feeds, duplicates and blank source details', () => {
    expect(() => buildDetailPlan(catalog(), [], [])).toThrow('COVERAGE');
    expect(() => buildDetailPlan(catalog(), [record(), record()], [record()])).toThrow('DUPLICATE');
    expect(() => buildDetailPlan(catalog(), [{ ...record(), handle: 'other' }], [record()])).toThrow('IDENTITY');
    expect(() => buildDetailPlan(catalog(), [{ ...record(), body_html: '' }], [{ ...record(), body_html: '' }])).toThrow('EMPTY');
    expect(() => buildDetailPlan(catalog(), [{ ...record(), id: 'invalid' }], [record()])).toThrow();
  });
  it('does no writes during a plan and only updates descriptions during execution', async () => {
    const db = database();
    expect(await applyDetailPlan(db, plan())).toMatchObject({ executed: false, changedDatabaseDescriptions: 1 });
    expect(db.tx.products.update).not.toHaveBeenCalled();
    await applyDetailPlan(db, plan(), { execute: true });
    expect(db.tx.products.update).toHaveBeenCalledWith({ where: { id: 'uuid' }, data: plan().changes[0].after });
    expect(Object.keys(db.tx.products.update.mock.calls[0][0].data).sort()).toEqual(['description', 'description_ar']);
    expect(await applyDetailPlan(db, plan(), { execute: true })).toMatchObject({ changedDatabaseDescriptions: 0 });
  });
  it('protects admin edits and refuses database coverage changes before writing', async () => {
    const db = database({ description: '<p>Admin edited details</p>' });
    await expect(applyDetailPlan(db, plan(), { execute: true })).rejects.toThrow('CONFLICT');
    expect(db.tx.products.update).not.toHaveBeenCalled();
    db.tx.products.findMany.mockResolvedValue([]);
    await expect(applyDetailPlan(db, plan(), { execute: true })).rejects.toThrow('COVERAGE');
  });
  it('preserves manually reviewed descriptions and requires review when source prose changes', () => {
    const source = record(); const ar = { ...record(), body_html: '<p>تفاصيل المنتج كاملة</p>' };
    const manualSourceDescriptionsHash = createHash('sha256').update(JSON.stringify({ description: source.body_html, description_ar: ar.body_html })).digest('hex');
    const snapshot = catalog();
    Object.assign(snapshot.products[0], { translationMethod: 'manual', manualSourceDescriptionsHash,
      descriptionHtml: '<p>Manually reviewed English details</p>', descriptionArHtml: '<p>تفاصيل عربية تمت مراجعتها يدويًا</p>' });
    expect(buildDetailPlan(snapshot, [source], [ar]).changes[0].after.description).toBe(snapshot.products[0].descriptionHtml);
    expect(() => buildDetailPlan(snapshot, [{ ...source, body_html: '<p>Changed source specifications</p>' }], [ar])).toThrow('DETAIL_MANUAL_SOURCE_CHANGED_REVIEW_REQUIRED');
  });
});
