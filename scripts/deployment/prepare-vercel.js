const fs = require('node:fs/promises');
const path = require('node:path');

async function prepareVercel(root = path.resolve(__dirname, '../..')) {
  const source = path.join(root, 'src/public');
  const output = path.join(root, 'public');
  const localImageCaches = new Set(['products', 'collections', 'catalog-preview', 'collection-previews', 'product-details']);
  const rootResources = new Set(['manifest.webmanifest', 'offline.html', 'service-worker.js', 'onesignal']);
  await fs.mkdir(path.join(output, 'assets'), { recursive: true });
  await fs.cp(source, path.join(output, 'assets'), { recursive: true, filter: filename => {
    const parts = path.relative(source, filename).split(path.sep);
    return !rootResources.has(parts[0]) && !(parts[0] === 'images' && localImageCaches.has(parts[1]));
  } });
  for (const filename of ['manifest.webmanifest', 'offline.html', 'service-worker.js']) {
    await fs.copyFile(path.join(source, filename), path.join(output, filename));
  }
  await fs.mkdir(path.join(output, 'onesignal'), { recursive: true });
  for (const filename of ['onesignal/OneSignalSDKWorker.js', 'OneSignalSDKWorker.js']) {
    await fs.copyFile(path.join(source, 'onesignal/OneSignalSDKWorker.js'), path.join(output, filename));
  }
  return output;
}

if (require.main === module) prepareVercel().then(() => console.info('Vercel public assets prepared.')).catch(() => {
  console.error('Vercel asset preparation failed.'); process.exitCode = 1;
});
module.exports = { prepareVercel };
