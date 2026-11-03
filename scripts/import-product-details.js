// Manual reference snapshot import. No network calls are made by the storefront.
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const catalog = require('../src/config/catalog-preview.json');
const money = z.string().regex(/^\d{1,9}\.\d{2}$/);
const imageSchema = z.object({ src: z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.hostname === 'cdn.shopify.com'
    && url.pathname.startsWith('/s/files/1/0706/3692/9202/');
}), alt: z.string().max(1000).nullable().optional() });
const productSchema = z.object({ product: z.object({
  handle: z.string().regex(/^[a-z0-9-]{1,200}$/), title: z.string().min(1).max(500),
  vendor: z.string().max(200).default(''), product_type: z.string().max(200).default(''),
  body_html: z.string().max(100000).nullable().default(''),
  images: z.array(imageSchema).min(1).max(100),
  options: z.array(z.object({ name: z.string().min(1).max(100), values: z.array(z.string().max(200)).min(1).max(250) })).max(3),
  variants: z.array(z.object({
    id: z.union([z.number().int().safe().positive(), z.string().regex(/^\d+$/)]).transform(String),
    title: z.string().max(500), price: money,
    compare_at_price: z.preprocess(value => value === '' ? null : value, money.nullable().optional()),
    sku: z.string().max(200).nullable().optional(),
    option1: z.string().max(200).nullable().optional(), option2: z.string().max(200).nullable().optional(), option3: z.string().max(200).nullable().optional(),
  })).min(1).max(250),
}) });

async function run() {
  const handles = [...new Set(Object.values(catalog.collections).flat().map(record => {
    const url = new URL(record.sourceUrl);
    if (url.origin !== 'https://alredastore.com' || !/^\/products\/[a-z0-9-]{1,200}$/.test(url.pathname)) throw new Error('Invalid product source');
    return url.pathname.split('/').pop();
  }))];
  const directory = path.resolve(__dirname, '../src/public/images/product-details');
  await fs.mkdir(directory, { recursive: true });
  const output = { capturedAt: new Date().toISOString(), products: {} };
  async function importProduct(handle) {
    const response = await fetch(`https://alredastore.com/products/${handle}.json`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Reference product unavailable');
    const parsed = productSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error('Invalid reference fields:', parsed.error.issues.map(issue => issue.path.join('.')).join(', '));
      throw new Error('Reference schema validation failed');
    }
    const { product } = parsed.data;
    if (product.handle !== handle) throw new Error('Unexpected reference product');
    const gallery = [];
    for (const [index, image] of product.images.slice(0, 4).entries()) {
      const url = new URL(image.src);
      url.searchParams.set('width', '1000');
      const result = await fetch(url, { headers: { Accept: 'image/webp' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
      const extension = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[result.headers.get('content-type')?.split(';')[0]];
      if (!result.ok || !extension) throw new Error('Invalid product gallery image');
      const bytes = Buffer.from(await result.arrayBuffer());
      if (bytes.length > 5000000) throw new Error('Product image too large');
      const filename = `${handle}-${index + 1}.${extension}`;
      await fs.writeFile(path.join(directory, filename), bytes);
      gallery.push({ src: `/assets/images/product-details/${filename}`, alt: image.alt || product.title, source: image.src });
    }
    return [handle, { slug: handle, name: product.title, vendor: product.vendor, productType: product.product_type,
      descriptionHtml: product.body_html || '', gallery,
      options: product.options,
      variants: product.variants.map(variant => ({ id: variant.id, title: variant.title, priceAmount: variant.price,
        compareAtAmount: variant.compare_at_price || null, sku: variant.sku || '',
        options: [variant.option1, variant.option2, variant.option3].slice(0, product.options.length).map(value => value || ''),
      })), sourceUrl: `https://alredastore.com/products/${handle}` }];
  }
  for (let index = 0; index < handles.length; index += 2) {
    const results = await Promise.allSettled(handles.slice(index, index + 2).map(importProduct));
    for (const result of results) {
      if (result.status !== 'fulfilled') throw result.reason;
      output.products[result.value[0]] = result.value[1];
    }
  }
  await fs.writeFile(path.resolve(__dirname, '../src/config/product-details-preview.json'), JSON.stringify(output, null, 2) + '\n');
  console.info(`Imported details and local galleries for ${handles.length} preview products.`);
}
run().catch(error => { console.error('Product detail import failed:', error.name, error.message === 'Reference schema validation failed' ? error.message : 'Check reference data and network access.'); process.exitCode = 1; });
