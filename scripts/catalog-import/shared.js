const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { z } = require('zod');
const root = path.resolve(__dirname, '../..');
const directory = path.join(root, 'data/imports/alreda');
const origin = 'https://alredastore.com';
const hash = value => createHash('sha256').update(value).digest('hex');
const id = z.union([z.number().int().safe().positive(), z.string().regex(/^\d+$/)]).transform(String);
const handle = z.string().min(1).max(200).regex(/^[\p{L}\p{N}_-]+$/u);
const money = z.string().regex(/^\d{1,9}\.\d{2}$/);
const imageUrl = z.url().refine(value => {
  const u = new URL(value);
  return u.protocol === 'https:' && ((u.hostname === 'cdn.shopify.com' && u.pathname.startsWith('/s/files/1/0706/3692/9202/'))
    || (u.hostname === 'alredastore.com' && u.pathname.startsWith('/cdn/shop/')));
});
const image = z.object({ id: id.optional(), src: imageUrl, alt: z.string().nullable().optional(),
  position: z.number().int().optional(), width: z.number().optional(), height: z.number().optional(), variant_ids: z.array(id).optional() });
const product = z.object({ id, handle, title: z.string().min(1).max(1000), body_html: z.string().max(500000).nullable().optional(),
  vendor: z.string().optional(), product_type: z.string().optional(), tags: z.union([z.array(z.string()), z.string()]).optional(),
  images: z.array(image).max(500), options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).max(3),
  variants: z.array(z.object({ id, title: z.string(), price: money,
    compare_at_price: z.preprocess(v => v === '' ? null : v, money.nullable().optional()), sku: z.string().nullable().optional(),
    option1: z.string().nullable().optional(), option2: z.string().nullable().optional(), option3: z.string().nullable().optional(),
    available: z.boolean().nullable().optional(), featured_image: image.nullable().optional(),
  })).min(1).max(1000), updated_at: z.string().optional(), published_at: z.string().nullable().optional(),
});
const collection = z.object({ id, handle, title: z.string(), description: z.string().nullable().optional(),
  image: image.nullable().optional(), products_count: z.number().int().nonnegative().nullable().optional() });
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
}
function publicUrl(value) {
  const url = new URL(value, origin);
  if (url.origin !== origin || !/^\/(?:ar\/)?(?:products|collections|sitemap[^/]*\.xml|robots\.txt|$)/.test(url.pathname)) throw new Error('Unexpected source URL');
  return url.href;
}
async function fetchPublic(url, { raw = true, refresh = false } = {}) {
  url = publicUrl(url);
  const filename = path.join(directory, 'raw', hash(url) + '.json');
  if (!refresh) {
    try { return JSON.parse(await fs.readFile(filename, 'utf8')).body; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await new Promise(resolve => setTimeout(resolve, 160));
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'AlredaCatalogMigration/1.0 (authorized store content migration)' } });
  if (!response.ok) throw new Error(`Public source HTTP ${response.status}: ${new URL(url).pathname}`);
  const body = await response.text();
  if (Buffer.byteLength(body) > 20000000) throw new Error('Source response too large');
  if (raw) await writeJson(filename, { url, capturedAt: new Date().toISOString(), body });
  return body;
}
module.exports = { fs, path, root, directory, origin, hash, id, handle, money, imageUrl, product, collection, writeJson, fetchPublic };
