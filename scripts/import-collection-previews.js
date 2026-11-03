// Explicit UI snapshot import; never called during application startup.
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const aliases = {
  'delight-bathroom-accessories-individual-pieces': 'individual-pieces',
  'luxury-bathroom-accessories-sets': 'accessories-sets', 'bathroom-mirrors': 'mirrors',
  'delight-shower-corner-shelf': 'bathroom-shelves', 'towel-racks': 'towel-holders',
  'delight-toilet-brush-stainless-304': 'toilet-brush', 'hand-dryer': 'hand-dryers',
  'hair-dryer': 'hair-dryers', 'safe-box': 'safe-boxes', 'door-knobs': 'door-handles',
  'basket-%D8%A8%D8%A7%D8%B3%D9%83%D8%AA': 'waste-bins',
};
const sourceSchema = z.object({
  sourceSlug: z.string().regex(/^[a-zA-Z0-9%_-]{1,200}$/),
  name: z.string().min(1).max(200),
  sourceImage: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'alredastore.com' && url.pathname.startsWith('/cdn/shop/collections/');
  }),
});
async function run() {
  const response = await fetch('https://alredastore.com/', { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error('Reference homepage unavailable');
  const html = await response.text();
  const blocks = [...html.matchAll(/<li\b[^>]*class="[^"]*collection-list__item[^"]*"[^>]*>([\s\S]*?)<\/li>/g)];
  if (blocks.length !== 18) throw new Error('Reference collection structure changed; review before import');
  const output = [];
  const directory = path.resolve(__dirname, '../src/public/images/collection-previews');
  await fs.mkdir(directory, { recursive: true });
  for (const [index, match] of blocks.entries()) {
    const block = match[1];
    const href = block.match(/href="\/collections\/([^"]+)"/)?.[1];
    const rawImage = block.match(/\bsrc="([^"]+)"/)?.[1];
    const source = sourceSchema.parse({ sourceSlug: href,
      name: block.match(/\balt="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&'),
      sourceImage: rawImage ? `https:${rawImage.replaceAll('&amp;', '&')}` : undefined,
    });
    const slug = aliases[source.sourceSlug] || source.sourceSlug;
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Review collection slug mapping');
    const imageUrl = new URL(source.sourceImage);
    imageUrl.searchParams.set('width', '640');
    imageUrl.searchParams.set('height', '640');
    imageUrl.searchParams.set('crop', 'center');
    imageUrl.searchParams.set('format', 'webp');
    const imageResponse = await fetch(imageUrl, { headers: { Accept: 'image/webp' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
    const extension = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[imageResponse.headers.get('content-type')?.split(';')[0]];
    if (!imageResponse.ok || !extension) throw new Error('Collection image download failed');
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    if (bytes.length > 5000000) throw new Error('Collection image too large');
    const file = `${slug}.${extension}`;
    await fs.writeFile(path.join(directory, file), bytes);
    output.push({ ...source, slug, group: index < 15 ? 'primary' : 'secondary', image: `/assets/images/collection-previews/${file}` });
  }
  // Preserve the previously published hotel-accessories link without adding an extra homepage tile.
  const handDryer = output.find(item => item.slug === 'hand-dryers');
  output.push({ ...handDryer, slug: 'hotel-accessories', name: 'Hotel Accessories', group: 'legacy' });
  await fs.writeFile(path.resolve(__dirname, '../src/config/collection-preview.json'), JSON.stringify(output, null, 2) + '\n');
  console.info('Saved 18 collection images and retained the existing legacy collection link.');
}
run().catch(() => { console.error('Collection preview import failed. Review source markup and network access.'); process.exitCode = 1; });
