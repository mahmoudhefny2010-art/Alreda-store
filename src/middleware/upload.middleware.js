const multer = require('multer');
const { readCloudinaryConfig } = require('../config/cloudinary');
const { MediaError, formats, validateImage } = require('../validators/media.validator');
function createUploadMiddleware({ authorizeAdmin, config = readCloudinaryConfig(), field = 'images' } = {}) {
  if (typeof authorizeAdmin !== 'function') throw new MediaError('ADMIN_AUTHORIZER_REQUIRED', 503);
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes,
    files: config.maxImageCount, fields: 20, fieldSize: 4096, parts: config.maxImageCount + 20 },
  fileFilter: (req, file, callback) => callback(Object.values(formats).includes(file.mimetype) ? null : new MediaError('INVALID_IMAGE_TYPE'), true),
  }).array(field, config.maxImageCount);
  return async (req, res, next) => {
    try {
      // The injected policy must use verified server-side session/permissions, never a request role field.
      if (!(await authorizeAdmin(req))) throw new MediaError('ADMIN_REQUIRED', 403);
      parse(req, res, async error => {
        try {
          if (error) throw error instanceof multer.MulterError ? new MediaError(error.code === 'LIMIT_FILE_SIZE' ? 'IMAGE_TOO_LARGE' : 'INVALID_UPLOAD', error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : error;
          if (!req.files?.length) throw new MediaError('IMAGE_REQUIRED');
          for (const file of req.files) file.validatedImage = await validateImage(file.buffer, config, file.mimetype);
          next();
        } catch (failure) { next(failure); }
      });
    } catch (error) { next(error); }
  };
}
module.exports = { createUploadMiddleware };
