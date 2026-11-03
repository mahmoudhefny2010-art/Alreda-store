const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function reconcileInventory(db, { apply = false, backup } = {}) {
  if (apply && typeof backup !== 'function') throw new Error('INVENTORY_BACKUP_REQUIRED');
  return db.$transaction(async tx => {
    if (!apply) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const candidates = await tx.$queryRaw`
      SELECT p.id FROM products p JOIN LATERAL (
        SELECT sum(stock_quantity)::bigint AS total, count(*) AS variants,
          count(*) FILTER (WHERE stock_quantity IS NULL) AS unknown
        FROM product_variants WHERE product_id=p.id AND is_available=true
      ) v ON v.variants>0 AND v.unknown=0
      WHERE p.is_available=true AND p.stock_quantity IS DISTINCT FROM v.total ORDER BY p.id`;
    const changes = [];
    for (const candidate of candidates) {
      if (apply) await tx.$queryRaw`SELECT id FROM products WHERE id=${candidate.id}::uuid FOR UPDATE`;
      const product = await tx.products.findUnique({ where: { id: candidate.id }, select: { stock_quantity: true, is_available: true } });
      const variants = await tx.product_variants.findMany({ where: { product_id: candidate.id, is_available: true }, select: { stock_quantity: true } });
      if (!product?.is_available || !variants.length || variants.some(variant => !Number.isInteger(variant.stock_quantity))) continue;
      const total = variants.reduce((sum, variant) => sum + variant.stock_quantity, 0);
      if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647) throw new Error('INVALID_INVENTORY_TOTAL');
      if (product.stock_quantity !== total) changes.push({ id: candidate.id, before: product.stock_quantity, after: total });
    }
    if (apply && changes.length) {
      // Persist recovery data before changing any total. Variant quantities are never edited.
      await backup(changes);
      for (const change of changes) await tx.products.update({ where: { id: change.id }, data: { stock_quantity: change.after, updated_at: new Date() } });
    }
    return changes;
  }, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 60000 });
}

async function main() {
  require('dotenv').config({ quiet: true });
  const { getPrismaClient, disconnectDatabase } = require('../../src/config/prisma');
  try {
    const apply = process.argv.includes('--apply');
    let backupFile;
    const changes = await reconcileInventory(getPrismaClient(), { apply, backup: async rows => {
      const directory = path.resolve(__dirname, '../../data/database/inventory-backups');
      fs.mkdirSync(directory, { recursive: true });
      backupFile = path.join(directory, `before-total-reconciliation-${randomUUID()}.json`);
      fs.writeFileSync(backupFile, JSON.stringify({ createdAt: new Date().toISOString(), changes: rows }, null, 2), { flag: 'wx' });
    } });
    console.info(JSON.stringify({ applied: apply, changedProductTotals: changes.length, variantQuantitiesChanged: false, backupCreated: Boolean(backupFile) }));
  } catch { console.error(JSON.stringify({ failed: true, code: 'INVENTORY_RECONCILIATION_FAILED' })); process.exitCode = 1; }
  finally { await disconnectDatabase(); }
}
if (require.main === module) main();
module.exports = { reconcileInventory };
