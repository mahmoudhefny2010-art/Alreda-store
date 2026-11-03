// Explicit, manual inventory setup. Never runs during startup or deployment.
require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const { getPrismaClient, disconnectDatabase } = require('../../src/config/prisma');
const quantityArgument = process.argv.find(value => value.startsWith('--quantity='))?.slice('--quantity='.length);
if (!quantityArgument) throw new Error('PASS_QUANTITY_EXPLICITLY');
const quantity = z.coerce.number().int().min(1).max(10000).parse(quantityArgument);
const apply = process.argv.includes('--apply');

async function main() {
  const db = getPrismaClient();
  const result = await db.$transaction(async tx => {
    if (apply) {
      await tx.$queryRaw`SELECT id FROM public.products ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM public.product_variants ORDER BY id FOR UPDATE`;
    }
    const products = await tx.products.findMany({ select: { id: true, stock_quantity: true, is_available: true } });
    const variants = await tx.product_variants.findMany({ select: { id: true, product_id: true, source_id: true, stock_quantity: true, is_available: true } });
    // Managed type matrices retain retired rows for order history. Do not revive
    // those automatically: this operation is intended for the imported catalog.
    if (variants.some(variant => /^(admin-type-|admin-color-)/.test(variant.source_id))) throw new Error('MANAGED_VARIANTS_REQUIRE_REVIEW');
    if (!apply) return { mode: 'preview', products: products.length, variants: variants.length, quantityPerChoice: quantity };
    const backupDirectory = path.resolve(__dirname, '../../data/database/inventory-backups');
    await fs.mkdir(backupDirectory, { recursive: true });
    const backup = path.join(backupDirectory, `before-test-stock-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    // This ignored local backup contains inventory IDs and values, never credentials.
    await fs.writeFile(backup, JSON.stringify({ createdAt: new Date().toISOString(), products, variants }, null, 2), { flag: 'wx' });
    const counts = new Map();
    for (const variant of variants) counts.set(variant.product_id, (counts.get(variant.product_id) || 0) + 1);
    await tx.product_variants.updateMany({ data: { stock_quantity: quantity, updated_at: new Date() } });
    for (const product of products) {
      await tx.products.update({ where: { id: product.id }, data: { stock_quantity: quantity * (counts.get(product.id) || 1), updated_at: new Date() } });
    }
    return { mode: 'applied', products: products.length, variants: variants.length, quantityPerChoice: quantity, backup: path.relative(process.cwd(), backup) };
  }, { isolationLevel: 'Serializable', timeout: 120000, maxWait: 10000 });
  if (apply) {
    const [products, variants] = await Promise.all([
      db.products.findMany({ select: { id: true, stock_quantity: true, is_available: true, product_variants: { select: { stock_quantity: true, is_available: true } } } }),
      db.product_variants.count({ where: { OR: [{ stock_quantity: { not: quantity } }, { stock_quantity: null }] } }),
    ]);
    const mismatchedProducts = products.filter(product => product.stock_quantity !== quantity * (product.product_variants.length || 1)).length;
    result.verified = variants === 0 && mismatchedProducts === 0;
    result.mismatchedProducts = mismatchedProducts;
    result.mismatchedVariants = variants;
    if (!result.verified) process.exitCode = 1;
  }
  console.info(JSON.stringify(result));
}
main().catch(error => {
  console.error(JSON.stringify({ success: false, code: error.message === 'MANAGED_VARIANTS_REQUIRE_REVIEW' ? error.message : 'INVENTORY_SETUP_FAILED' }));
  process.exitCode = 1;
}).finally(disconnectDatabase);
