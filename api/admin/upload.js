let cloudinary;
let cloudinaryInitError = null;

let IncomingForm;
let formidableInitError = null;

try {
  cloudinary = require('cloudinary').v2;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
} catch (error) {
  cloudinaryInitError = error;
  console.error('[upload] Cloudinary initialization failed', error);
}

try {
  ({ IncomingForm } = require('formidable'));

  if (typeof IncomingForm !== 'function') {
    throw new Error('Formidable IncomingForm is unavailable');
  }
} catch (error) {
  formidableInitError = error;
  console.error('[upload] Formidable initialization failed', error);
}

const { verifyToken } = require('./auth');

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') {
    return res.status(statusCode).json(payload);
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(payload));
}

function getFirstValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

function cleanText(value) {
  return String(getFirstValue(value))
    .replace(/\|/g, ' ')
    .trim();
}

function toCloudinaryContext(contextObj) {
  return Object.entries(contextObj || {})
    .map(([key, value]) => `${cleanText(key)}=${cleanText(value).replace(/=/g, ' ')}`)
    .filter((entry) => entry !== '=')
    .join('|');
}

function toUploadErrorPayload(error, fallbackMessage) {
  const nestedMessage = error?.error?.message || error?.cause?.message;
  return {
    error: error?.message || nestedMessage || fallbackMessage,
    code: error?.code || 'UPLOAD_FAILED',
    details: error?.details || null,
  };
}

const handler = async function handler(req, res) {
  console.log('[upload] request start', {
    method: req?.method,
    url: req?.url,
    hasAuthorization: Boolean(req?.headers?.authorization),
  });

  if (req.method !== 'POST') {
    return sendJson(res, 405, {
      error: 'Method not allowed',
      expectedMethod: 'POST',
    });
  }

  if (!cloudinary || !IncomingForm) {
    return sendJson(res, 500, {
      error: 'Upload dependencies failed to initialize',
      details:
        cloudinaryInitError?.message ||
        formidableInitError?.message ||
        'Unknown initialization error',
    });
  }

  const missingConfig = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ].filter((key) => !process.env[key]);

  if (missingConfig.length > 0) {
    return sendJson(res, 500, {
      error: 'Cloudinary configuration is incomplete',
      missing: missingConfig,
    });
  }

  const authorizationHeader = req.headers.authorization || '';
  const token = authorizationHeader.startsWith('Bearer ')
    ? authorizationHeader.slice(7)
    : '';

  if (!token || !verifyToken(token)) {
    return sendJson(res, 401, {
      error: 'Unauthorized',
    });
  }

  try {
    const form = new IncomingForm({
      multiples: true,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 20,
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (error, parsedFields, parsedFiles) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          fields: parsedFields || {},
          files: parsedFiles || {},
        });
      });
    });

    const rawPhotos = files.photos || files.photo || files.images || files.image;

    const uploadedFiles = Array.isArray(rawPhotos)
      ? rawPhotos
      : rawPhotos
        ? [rawPhotos]
        : [];

    if (uploadedFiles.length === 0) {
      return sendJson(res, 400, {
        error: 'No images uploaded',
      });
    }

    const title = cleanText(fields.title);
    const category = cleanText(fields.category);
    const price = cleanText(fields.price);
    const description = cleanText(fields.description);

    const uploads = await Promise.all(
      uploadedFiles.map(async (uploadedFile) => {
        if (!uploadedFile?.filepath) {
          throw new Error('Uploaded file is missing a temporary filepath');
        }

        return cloudinary.uploader.upload(uploadedFile.filepath, {
          folder: 'nailit_gallery',
          resource_type: 'image',
          tags: ['nailit_unassigned'],
          context: toCloudinaryContext({
            title,
            category,
            price,
            description,
            asset_state: 'unassigned',
          }),
          transformation: [
            {
              quality: 'auto',
              fetch_format: 'auto',
            },
          ],
        });
      }),
    );

    return sendJson(res, 200, {
      success: true,
      uploaded: uploads.map((upload) => ({
        id: upload.asset_id,
        publicId: upload.public_id,
        url: upload.secure_url,
      })),
    });
  } catch (error) {
    console.error('[upload] request failed', error);

    return sendJson(res, 500, toUploadErrorPayload(error, 'Upload failed'));
  }
};

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};