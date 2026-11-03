const { z } = require('zod');
const optional = z.string().trim().default('');
const cloudinarySchema = z.object({
  CLOUDINARY_CLOUD_NAME: optional,
  CLOUDINARY_API_KEY: optional,
  CLOUDINARY_API_SECRET: optional,
  CLOUDINARY_ROOT_FOLDER: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/).default('alreda-store'),
  CLOUDINARY_FOLDER_MODE: z.enum(['auto', 'dynamic', 'fixed']).default('auto'),
  MEDIA_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(41943040).default(20971520),
  MEDIA_MAX_IMAGE_COUNT: z.coerce.number().int().min(1).max(20).default(12),
}).superRefine((value, ctx) => {
  const keys = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  if (keys.some(key => value[key])) {
    for (const key of keys) if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required when Cloudinary is configured' });
    if (value.CLOUDINARY_CLOUD_NAME && !/^[a-zA-Z0-9_-]{1,100}$/.test(value.CLOUDINARY_CLOUD_NAME)) ctx.addIssue({ code: 'custom', path: ['CLOUDINARY_CLOUD_NAME'], message: 'Invalid cloud name' });
    if (value.CLOUDINARY_API_KEY && !/^\d{1,100}$/.test(value.CLOUDINARY_API_KEY)) ctx.addIssue({ code: 'custom', path: ['CLOUDINARY_API_KEY'], message: 'Invalid API key' });
  }
});
function readCloudinaryConfig(source = process.env) {
  const parsed = cloudinarySchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid Cloudinary configuration: ${[...new Set(parsed.error.issues.map(issue => issue.path.join('.')))].join(', ')}`);
  const value = parsed.data;
  return Object.freeze({ enabled: Boolean(value.CLOUDINARY_CLOUD_NAME), cloudName: value.CLOUDINARY_CLOUD_NAME,
    apiKey: value.CLOUDINARY_API_KEY, apiSecret: value.CLOUDINARY_API_SECRET, rootFolder: value.CLOUDINARY_ROOT_FOLDER,
    folderMode: value.CLOUDINARY_FOLDER_MODE, maxUploadBytes: value.MEDIA_MAX_UPLOAD_BYTES, maxImageCount: value.MEDIA_MAX_IMAGE_COUNT });
}
// Credentials are passed per SDK request, never through EJS/app.locals or global SDK configuration.
function createCloudinaryClient(source = process.env) {
  return { config: readCloudinaryConfig(source), client: require('cloudinary').v2 };
}
module.exports = { readCloudinaryConfig, createCloudinaryClient };
