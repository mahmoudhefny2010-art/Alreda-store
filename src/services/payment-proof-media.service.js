const { randomUUID, createHash } = require('node:crypto');
const sharp = require('sharp');
const { createCloudinaryClient } = require('../config/cloudinary');
const { validateImage } = require('../validators/media.validator');
function createPaymentProofMedia({ config, client, fetchImpl = fetch } = {}) {
  if (!config || !client) { const defaults = createCloudinaryClient(); config ||= defaults.config; client ||= defaults.client; }
  const options = () => {
    if (!config.enabled) throw new Error('PAYMENT_UPLOAD_UNAVAILABLE');
    return { cloud_name: config.cloudName, api_key: config.apiKey, api_secret: config.apiSecret, secure: true, timeout: 20000 };
  };
  const prefix = `${config.rootFolder}/payment-proofs/`;
  return {
    async upload(buffer, mime) {
      options();
      const metadata = await validateImage(buffer, { maxUploadBytes: 5242880 }, mime);
      if (!['png','jpeg','webp'].includes(metadata.format) || metadata.width * metadata.height > 15000000) throw new Error('INVALID_PAYMENT_IMAGE');
      const image = await sharp(buffer).rotate().png().toBuffer();
      if (image.length > 10485760) throw new Error('INVALID_PAYMENT_IMAGE');
      const publicId = prefix + randomUUID();
      const result = await new Promise((resolve, reject) => {
        const stream = client.uploader.upload_stream({ ...options(), public_id: publicId, resource_type: 'image', type: 'authenticated', overwrite: false }, (error, value) => error ? reject(new Error('PAYMENT_UPLOAD_FAILED')) : resolve(value));
        stream.on('error', () => reject(new Error('PAYMENT_UPLOAD_FAILED'))); stream.end(image);
      });
      if (result?.public_id !== publicId || result.type !== 'authenticated' || result.resource_type !== 'image' || result.format !== 'png') throw new Error('PAYMENT_UPLOAD_FAILED');
      return { public_id: publicId, format: 'png', content_hash: createHash('sha256').update(image).digest('hex') };
    },
    async remove(asset) { if (!asset.public_id.startsWith(prefix)) throw new Error('INVALID_PAYMENT_ASSET'); await client.uploader.destroy(asset.public_id, { ...options(), type: 'authenticated', resource_type: 'image' }); },
    async read(asset) {
      if (!asset.public_id.startsWith(prefix) || asset.format !== 'png') throw new Error('INVALID_PAYMENT_ASSET');
      const url = client.utils.private_download_url(asset.public_id, 'png', { ...options(), type: 'authenticated', resource_type: 'image', expires_at: Math.floor(Date.now()/1000)+60, attachment: false });
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error('PAYMENT_IMAGE_UNAVAILABLE');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 10485760) throw new Error('PAYMENT_IMAGE_UNAVAILABLE');
      return buffer;
    },
  };
}
module.exports = { createPaymentProofMedia };
