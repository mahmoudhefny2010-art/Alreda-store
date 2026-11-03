require('dotenv').config({ quiet: true });
const { getPrismaClient, disconnectDatabase } = require('../../src/config/prisma');
async function verify() {
  const client = getPrismaClient();
  try {
    const result = await client.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const products = await tx.$queryRaw`SELECT count(*)::int AS total, count(source_id)::int AS sourced,
        count(*) FILTER (WHERE image_url LIKE 'https://res.cloudinary.com/%')::int AS cloudinary_main,
        count(*) FILTER (WHERE image_url = '')::int AS missing_main FROM public.products`;
      const categories = await tx.$queryRaw`SELECT count(*)::int AS total, count(source_id)::int AS sourced,
        count(*) FILTER (WHERE image_url LIKE 'https://res.cloudinary.com/%')::int AS cloudinary_covers FROM public.categories`;
      const variants = await tx.$queryRaw`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE stock_quantity IS NOT NULL)::int AS assigned_stock FROM public.product_variants`;
      const images = await tx.$queryRaw`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE secure_url LIKE 'https://res.cloudinary.com/%')::int AS cloudinary,
        count(*) FILTER (WHERE secure_url NOT LIKE 'https://res.cloudinary.com/%')::int AS other_hosts FROM public.product_images`;
      const links = await tx.$queryRaw`SELECT count(*)::int AS total FROM public.product_categories`;
      const binary = await tx.$queryRaw`SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema='public' AND table_name IN ('products','categories','product_variants','product_images') AND data_type='bytea'`;
      const orders = await tx.$queryRaw`SELECT count(*)::int AS total FROM public.orders`;
      return { products: products[0], categories: categories[0], variants: variants[0], images: images[0],
        collectionLinks: links[0].total, binaryImageColumns: binary[0].count, orders: orders[0].total };
    }, { timeout: 20000 });
    console.info(JSON.stringify(result));
  } finally { await disconnectDatabase(); }
}
verify().catch(() => { console.error(JSON.stringify({ success: false, code: 'CATALOG_VERIFICATION_FAILED' })); process.exitCode = 1; });
