const { getCloudinaryState } = require('./lib/cloudinary-client');
const { sendJson } = require('./lib/http');
const { listProducts, filterProducts, sortProducts, toPublicProduct, VALID_CATEGORIES } = require('./lib/products');

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
    return sendJson(res, 500, { error: error?.message || 'Unable to load products' });
  }
};
