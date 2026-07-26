const { IncomingForm } = require('formidable');
const { verifyToken } = require('./auth');
const { getCloudinaryState } = require('../lib/cloudinary-client');
const { parseBearerToken, parseJsonBody, sendJson } = require('../lib/http');
const {
  listGalleryImages,
  buildGallerySlots,
  uploadGalleryImages,
  replaceGalleryImage,
  deleteGalleryImage,
  saveGalleryItems,
  ensureValidSlot,
  sanitizeText,
} = require('../lib/gallery');

function toErrorPayload(error, fallbackMessage) {
  const nestedMessage = error?.error?.message || error?.cause?.message;
  return {
    error: error?.message || nestedMessage || fallbackMessage,
    code: error?.code || 'GALLERY_OPERATION_FAILED',
    details: error?.details || null,
  };
}

function normalizeFiles(files) {
  const raw = files?.photos || files?.photo || files?.images || files?.image;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

async function parseMultipart(req) {
  const form = new IncomingForm({
    multiples: true,
    keepExtensions: true,
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 6,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ fields: fields || {}, files: files || {} });
    });
  });
}

module.exports = async function handler(req, res) {
  console.log('[admin/gallery] request start', {
    method: req?.method,
    url: req?.url,
    hasAuth: Boolean(req?.headers?.authorization),
  });

  try {
    const { cloudinary, initError, missingConfig } = getCloudinaryState();
    if (!cloudinary) {
      return sendJson(res, 500, {
        error: 'Cloudinary failed to initialize',
        details: initError?.message || 'Unknown Cloudinary initialization error',
      });
    }

    if (missingConfig.length) {
      return sendJson(res, 500, {
        error: 'Cloudinary configuration is incomplete',
        missing: missingConfig,
      });
    }

    const token = parseBearerToken(req.headers);
    if (!verifyToken(token)) {
      return sendJson(res, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (req.method === 'GET') {
      const images = await listGalleryImages(cloudinary);
      return sendJson(res, 200, {
        success: true,
        images,
        slots: buildGallerySlots(images),
      });
    }

    if (req.method === 'POST') {
      const { fields, files } = await parseMultipart(req);
      const mode = sanitizeText(fields.mode, 24).toLowerCase() || 'add';
      const existing = await listGalleryImages(cloudinary);

      if (mode === 'replace') {
        const slot = ensureValidSlot(fields.slot);
        const alt = sanitizeText(fields.alt, 160);
        const [file] = normalizeFiles(files);
        await replaceGalleryImage(cloudinary, { file, slot, alt }, existing);
      } else {
        const uploads = normalizeFiles(files);
        await uploadGalleryImages(cloudinary, uploads, existing);
      }

      const images = await listGalleryImages(cloudinary);
      return sendJson(res, 200, {
        success: true,
        images,
        slots: buildGallerySlots(images),
      });
    }

    if (req.method === 'PUT') {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        return sendJson(res, 400, {
          error: 'Request body must be valid JSON',
          code: 'INVALID_BODY',
        });
      }

      const existing = await listGalleryImages(cloudinary);
      await saveGalleryItems(cloudinary, body.items || [], existing);

      const images = await listGalleryImages(cloudinary);
      return sendJson(res, 200, {
        success: true,
        images,
        slots: buildGallerySlots(images),
      });
    }

    if (req.method === 'DELETE') {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        return sendJson(res, 400, {
          error: 'Request body must be valid JSON',
          code: 'INVALID_BODY',
        });
      }

      const existing = await listGalleryImages(cloudinary);
      await deleteGalleryImage(cloudinary, body.publicId, existing);

      const images = await listGalleryImages(cloudinary);
      return sendJson(res, 200, {
        success: true,
        images,
        slots: buildGallerySlots(images),
      });
    }

    return sendJson(res, 405, {
      error: 'Method not allowed',
      expectedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    });
  } catch (error) {
    console.error('[admin/gallery] catch', error);
    const statusCode = error?.code === 'VALIDATION_ERROR' || error?.code === 'NOT_FOUND' ? 400 : 500;
    return sendJson(res, statusCode, toErrorPayload(error, 'Gallery operation failed'));
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
