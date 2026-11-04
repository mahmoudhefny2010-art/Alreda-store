const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const publicRoot = path.resolve(__dirname, '../public');
const versions = new Map();
function version(filename) {
  if (!versions.has(filename)) {
    // Read once per asset per process; never perform filesystem work on warm renders.
    versions.set(filename, createHash('sha256').update(fs.readFileSync(filename)).digest('hex').slice(0, 12));
  }
  return versions.get(filename);
}
function assetUrl(url) {
  if (!/^\/assets\/(?:css|js)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:css|js)$/.test(url)) return url;
  return `${url}?v=${version(path.join(publicRoot, url.slice('/assets/'.length)))}`;
}
function isVersionedAsset(filename, suppliedVersion) {
  return typeof suppliedVersion === 'string' && /^[a-f0-9]{12}$/.test(suppliedVersion)
    && filename.startsWith(publicRoot + path.sep) && /\.(?:css|js)$/.test(filename)
    && suppliedVersion === version(filename);
}
module.exports = { assetUrl, isVersionedAsset };
