let cloudinary;
let cloudinaryInitError = null;

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
  console.error('[gallery] Cloudinary initialization failed', error);
}

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function') {
    return res.status(statusCode).json(payload);
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(payload));
}

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

  if (!cloudinary) {
    return sendJson(res, 500, {
      error: 'Cloudinary failed to initialize',
      details:
        cloudinaryInitError?.message ||
        'Unknown Cloudinary initialization error',
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

  try {
    const result = await cloudinary.search
      .expression('folder:nailit_gallery AND resource_type:image')
      .sort_by('created_at', 'desc')
      .max_results(50)
      .with_field('context')
      .execute();

    const images = (result.resources || []).map((item) => {
      const custom = item.context?.custom || {};

      return {
        id: item.asset_id,
        publicId: item.public_id,
        title: custom.title || '',
        category: custom.category || '',
        description: custom.description || '',
        price: custom.price || '',
        url: item.secure_url,
        thumbnail: item.secure_url,
        createdAt: item.created_at,
      };
    });

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