const { getCloudinaryState } = require('./lib/cloudinary-client');
const { sendJson } = require('./lib/http');
const { listProducts } = require('./lib/products');

module.exports = async function handler(req, res) {
  console.log('[gallery] request start', {
    method: req?.method,
    url: req?.url,
  });

  if (req.method !== 'GET') {
    return sendJson(res, 405, {
      error: 'Method not allowed',
      expectedMethod: 'GET',
    });
  }

  const { cloudinary, initError, missingConfig } = getCloudinaryState();

  if (!cloudinary) {
    return sendJson(res, 500, {
      error: 'Cloudinary failed to initialize',
      details: initError?.message || 'Unknown Cloudinary initialization error',
    });
  }

  if (missingConfig.length > 0) {
    return sendJson(res, 500, {
      error: 'Cloudinary configuration is incomplete',
      missing: missingConfig,
    });
  }

  try {
    const products = await listProducts(cloudinary);
    const images = products
      .filter((product) => product.status === 'published')
      .flatMap((product) =>
        (product.images || []).map((img) => ({
          id: img.id,
          publicId: img.publicId,
          title: product.title,
          category: product.category,
          description: product.shortDescription,
          price: product.price,
          url: img.url,
          thumbnail: img.url,
          createdAt: product.createdAt,
        })),
      )
      .slice(0, 80);

    return sendJson(res, 200, {
      success: true,
      images,
    });
  } catch (error) {
    console.error('[gallery] failed to load images', error);

    return sendJson(res, 500, {
      error: error?.message || 'Unable to load gallery',
    });
  }
};