const { verifyToken } = require('./auth');
const { getCloudinaryState } = require('../lib/cloudinary-client');
const { parseBearerToken, parseJsonBody, sendJson } = require('../lib/http');
const {
  listProducts,
  createProduct,
  updateProduct,
  duplicateProduct,
  deleteProduct,
  filterProducts,
  sortProducts,
  VALID_CATEGORIES,
  VALID_STATUSES,
} = require('../lib/products');

function toErrorPayload(error, fallbackMessage) {
  const nestedMessage = error?.error?.message || error?.cause?.message;
  return {
    error: error?.message || nestedMessage || fallbackMessage,
    code: error?.code || 'PRODUCT_OPERATION_FAILED',
    details: error?.details || null,
  };
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

module.exports = async function handler(req, res) {
  console.log('[admin/products] request start', {
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
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    if (req.method === 'GET') {
      const query = req.query || {};
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
      return sendJson(res, 400, { error: 'Request body must be valid JSON' });
    }

    if (req.method === 'POST') {
      const action = body.action || 'create';
      if (action === 'duplicate') {
        const product = await duplicateProduct(cloudinary, body);
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
      const deleted = await deleteProduct(cloudinary, body);
      return sendJson(res, 200, { success: true, deleted });
    }

    return sendJson(res, 405, {
      error: 'Method not allowed',
      expectedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    });
  } catch (error) {
    console.error('[admin/products] catch', error);
    const statusCode = error?.code === 'VALIDATION_ERROR' || error?.code === 'INVALID_REMOVE_IMAGES' || error?.code === 'MISSING_EXISTING_IMAGES'
      ? 400
      : 500;
    return sendJson(res, statusCode, toErrorPayload(error, 'Product operation failed'));
  }
};
