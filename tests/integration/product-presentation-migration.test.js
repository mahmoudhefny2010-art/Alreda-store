const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { createEmbeddedPostgres, unusedPort } = require('../helpers/embedded-postgres');

it('applies, safely clears unused presentation metadata, and reapplies without changing product data', async () => {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const password = randomBytes(24).toString('hex'), port = await unusedPort();
  const postgres = createEmbeddedPostgres(EmbeddedPostgres, { databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'alreda-presentation-test-')),
    user: 'presentation_test', password, port, persistent: true,
    initdbFlags: ['--locale=C', '--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1', '-c', 'shared_buffers=16MB'], onLog: () => {}, onError: () => {} });
  let sql, prisma, stage = 'initialise';
  try {
    await postgres.initialise(); await postgres.start(); sql = postgres.getPgClient('postgres', '127.0.0.1'); await sql.connect();
    for (const directory of fs.readdirSync(path.resolve(__dirname, '../../prisma/migrations')).filter(name => /^202611/.test(name) && !name.includes('product_presentation')).sort()) {
      await sql.query(fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations', directory, 'migration.sql'), 'utf8'));
    }
    stage = 'seed';
    const id = randomUUID();
    await sql.query('INSERT INTO products (id,name,name_ar,slug,price_egp) VALUES ($1,$2,$3,$4,$5)', [id, 'Synthetic product', 'منتج تجريبي', 'synthetic-presentation', 500]);
    await sql.query('INSERT INTO catalog_details (product_id) VALUES ($1)', [id]);
    const migration = fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations/20261103030000_product_presentation/migration.sql'), 'utf8');
    await sql.query(migration);
    expect((await sql.query('SELECT presentation FROM catalog_details WHERE product_id=$1', [id])).rows[0].presentation).toEqual({});
    // Safe only before metadata is populated; production rollback keeps the column.
    await sql.query('ALTER TABLE catalog_details DROP COLUMN presentation');
    await sql.query(migration);
    expect((await sql.query('SELECT name,price_egp FROM products WHERE id=$1', [id])).rows[0]).toEqual({ name: 'Synthetic product', price_egp: 500 });
    prisma = require('../../src/config/prisma').createPrismaClient({ enabled: true, url: `postgresql://presentation_test:${password}@127.0.0.1:${port}/postgres`, poolMax: 2, connectTimeoutMs: 10000 });
    const admin = await prisma.users.create({ data: { name: 'Synthetic admin', email: 'presentation@example.invalid', role: 'admin' } });
    const category = await prisma.categories.create({ data: { name: 'Test category', name_ar: 'تصنيف تجريبي', slug: 'presentation-test' } });
    const image = `https://res.cloudinary.com/${require('../../src/config/cloudinary-media.json').cloudName}/image/upload/test/type.jpg`;
    const input = require('../../src/validators/admin.validator').productSchema.parse({ name: 'Test types', nameAr: 'أنواع تجريبية', categoryId: category.id,
      priceEgp: '500', stock: '4', images: image, available: 'on', presentation: JSON.stringify({ manageTypes: true, hoverImage: image, mobileImage: image,
        types: [{ en: 'Single', ar: 'مفرد', imageUrl: image, stock: 3, priceEgp: 500 }, { en: 'Double', ar: 'مزدوج', imageUrl: image, stock: 1, priceEgp: 700 }] }) });
    const repository = require('../../src/repositories/admin-management.repository').createAdminManagementRepository(() => prisma);
    stage = 'save-product';
    const productId = await repository.saveProduct(admin.id, input);
    const first = await prisma.products.findUnique({ where: { id: productId }, include: { product_variants: true, catalog_details: true } });
    expect(first.stock_quantity).toBe(4);
    expect(first.product_variants).toHaveLength(2);
    expect(first.product_variants.map(item => Number(item.price_egp)).sort()).toEqual([500, 700]);
    expect(first.catalog_details.presentation.hoverImage).toBe(image);
    stage = 'resave-product';
    await repository.saveProduct(admin.id, { ...input, id: productId });
    expect(await prisma.product_variants.count({ where: { product_id: productId } })).toBe(2);
    expect((await prisma.product_variants.findMany({ where: { product_id: productId } })).every(item => item.source_image_id)).toBe(true);
    stage = 'color-type-combinations';
    await repository.saveProduct(admin.id, { ...input, id: productId, colorVariants: [{ color: 'Black', imageUrl: image, stock: 100 }, { color: 'Gold', imageUrl: image, stock: 100 }] });
    const combined = await prisma.product_variants.findMany({ where: { product_id: productId } });
    expect(combined.reduce((sum, item) => sum + item.stock_quantity, 0)).toBe(4);
    expect(combined.filter(item => JSON.parse(item.options).length === 2)).toHaveLength(4);
    expect((await prisma.products.findUnique({ where: { id: productId } })).stock_quantity).toBe(4);
    const colorVariants = [{ color: 'Black', imageUrl: image, stock: 100, priceEgp: 900 }, { color: 'Gold', imageUrl: image, stock: 100, priceEgp: null }];
    await repository.saveProduct(admin.id, { ...input, id: productId, colorVariants });
    const priced = await prisma.product_variants.findMany({ where: { product_id: productId, source_id: { startsWith: `admin-type-${productId}-` } } });
    expect(priced.filter(variant => JSON.parse(variant.options)[0] === 'Black').map(variant => Number(variant.price_egp))).toEqual([900, 900]);
    expect(priced.filter(variant => JSON.parse(variant.options)[0] === 'Gold').map(variant => Number(variant.price_egp)).sort()).toEqual([500, 700]);
    await repository.saveProduct(admin.id, { ...input, id: productId, colorVariants: colorVariants.map(color => ({ ...color, priceEgp: null })) });
    const reset = await prisma.product_variants.findMany({ where: { product_id: productId, source_id: { startsWith: `admin-type-${productId}-` } } });
    expect(reset.filter(variant => JSON.parse(variant.options)[0] === 'Black').map(variant => Number(variant.price_egp)).sort()).toEqual([500, 700]);
    stage = 'exact-variant-matrix';
    const details = await prisma.catalog_details.findUnique({ where: { product_id: productId } });
    await prisma.catalog_details.update({ where: { product_id: productId }, data: { presentation: { ...details.presentation, colorOffers: { Black: 400 } } } });
    await prisma.products.update({ where: { id: productId }, data: { sale_price_egp: 300 } });
    const current = await prisma.products.findUnique({ where: { id: productId }, include: { product_variants: true, catalog_details: true, product_images: true } });
    const rows = require('../../src/services/variant-editor.service').buildVariantEditor(current).rows;
    await repository.saveProduct(admin.id, { ...input, id: productId, expectedUpdatedAt: current.updated_at.toISOString(), variantEditor: {
      enabled: true, options: [{ name: 'Color', nameAr: 'اللون' }, { name: 'Type', nameAr: 'النوع' }], rows,
    } });
    const matrix = await prisma.products.findUnique({ where: { id: productId }, include: { product_variants: true, catalog_details: true } });
    expect(matrix.stock_quantity).toBe(rows.reduce((sum, row) => sum + (row.available ? row.stock : 0), 0));
    expect(matrix.catalog_details.presentation.variantEditor.enabled).toBe(true);
    expect(matrix.sale_price_egp).toBeNull();
    expect(matrix.catalog_details.presentation.colorOffers).toEqual({});
    expect(Object.values(matrix.catalog_details.presentation.variantOffers)).toEqual(rows.map(row => row.salePriceEgp));
    expect(new Set(Object.values(matrix.catalog_details.presentation.variantOffers))).toEqual(new Set([300]));
    expect(matrix.product_variants.filter(variant => matrix.catalog_details.presentation.variantEditor.ids.includes(variant.id))).toHaveLength(rows.length);
    expect(matrix.product_variants.filter(variant => matrix.catalog_details.presentation.variantEditor.ids.includes(variant.id)).map(variant => variant.stock_quantity).sort()).toEqual(rows.map(row => row.stock).sort());
    await expect(repository.saveProduct(admin.id, { ...input, id: productId, expectedUpdatedAt: first.updated_at.toISOString() })).rejects.toThrow('PRODUCT_EDIT_STALE');
  } catch (error) {
    if (error?.name === 'AssertionError') throw error;
    // Driver errors may carry connection details; report only a safe stage/code.
    // eslint-disable-next-line preserve-caught-error -- Driver causes can expose disposable connection credentials.
    throw new Error(`PRESENTATION_TEST_FAILED:${stage}:${/^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'UNKNOWN'}:${error?.constructor?.name || 'Error'}`);
  } finally { await prisma?.$disconnect().catch(() => {}); await sql?.end().catch(() => {}); await postgres.stop(); }
}, 120000);
