/* global beforeEach, afterEach */
const prisma = require('../../src/config/prisma');
const catalogPath = require.resolve('../../src/services/catalog.repository');
let originalProvider; let originalUrl; let originalDirect;
beforeEach(() => {
  originalProvider = prisma.getPrismaClient; originalUrl = process.env.DATABASE_URL; originalDirect = process.env.DIRECT_URL;
  process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic'; delete process.env.DIRECT_URL;
  delete require.cache[catalogPath];
});
afterEach(() => {
  prisma.getPrismaClient = originalProvider;
  if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  if (originalDirect === undefined) delete process.env.DIRECT_URL; else process.env.DIRECT_URL = originalDirect;
  delete require.cache[catalogPath];
});
function client() {
  return { categories: { findMany: vi.fn(async () => []) }, products: { findMany: vi.fn(async () => []) },
    discount_rules: { findMany: vi.fn(async () => []) }, storefront_sections: { findMany: vi.fn(async () => []) } };
}
it('reads current catalog data again on the next request instead of serving a 30-second snapshot', async () => {
  const db = client(); prisma.getPrismaClient = () => db;
  const repository = require(catalogPath);
  await repository.getDatabaseCatalog(); await repository.getDatabaseCatalog();
  expect(db.products.findMany).toHaveBeenCalledTimes(2);
});
it('does not let an older in-flight read replace or clear a newer invalidated read', async () => {
  const db = client(); prisma.getPrismaClient = () => db;
  let finishOld;
  db.products.findMany.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const repository = require(catalogPath);
  const old = repository.getDatabaseCatalog();
  repository.invalidateDatabaseCatalog();
  await repository.getDatabaseCatalog(); finishOld([]); await old;
  await repository.getDatabaseCatalog();
  expect(db.products.findMany).toHaveBeenCalledTimes(3);
});

it('loads only categories and homepage sections for the storefront homepage', async () => {
  const db = client();
  prisma.getPrismaClient = () => db;
  const repository = require(catalogPath);
  const source = repository.categories[0];
  db.categories.findMany.mockResolvedValue([{
    id: 'database-category-id', source_id: source.sourceId, slug: source.slug, name: 'Updated category',
    name_ar: 'تصنيف محدث', description: null, description_ar: null, image_url: null,
    home_section_id: 'section-id', homepage_order: 2,
    home_section: { id: 'section-id', slug: 'primary', title_en: 'Main', title_ar: 'الرئيسية', display_order: 0 },
  }]);
  db.storefront_sections.findMany.mockResolvedValue([{
    id: 'section-id', slug: 'primary', title_en: 'Main', title_ar: 'الرئيسية', display_order: 0, is_active: true,
  }]);

  const homepage = await repository.getDatabaseHomepage();

  expect(homepage.categories).toHaveLength(1);
  expect(homepage.categories[0]).toMatchObject({
    id: 'database-category-id', slug: source.slug, name: 'Updated category',
    image: source.image, group: 'primary', homeSectionId: 'section-id', homeOrder: 2,
  });
  expect(homepage.sections[0]).toMatchObject({ titleEn: 'Main', titleAr: 'الرئيسية' });
  expect(db.categories.findMany).toHaveBeenCalledTimes(1);
  expect(db.storefront_sections.findMany).toHaveBeenCalledTimes(1);
  expect(db.products.findMany).not.toHaveBeenCalled();
  expect(db.discount_rules.findMany).not.toHaveBeenCalled();
});
