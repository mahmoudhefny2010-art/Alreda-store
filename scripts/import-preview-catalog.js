// Explicit, one-off UI snapshot import. Never executed by application startup.
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const { categories } = require('../src/config/storefront-preview');
const sources = Object.fromEntries(categories.map(category => [category.slug, category.sourceSlug]));
const imageSchema = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.hostname === 'cdn.shopify.com'
    && url.pathname.startsWith('/s/files/1/0706/3692/9202/');
});
const sourceSchema = z.object({ products: z.array(z.object({
  title: z.string().min(1).max(500), handle: z.string().regex(/^[a-z0-9-]+$/),
  images: z.array(z.object({ src: imageSchema })).min(1),
  variants: z.array(z.object({ price: z.string().regex(/^\d{1,9}\.\d{2}$/) })).min(1),
})).max(4) });

async function run() {
  const imageDirectory = path.resolve(__dirname, '../src/public/images/catalog-preview');
  await fs.mkdir(imageDirectory, { recursive: true });
  const snapshot = { capturedAt: new Date().toISOString(), currency: 'EGP', collections: {} };
  for (const [slug, source] of Object.entries(sources)) {
    const sourceResponse = await fetch(`https://alredastore.com/collections/${source}/products.json?limit=4`, {
      signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    if (!sourceResponse.ok) throw new Error('Preview catalog download failed');
    const { products } = sourceSchema.parse(await sourceResponse.json());
    snapshot.collections[slug] = [];
    for (const [index, product] of products.entries()) {
      const url = new URL(product.images[0].src);
      url.searchParams.set('width', '640');
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
      const type = response.headers.get('content-type')?.split(';')[0];
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
      if (!response.ok || !extension) throw new Error('Preview image download failed');
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 5000000) throw new Error('Preview image too large');
      const imageName = `${slug}-${index + 1}.${extension}`;
      await fs.writeFile(path.join(imageDirectory, imageName), data);
      snapshot.collections[slug].push({
        id: `${slug}-${index + 1}`, name: product.title,
        image: `/assets/images/catalog-preview/${imageName}`,
        priceAmount: product.variants[0].price,
        sourceUrl: `https://alredastore.com/products/${product.handle}`,
        sourceImage: product.images[0].src,
      });
    }
  }
  await fs.writeFile(path.resolve(__dirname, '../src/config/catalog-preview.json'), JSON.stringify(snapshot, null, 2) + '\n');
  console.info('Imported product samples for configured collections. No database updated.');
}
run().catch(() => { console.error('Preview import failed. Check source data and network access.'); process.exitCode = 1; });
