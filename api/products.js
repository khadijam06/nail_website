const { getCloudinaryState } = require('../server/cloudinary-client');
const { sendJson } = require('../server/http');
const { listProducts, filterProducts, sortProducts, toPublicProduct, VALID_CATEGORIES } = require('../server/products');

function validatePublicQuery(query) {
  const errors = [];
  const allowedSort = ['newest', 'oldest', 'alpha'];

  if (query.sort && !allowedSort.includes(query.sort)) {
    errors.push('sort must be one of newest, oldest, alpha');
  }

  if (query.category && query.category !== 'all' && !VALID_CATEGORIES.includes(query.category)) {
    errors.push('category must be all, Chrome, French Tips, Cateye, or 3D Art');
  }

  if (query.search && String(query.search).length > 120) {
    errors.push('search query is too long');
  }

  return errors;
}

const FALLBACK_COVERS = {
  Chrome: 'brand_assets/style-cards/chrome.jpg',
  'French Tips': 'brand_assets/style-cards/french-tips.jpg',
  Cateye: 'brand_assets/style-cards/cateye.jpg',
  '3D Art': 'brand_assets/style-cards/3d-art.jpg',
};

function buildCategoryCovers(products) {
  const covers = {};

  VALID_CATEGORIES.forEach((category) => {
    const candidates = products.filter((product) => product.category === category);
    const cover = candidates.find((product) => product.isCategoryCover) || candidates[0] || null;
    covers[category] = {
      category,
      productId: cover?.id || null,
      imageUrl: cover?.mainImageUrl || FALLBACK_COVERS[category] || '',
      title: cover?.title || category,
      fallback: !cover,
    };
  });

  return covers;
}

module.exports = async function handler(req, res) {
  console.log('[products] request start', {
    method: req?.method,
    url: req?.url,
  });

  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed', expectedMethod: 'GET' });
    }

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

    const query = req.query || {};
    const queryErrors = validatePublicQuery(query);
    if (queryErrors.length) {
      return sendJson(res, 400, {
        error: 'Invalid query parameters',
        code: 'INVALID_QUERY',
        details: { queryErrors },
      });
    }

    const allProducts = await listProducts(cloudinary);
    const publishedProducts = allProducts.filter((product) => product.status === 'published');

    const filtered = filterProducts(publishedProducts, {
      category: query.category || 'all',
      status: 'published',
      search: query.search || '',
    });

    const sorted = sortProducts(filtered, query.sort || 'newest');

    return sendJson(res, 200, {
      success: true,
      products: sorted.map(toPublicProduct),
      categoryCovers: buildCategoryCovers(publishedProducts),
    });
  } catch (error) {
    console.error('[products] catch', error);
      const nestedMessage = error?.error?.message || error?.cause?.message;
      return sendJson(res, 500, { error: error?.message || nestedMessage || 'Unable to load products' });
  }
};
