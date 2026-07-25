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
} = require('../lib/products');

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
    return sendJson(res, 500, { error: error?.message || 'Product operation failed' });
  }
};
