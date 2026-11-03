const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { createEmbeddedPostgres, unusedPort } = require('../helpers/embedded-postgres');

describe('initial Prisma migration', () => {
  let postgres;
  let sql;
  let directory;
  let migration;
  let catalogMigration;
  let catalogRollback;

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const port = await unusedPort();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alreda-initial-migration-'));
    postgres = createEmbeddedPostgres(EmbeddedPostgres, {
      databaseDir: directory,
      user: 'migration_test',
      password: randomBytes(24).toString('hex'),
      port,
      persistent: true,
      initdbFlags: ['--locale=C', '--encoding=UTF8'],
      postgresFlags: ['-h', '127.0.0.1', '-c', 'shared_buffers=16MB', '-c', 'max_connections=20'],
      onLog: () => {},
      onError: () => {},
    });
    migration = fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations/20261102000000_initial_schema/migration.sql'), 'utf8');
    catalogMigration = fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations/20261102170000_catalog_media_persistence/migration.sql'), 'utf8');
    catalogRollback = fs.readFileSync(path.resolve(__dirname, '../../prisma/proposed/catalog-media.rollback.sql'), 'utf8');
    await postgres.initialise();
    await postgres.start();
    sql = postgres.getPgClient('postgres', '127.0.0.1');
    await sql.connect();
  }, 120000);

  afterAll(async () => {
    await sql?.end().catch(() => {});
    await postgres?.stop().catch(() => {});
  }, 300000);

  it('applies the additive catalog migration without changing existing rows, then reapplies on an isolated database', async () => {
    await sql.query(migration);
    const appliedTables = await sql.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    const checks = await sql.query("SELECT count(*)::int AS count FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace");
    expect(appliedTables.rows[0].count).toBe(20);
    expect(checks.rows[0].count).toBeGreaterThanOrEqual(10);

    const categoryId = require('node:crypto').randomUUID();
    const productId = require('node:crypto').randomUUID();
    await sql.query('INSERT INTO categories (id,name,name_ar,slug) VALUES ($1,$2,$3,$4)', [categoryId, 'Existing category', 'فئة موجودة', 'existing-category']);
    await sql.query('INSERT INTO products (id,category_id,name,name_ar,slug,price_egp) VALUES ($1,$2,$3,$4,$5,$6)', [productId, categoryId, 'Existing product', 'منتج موجود', 'existing-product', 100]);
    await sql.query(catalogMigration);
    const preserved = await sql.query('SELECT id,category_id,name,price_egp FROM products WHERE id=$1', [productId]);
    expect(preserved.rows[0]).toMatchObject({ id: productId, category_id: categoryId, name: 'Existing product', price_egp: 100 });
    const additiveTables = await sql.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    expect(additiveTables.rows[0].count).toBe(23);
    await expect(sql.query('INSERT INTO product_images (source_id,product_id,secure_url) VALUES ($1,$2,$3)',
      ['external-image', productId, 'https://example.com/image.jpg'])).rejects.toThrow();

    await sql.query(catalogRollback);
    const rolledBackTables = await sql.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    const preservedAfterRollback = await sql.query('SELECT id,name FROM products WHERE id=$1', [productId]);
    expect(rolledBackTables.rows[0].count).toBe(20);
    expect(preservedAfterRollback.rows[0]).toMatchObject({ id: productId, name: 'Existing product' });
    await sql.query(catalogMigration);

    await sql.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const emptySchemaTables = await sql.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    expect(emptySchemaTables.rows[0].count).toBe(0);

    await sql.query(migration);
    await sql.query(catalogMigration);
    const reappliedTables = await sql.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    expect(reappliedTables.rows[0].count).toBe(23);
  }, 120000);
});
