const { z } = require('zod');
const sharp = require('sharp');
const { createHash } = require('node:crypto');
class MediaError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'MediaError'; this.code = code; this.status = status; }
}
const entityId = z.string().min(1).max(200).regex(/^[\p{L}\p{N}_-]+$/u);
const identifier = z.string().min(1).max(200).regex(/^[\p{L}\p{N} _-]+$/u);
const mediaInputSchema = z.object({
  entityId, sku: identifier.optional(), slug: identifier.optional(), variantId: entityId.optional(),
  placement: z.enum(['homepage', 'promotions', 'seasonal']).optional(),
  device: z.enum(['desktop', 'mobile']).optional(), brandType: z.enum(['logos', 'icons']).optional(),
  page: z.enum(['about', 'contact']).optional(),
  altText: z.string().max(1000).default(''), displayOrder: z.number().int().min(0).max(10000).default(0),
}).strict();
const formats = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
async function validateImage(buffer, config, declaredMime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new MediaError('INVALID_IMAGE');
  if (buffer.length > config.maxUploadBytes) throw new MediaError('IMAGE_TOO_LARGE', 413);
  try {
    const image = sharp(buffer, { limitInputPixels: 50000000, failOn: 'warning' });
    const meta = await image.metadata();
    const format = meta.format === 'heif' && meta.compression === 'av1' ? 'avif' : meta.format;
    if (!formats[format] || (meta.pages || 1) > 1 || !meta.width || !meta.height || (declaredMime && formats[format] !== declaredMime)) throw new Error();
    await image.stats(); // Decode actual bytes; MIME/filename checks alone are insufficient.
    return { width: meta.width, height: meta.height, format, bytes: buffer.length,
      contentHash: createHash('sha256').update(buffer).digest('hex') };
  } catch { throw new MediaError('INVALID_IMAGE'); }
}
module.exports = { MediaError, mediaInputSchema, entityId, formats, validateImage };
