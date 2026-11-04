const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID } = require('node:crypto');
const { createPrismaClient } = require('../../src/config/prisma');
const { createEmbeddedPostgres, unusedPort } = require('./embedded-postgres');
async function startOrderDatabase() {
  // A fresh owned local cluster. Never loads dotenv or reads the user's DATABASE_URL.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await unusedPort();
  const password = randomBytes(24).toString('hex');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alreda-order-tests-'));
  const postgres = createEmbeddedPostgres(EmbeddedPostgres, { databaseDir: directory, user: 'order_test', password, port, persistent: true,
    initdbFlags: ['--locale=C', '--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1', '-c', 'shared_buffers=16MB', '-c', 'max_connections=20'], onLog: () => {}, onError: () => {} });
  let sql; let client; let stage = 'initialise';
  try {
    await postgres.initialise(); stage = 'start'; await postgres.start(); stage = 'connect';
    sql = postgres.getPgClient('postgres', '127.0.0.1'); await sql.connect();
    stage = 'fixture';
    await sql.query(fs.readFileSync(path.join(__dirname, '../fixtures/legacy-database.sql'), 'utf8'));
    // Prisma introspection does not represent CHECK constraints: reproduce relevant legacy checks explicitly.
    await sql.query(`
      CREATE TABLE site_settings (setting_key VARCHAR(120) PRIMARY KEY, value_en TEXT NOT NULL DEFAULT '', value_ar TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE push_subscribers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), external_id VARCHAR(80) NOT NULL, onesignal_subscription_id VARCHAR(120) NOT NULL UNIQUE, created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,onesignal_subscription_id));
      ALTER TABLE orders ADD CONSTRAINT orders_payment_check CHECK (payment_method IN ('CASH_ON_DELIVERY','INSTAPAY_ON_DELIVERY','PAY_AT_CASHIER'));
      ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check CHECK (payment_status IN ('UNCONFIRMED','UNPAID','PAID'));
      ALTER TABLE orders ADD CONSTRAINT orders_payment_received_check CHECK (payment_status <> 'PAID' OR
        (paid_at IS NOT NULL AND paid_by IS NOT NULL AND amount_received_egp IS NOT NULL AND change_due_egp IS NOT NULL
        AND amount_received_egp >= total_egp AND change_due_egp = amount_received_egp - total_egp));
      ALTER TABLE orders ADD CONSTRAINT orders_address_json CHECK (address_snapshot::jsonb IS NOT NULL);
      ALTER TABLE orders ADD CONSTRAINT orders_amounts_check CHECK (subtotal_egp >= 0 AND delivery_fee_egp >= 0 AND total_egp >= 0);
      ALTER TABLE order_items ADD CONSTRAINT order_items_amounts_check CHECK (quantity > 0 AND unit_price_egp >= 0 AND line_total_egp >= 0);
      ALTER TABLE products ADD CONSTRAINT products_price_check CHECK (price_egp > 0);
      ALTER TABLE products ADD CONSTRAINT products_sale_check CHECK (sale_price_egp IS NULL OR (sale_price_egp > 0 AND sale_price_egp < price_egp));
    `);
    const up = fs.readFileSync(path.join(__dirname, '../../prisma/proposed/order-workflow.sql'), 'utf8');
    const down = fs.readFileSync(path.join(__dirname, '../../prisma/proposed/order-workflow.rollback.sql'), 'utf8');
    const catalogMigration = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261102170000_catalog_media_persistence/migration.sql'), 'utf8');
    const sentinelId = randomUUID();
    await sql.query('INSERT INTO products (id,name,name_ar,slug,price_egp) VALUES ($1,$2,$3,$4,$5)', [sentinelId, 'Legacy migration sentinel', 'Test', sentinelId, 100]);
    const before = (await sql.query('SELECT id,name,price_egp FROM products WHERE id=$1', [sentinelId])).rows;
    stage = 'migration'; await sql.query(up); await sql.query(catalogMigration);
    await sql.query(down); // Empty disposable database only; rejects loss of meaningful workflow data.
    await sql.query(up);
    const customerFeaturesMigration = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261103000000_customer_auth_cart_notifications/migration.sql'), 'utf8');
    await sql.query(customerFeaturesMigration);
    await sql.query(fs.readFileSync(path.join(__dirname, '../../prisma/proposed/customer-commerce.rollback.sql'), 'utf8'));
    await sql.query(customerFeaturesMigration);
    const after = (await sql.query('SELECT id,name,price_egp FROM products WHERE id=$1', [sentinelId])).rows;
    // Keep disposable order databases aligned with the current Prisma model.
    for (const migration of ['20261103010000_admin_catalog_promotions', '20261103020000_homepage_collection_layout', '20261103030000_product_presentation', '20261103040000_variant_color_hex']) {
      await sql.query(fs.readFileSync(path.join(__dirname, '../../prisma/migrations', migration, 'migration.sql'), 'utf8'));
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('MIGRATION_DATA_INVARIANT_FAILED');
    const variantMigration = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261103050000_variant_purchasing/migration.sql'), 'utf8');
    await sql.query(variantMigration);
    await sql.query(fs.readFileSync(path.join(__dirname, '../../prisma/proposed/variant-purchasing.rollback.sql'), 'utf8'));
    await sql.query(variantMigration);
    const proofMigration = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261103060000_instapay_review/migration.sql'), 'utf8');
    await sql.query(proofMigration);
    await sql.query(fs.readFileSync(path.join(__dirname, '../../prisma/proposed/instapay-review.rollback.sql'), 'utf8'));
    await sql.query(proofMigration);
    const lifecycleMigration = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261104120000_product_archive_and_media_cleanup/migration.sql'), 'utf8');
    await sql.query(lifecycleMigration);
    const lifecycleTable = await sql.query("SELECT to_regclass('public.cloudinary_cleanup_jobs') AS table_name");
    if (!lifecycleTable.rows[0].table_name) throw new Error('PRODUCT_LIFECYCLE_MIGRATION_FAILED');
    await sql.query(fs.readFileSync(path.join(__dirname, '../../prisma/proposed/product-lifecycle.rollback.sql'), 'utf8'));
    await sql.query(lifecycleMigration);
    const favoritesMigration = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261104150000_customer_favorites/migration.sql'), 'utf8');
    const favoritesRollback = fs.readFileSync(path.join(__dirname, '../../prisma/proposed/customer-favorites.rollback.sql'), 'utf8');
    await sql.query(favoritesMigration);
    const favoritesTable = await sql.query("SELECT to_regclass('public.customer_favorites') AS table_name");
    if (!favoritesTable.rows[0].table_name) throw new Error('CUSTOMER_FAVORITES_MIGRATION_FAILED');
    await sql.query(favoritesRollback);
    const rolledBackFavorites = await sql.query("SELECT to_regclass('public.customer_favorites') AS table_name");
    if (rolledBackFavorites.rows[0].table_name) throw new Error('CUSTOMER_FAVORITES_ROLLBACK_FAILED');
    await sql.query(favoritesMigration);
    client = createPrismaClient({ enabled: true, url: `postgresql://order_test:${password}@127.0.0.1:${port}/postgres`, poolMax: 8, connectTimeoutMs: 10000 });
    return { client, sql, down, async stop() {
      await client.$disconnect(); await sql.end(); await postgres.stop();
      // Keep test cluster files in the OS temp folder; no recursive deletion or shared-database cleanup.
    } };
  } catch (error) {
    await client?.$disconnect().catch(() => {}); await sql?.end().catch(() => {}); await postgres.stop().catch(() => {});
    // eslint-disable-next-line preserve-caught-error -- Raw process/driver errors can contain temporary connection credentials.
    throw new Error(`DISPOSABLE_ORDER_DATABASE_START_FAILED:${stage}:${/^[A-Z0-9_]{2,40}$/.test(error.code || '') ? error.code : 'UNAVAILABLE'}:${/^[0-9]{1,5}$/.test(error.position || '') ? error.position : ''}`);
  }
}
module.exports = { startOrderDatabase };
