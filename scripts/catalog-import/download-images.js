const sharp = require('sharp');
const { fs, path, root, directory, hash, imageUrl, writeJson } = require('./shared');
function canonicalImage(value) {
  const url = new URL(imageUrl.parse(value));
  if (url.hostname === 'alredastore.com') { url.hostname = 'cdn.shopify.com'; url.pathname = '/s/files/1/0706/3692/9202/' + url.pathname.replace(/^\/cdn\/shop\//, ''); }
  const version = url.searchParams.get('v');
  url.search = '';
  if (version) url.searchParams.set('v', version);
  return url.href;
}
async function downloadImages(catalog) {
  const manifestPath = path.join(directory, 'image-manifest.json');
  let manifest = {};
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const requests = new Map();
  const add = (url, kind) => { if (url) requests.set(canonicalImage(url), kind); };
  for (const product of catalog.products) for (const image of product.gallery) add(image.source, 'products');
  for (const category of catalog.collections) add(category.sourceImage, 'collections');
  const queue = [...requests.entries()];
  let next = 0;
  let completed = 0;
  const failures = [];
  const assets = {};
  let restricted = false;
  async function worker() {
    while (next < queue.length && !restricted) {
      const [url, kind] = queue[next++];
      try {
        let asset = manifest[url];
        const local = value => path.join(root, 'src/public', value.replace('/assets/', ''));
        if (asset) {
          try {
            const bytes = await fs.readFile(local(asset.src));
            if (hash(bytes) !== asset.sha256) throw new Error('Image checksum mismatch');
            const cardMeta = await sharp(local(asset.cardSrc)).metadata();
            const displayMeta = await sharp(local(asset.displaySrc)).metadata();
            asset.cardWidth = cardMeta.width; asset.displayWidth = displayMeta.width;
          } catch { asset = null; }
        }
        if (!asset) {
          await new Promise(resolve => setTimeout(resolve, 180));
          const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'AlredaCatalogMigration/1.0' } });
          if ([401, 403, 429].includes(response.status)) restricted = true;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          if (!/^image\/(jpeg|png|webp|avif|gif)(;|$)/.test(response.headers.get('content-type') || '')) throw new Error('Invalid image content type');
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 40000000) throw new Error('Image exceeds 40MB limit');
          const meta = await sharp(bytes, { limitInputPixels: 100000000 }).metadata();
          const extension = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', heif: 'avif', gif: 'gif' }[meta.format];
          if (!extension || !meta.width || !meta.height) throw new Error('Invalid image bytes');
          const digest = hash(bytes);
          const prefix = `/assets/images/${kind}/${digest}`;
          const original = `${prefix}.${extension}`;
          const card = `${prefix}-640.webp`;
          const display = `${prefix}-1200.webp`;
          await fs.mkdir(path.dirname(local(original)), { recursive: true });
          await fs.writeFile(local(original), bytes);
          const cardInfo = await sharp(bytes).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 85 }).toFile(local(card));
          const displayInfo = await sharp(bytes).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 88 }).toFile(local(display));
          asset = { src: original, cardSrc: card, displaySrc: display, width: meta.width, height: meta.height,
            cardWidth: cardInfo.width, displayWidth: displayInfo.width, sha256: digest, bytes: bytes.length };
          manifest[url] = asset;
        }
        assets[url] = asset;
      } catch (error) { failures.push({ url, reason: error.message }); }
      completed++;
      if (completed % 25 === 0 || completed === queue.length) {
        await writeJson(manifestPath, manifest);
        console.info(`Images validated/downloaded ${completed}/${queue.length}; failures ${failures.length}`);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  for (const [url] of queue.slice(next)) failures.push({ url, reason: 'Not attempted after source access/rate restriction' });
  await writeJson(manifestPath, manifest);
  for (const product of catalog.products) for (const image of product.gallery) {
    const asset = assets[canonicalImage(image.source)];
    if (asset) Object.assign(image, asset, { srcSet: asset.displayWidth > asset.cardWidth ? `${asset.cardSrc} ${asset.cardWidth}w, ${asset.displaySrc} ${asset.displayWidth}w` : `${asset.displaySrc} ${asset.displayWidth}w` });
  }
  for (const category of catalog.collections) {
    const asset = category.sourceImage ? assets[canonicalImage(category.sourceImage)] : null;
    if (asset) { category.image = asset.cardSrc; category.originalImage = asset.src; }
  }
  const stored = [...new Map(Object.values(assets).map(asset => [asset.src, asset])).values()];
  return { catalog, failures, discoveredImages: queue.length, downloadedImages: Object.keys(assets).length,
    uniqueStoredOriginalFiles: stored.length, originalBytes: stored.reduce((sum, asset) => sum + asset.bytes, 0) };
}
module.exports = { downloadImages, canonicalImage };
