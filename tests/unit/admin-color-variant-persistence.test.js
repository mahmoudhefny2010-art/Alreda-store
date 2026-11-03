const { createAdminManagementRepository } = require('../../src/repositories/admin-management.repository');
const { productSchema } = require('../../src/validators/admin.validator');

const actorId = 'd2e4097a-4c78-44c8-b411-9ed4acec2380';
const categoryId = '1ac93ec3-2e14-4a25-a187-cc67d68fa331';
const productId = '26be682a-af63-42d3-8903-b9f0db579cb2';

it.each([null, 725])('persists color prices, images and stock with optional override %s', async override => {
  const variants = [];
  const images = [];
  const details = [];
  const tx = {
    users: { findFirst: async () => ({ id: actorId, role: 'admin', user_roles: [] }) },
    categories: { findFirst: async () => ({ id: categoryId }) },
    products: { findUnique: async () => ({ sale_price_egp: null }), update: async () => ({ id: productId }) },
    catalog_details: { findUnique: async () => null, upsert: async ({ create, update }) => { details.push(create || update); return create || update; } },
    product_categories: { upsert: async () => ({}) },
    product_variants: {
      findMany: async () => variants,
      create: async ({ data }) => { const saved = { id: `db-${variants.length}`, ...data }; variants.push(saved); return saved; },
    },
    product_images: {
      updateMany: async () => ({}),
      findFirst: async ({ where }) => images.find(image => image.secure_url === where.secure_url) || null,
      create: async ({ data }) => { const saved = { id: `image-${images.length}`, ...data }; images.push(saved); return saved; },
      findMany: async ({ where }) => images.filter(image => where.secure_url.in.includes(image.secure_url)),
    },
    admin_audit_events: { create: async () => ({}) },
  };
  const prisma = { $transaction: work => work(tx) };
  const repository = createAdminManagementRepository(() => prisma);
  const imageA = 'https://res.cloudinary.com/pjwlhib7/image/upload/store/a.jpg';
  const imageB = 'https://res.cloudinary.com/pjwlhib7/image/upload/store/b.jpg';
  const data = productSchema.parse({
    id: productId, name: 'Sample', nameAr: 'عينة', description: '', descriptionAr: '', categoryId,
    priceEgp: '500', stock: '4', available: 'on', images: `${imageA}\n${imageB}`,
    colorVariants: JSON.stringify([{ color: 'Black', imageUrl: imageA, stock: 3 }, { color: 'Gold', imageUrl: imageB, stock: 1, priceEgp: override, salePriceEgp: override == null ? 400 : 600 }]),
  });

  await repository.saveProduct(actorId, data);

  expect(variants.map(item => JSON.parse(item.options))).toEqual([['Black'], ['Gold']]);
  expect(variants.map(item => item.source_image_id)).toEqual(images.map(image => image.source_id));
  expect(variants.map(item => item.stock_quantity)).toEqual([3, 1]);
  expect(variants.map(item => item.price_egp)).toEqual([500, override ?? 500]);
  expect(details[0].presentation.colorPrices).toEqual(override == null ? {} : { Gold: override });
  expect(details[0].presentation.colorOffers).toEqual({ Gold: override == null ? 400 : 600 });
  expect(variants.map(item => item.is_available)).toEqual([true, true]);
  expect(details[0]).toMatchObject({ color_en: 'Black, Gold', color_ar: expect.stringContaining(', ') });
});
