const { getCloudinaryState } = require('../server/cloudinary-client');
const { sendJson } = require('../server/http');
const { listGalleryImages, buildGallerySlots } = require('../server/gallery');

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
    const images = await listGalleryImages(cloudinary);

    return sendJson(res, 200, {
      success: true,
      images,
      slots: buildGallerySlots(images),
    });
  } catch (error) {
    console.error('[gallery] failed to load images', error);

    return sendJson(res, 500, {
      error: error?.message || 'Unable to load gallery',
    });
  }
};