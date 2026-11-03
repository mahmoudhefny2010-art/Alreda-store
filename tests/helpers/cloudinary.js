const { Writable } = require('node:stream');
const { v2 } = require('cloudinary');
const { readCloudinaryConfig } = require('../../src/config/cloudinary');
// Synthetic configuration; tests never contact an account.
const source = { CLOUDINARY_CLOUD_NAME: 'alreda-test', CLOUDINARY_API_KEY: '123456', CLOUDINARY_API_SECRET: 'synthetic-test-secret', CLOUDINARY_FOLDER_MODE: 'dynamic' };
function mockCloudinary(mode = 'dynamic') {
  const resources = new Map(); const calls = { upload: [], lookup: [], delete: [], config: 0 };
  const client = { url: (...args) => v2.url(...args), api: {
    config: async () => { calls.config++; return { folder_mode: mode }; },
    resource: async publicId => { calls.lookup.push(publicId); if (!resources.has(publicId)) throw { http_code: 404 }; return resources.get(publicId); },
    delete_resources_by_asset_ids: async ids => { calls.delete.push(ids); return { deleted: Object.fromEntries(ids.map(id => [id, 'deleted'])) }; },
  }, uploader: {
    upload_stream: (options, callback) => {
      calls.upload.push(options);
      return new Writable({ write(chunk, encoding, next) { next(); }, final(next) {
        const publicId = options.folder ? `${options.folder}/${options.public_id}` : options.public_id;
        const record = { public_id: publicId, asset_id: 'asset-' + resources.size, secure_url: `https://res.cloudinary.com/alreda-test/image/upload/v1/${publicId}.png`,
          resource_type: 'image', type: 'upload', width: 64, height: 80, format: 'png', bytes: 200, version: 1,
          ...(options.asset_folder ? { asset_folder: options.asset_folder } : {}), context: { custom: options.context } };
        resources.set(publicId, record); callback(null, record); next();
      } });
    },
  } };
  return { client, resources, calls, config: readCloudinaryConfig({ ...source, CLOUDINARY_FOLDER_MODE: mode }) };
}
module.exports = { source, mockCloudinary };
