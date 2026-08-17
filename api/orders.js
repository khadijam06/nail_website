const { getCloudinaryState } = require('../server/cloudinary-client');
const { sendJson } = require('../server/http');
const { submitOrderFromRequest } = require('../server/orders');

module.exports = async function handler(req, res) {
  console.log('[orders] request start', {
    method: req?.method,
    url: req?.url,
  });

  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed', expectedMethod: 'POST' });
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

    const result = await submitOrderFromRequest(req, cloudinary);
    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[orders] failed', error);
    const statusCode = ['VALIDATION_ERROR', 'EMAIL_CONFIGURATION_ERROR', 'EMAIL_SEND_FAILED'].includes(error?.code)
      ? 400
      : 500;

    return sendJson(res, statusCode, {
      error: error?.message || 'Unable to submit order',
      code: error?.code || 'ORDER_SUBMISSION_FAILED',
      details: error?.details || null,
    });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
