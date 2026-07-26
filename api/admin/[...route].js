const { IncomingForm } = require('formidable');
const { getCloudinaryState } = require('../../server/cloudinary-client');
const { parseBearerToken, parseJsonBody, sendJson } = require('../../server/http');
const { createToken, verifyToken } = require('../../server/admin-auth');
const {
  listProducts,
  createProduct,
  updateProduct,
  duplicateProduct,
  deleteProduct,
  filterProducts,
  sortProducts,
  listUnassignedAssets,
  deleteUnassignedAsset,
  VALID_CATEGORIES,
  VALID_STATUSES,
} = require('../../server/products');
const {
  listGalleryImages,
  buildGallerySlots,
  uploadGalleryImages,
  replaceGalleryImage,
  saveGalleryItems,
  deleteGalleryImage,
  ensureValidSlot,
  sanitizeText,
} = require('../../server/gallery');

function toErrorPayload(error, fallbackMessage, defaultCode) {
  const nestedMessage = error?.error?.message || error?.cause?.message;
  return {
    error: error?.message || nestedMessage || fallbackMessage,
    code: error?.code || defaultCode || 'ADMIN_OPERATION_FAILED',
    details: error?.details || null,
  };
}

function getRouteParts(req) {
  const raw = req?.query?.route;
  if (Array.isArray(raw)) return raw.map((item) => String(item || '').toLowerCase());
  if (raw) return [String(raw).toLowerCase()];

  const fromUrl = String(req?.url || '')
    .split('?')[0]
    .replace(/^\/api\/admin\/?/i, '')
    .split('/')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);

  return fromUrl;
}

function stripRouteQuery(query = {}) {
  const next = { ...query };
  delete next.route;
  return next;
}

function firstValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function cleanText(value, max = 500) {
  return sanitizeText(firstValue(value), max);
}

function validateListQuery(query) {
  const errors = [];
  const allowedSort = ['newest', 'oldest', 'alpha'];
  if (query.sort && !allowedSort.includes(query.sort)) {
    errors.push('sort must be one of newest, oldest, alpha');
  }

  if (query.status && query.status !== 'all' && !VALID_STATUSES.includes(query.status)) {
    errors.push('status must be all, draft, or published');
  }

  if (query.category && query.category !== 'all' && !VALID_CATEGORIES.includes(query.category)) {
    errors.push('category must be all, Chrome, French Tips, Cateye, or 3D Art');
  }

  if (query.search && String(query.search).length > 120) {
    errors.push('search query is too long');
  }

  return errors;
}

async function parseMultipart(req) {
  const form = new IncomingForm({
    multiples: true,
    keepExtensions: true,
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 20,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        fields: fields || {},
        files: files || {},
      });
    });
  });
}

function normalizeUploadFiles(files) {
  const rawPhotos = files.photos || files.photo || files.images || files.image;
  if (!rawPhotos) return [];
  return Array.isArray(rawPhotos) ? rawPhotos : [rawPhotos];
}

function getCloudinaryContextString(contextObj) {
  return Object.entries(contextObj || {})
    .map(([key, value]) => `${cleanText(key, 64)}=${cleanText(value, 500).replace(/=/g, ' ')}`)
    .filter((entry) => entry !== '=')
    .join('|');
}

async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed', expectedMethod: 'POST' });
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminJwtSecret = process.env.ADMIN_JWT_SECRET;
  if (!adminPassword || !adminJwtSecret) {
    return sendJson(res, 500, { error: 'Admin environment variables are not configured' });
  }

  const body = await parseJsonBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendJson(res, 400, { error: 'Request body must be a JSON object' });
  }

  const password = String(body.password || '');
  if (!password.trim()) {
    return sendJson(res, 400, { error: 'Password is required' });
  }

  if (password !== adminPassword) {
    return sendJson(res, 401, { error: 'Invalid password' });
  }

  const token = createToken(adminJwtSecret);
  return sendJson(res, 200, { token, expiresIn: 3600 });
}

async function handleProducts(req, res, cloudinary) {
  if (req.method === 'GET') {
    const query = stripRouteQuery(req.query || {});
    const queryErrors = validateListQuery(query);
    if (queryErrors.length) {
      return sendJson(res, 400, {
        error: 'Invalid query parameters',
        code: 'INVALID_QUERY',
        details: { queryErrors },
      });
    }

    const products = await listProducts(cloudinary);
    const filtered = filterProducts(products, {
      category: query.category || 'all',
      status: query.status || 'all',
      search: query.search || '',
    });

    return sendJson(res, 200, {
      success: true,
      products: sortProducts(filtered, query.sort || 'newest'),
    });
  }

  const body = await parseJsonBody(req);
  if (!body || typeof body !== 'object') {
    return sendJson(res, 400, { error: 'Request body must be valid JSON', code: 'INVALID_BODY' });
  }

  if (req.method === 'POST') {
    const action = body.action || 'create';
    if (action === 'duplicate') {
      const product = await duplicateProduct(cloudinary, { id: body.id || body.sourceId });
      return sendJson(res, 200, { success: true, product });
    }

    if (action !== 'create') {
      return sendJson(res, 400, {
        error: 'Unsupported action',
        code: 'INVALID_ACTION',
        details: { allowedActions: ['create', 'duplicate'] },
      });
    }

    const product = await createProduct(cloudinary, body);
    return sendJson(res, 201, { success: true, product });
  }

  if (req.method === 'PUT') {
    const product = await updateProduct(cloudinary, body);
    return sendJson(res, 200, { success: true, product });
  }

  if (req.method === 'DELETE') {
    const payload = body.id ? body : { ...body, id: stripRouteQuery(req.query || {}).id };
    const deleted = await deleteProduct(cloudinary, payload);
    return sendJson(res, 200, { success: true, deleted });
  }

  return sendJson(res, 405, {
    error: 'Method not allowed',
    expectedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  });
}

async function handleUpload(req, res, cloudinary) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed', expectedMethod: 'POST' });
  }

  const { fields, files } = await parseMultipart(req);
  const uploadedFiles = normalizeUploadFiles(files);

  if (!uploadedFiles.length) {
    return sendJson(res, 400, { error: 'No images uploaded', code: 'NO_FILES' });
  }

  const title = cleanText(fields.title, 120);
  const category = cleanText(fields.category, 80);
  const price = cleanText(fields.price, 64);
  const description = cleanText(fields.description, 500);

  const uploads = await Promise.all(uploadedFiles.map(async (uploadedFile) => {
    if (!uploadedFile?.filepath) {
      const error = new Error('Uploaded file is missing a temporary filepath');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    return cloudinary.uploader.upload(uploadedFile.filepath, {
      folder: 'nailit_gallery',
      resource_type: 'image',
      tags: ['nailit_unassigned'],
      context: getCloudinaryContextString({
        title,
        category,
        price,
        description,
        asset_state: 'unassigned',
      }),
      transformation: [
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });
  }));

  return sendJson(res, 200, {
    success: true,
    uploaded: uploads.map((upload) => ({
      id: upload.asset_id,
      publicId: upload.public_id,
      url: upload.secure_url,
    })),
  });
}

async function handleUnassigned(req, res, cloudinary) {
  if (req.method === 'GET') {
    const assets = await listUnassignedAssets(cloudinary);
    return sendJson(res, 200, { success: true, assets });
  }

  if (req.method === 'DELETE') {
    const body = await parseJsonBody(req);
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'Request body must be valid JSON', code: 'INVALID_BODY' });
    }

    const publicId = body.publicId || body.public_id || stripRouteQuery(req.query || {}).publicId;
    const deleted = await deleteUnassignedAsset(cloudinary, publicId);
    return sendJson(res, 200, { success: true, deleted });
  }

  return sendJson(res, 405, {
    error: 'Method not allowed',
    expectedMethods: ['GET', 'DELETE'],
  });
}

async function handleGallery(req, res, cloudinary) {
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
    const mode = cleanText(fields.mode, 24).toLowerCase() || 'add';
    const existing = await listGalleryImages(cloudinary);

    if (mode === 'replace') {
      const slot = ensureValidSlot(firstValue(fields.slot));
      const alt = cleanText(fields.alt, 160);
      const [file] = normalizeUploadFiles(files);
      await replaceGalleryImage(cloudinary, { file, slot, alt }, existing);
    } else {
      const uploads = normalizeUploadFiles(files);
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
      return sendJson(res, 400, { error: 'Request body must be valid JSON', code: 'INVALID_BODY' });
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
      return sendJson(res, 400, { error: 'Request body must be valid JSON', code: 'INVALID_BODY' });
    }

    const existing = await listGalleryImages(cloudinary);
    const publicId = body.publicId || body.public_id || stripRouteQuery(req.query || {}).publicId;
    await deleteGalleryImage(cloudinary, publicId, existing);

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
}

module.exports = async function handler(req, res) {
  console.log('[admin-router] request start', {
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

    const [section] = getRouteParts(req);

    if (section === 'login') {
      return handleLogin(req, res);
    }

    const token = parseBearerToken(req.headers);
    if (!verifyToken(token)) {
      return sendJson(res, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (section === 'products') {
      return handleProducts(req, res, cloudinary);
    }

    if (section === 'upload') {
      return handleUpload(req, res, cloudinary);
    }

    if (section === 'unassigned') {
      return handleUnassigned(req, res, cloudinary);
    }

    if (section === 'gallery') {
      return handleGallery(req, res, cloudinary);
    }

    if (section === 'list') {
      const products = await listProducts(cloudinary);
      return sendJson(res, 200, { images: products.flatMap((p) => p.images || []) });
    }

    if (section === 'delete') {
      if (req.method !== 'DELETE') {
        return sendJson(res, 405, { error: 'Method not allowed', expectedMethod: 'DELETE' });
      }
      const body = await parseJsonBody(req);
      const publicId = body?.public_id || body?.publicId;
      const deleted = await deleteUnassignedAsset(cloudinary, publicId);
      return sendJson(res, 200, { deleted: Boolean(deleted) });
    }

    return sendJson(res, 404, {
      error: 'Unknown admin route',
      availableRoutes: ['login', 'products', 'upload', 'unassigned', 'gallery'],
    });
  } catch (error) {
    console.error('[admin-router] catch', error);
    const statusCode = ['VALIDATION_ERROR', 'INVALID_REMOVE_IMAGES', 'MISSING_EXISTING_IMAGES', 'NOT_FOUND', 'INVALID_QUERY', 'INVALID_BODY'].includes(error?.code)
      ? 400
      : 500;

    return sendJson(res, statusCode, toErrorPayload(error, 'Admin operation failed', 'ADMIN_OPERATION_FAILED'));
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
