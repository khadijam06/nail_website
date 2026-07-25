const { verifyToken } = require('./auth');
const { getCloudinaryState } = require('../lib/cloudinary-client');
const { parseBearerToken, parseJsonBody, sendJson } = require('../lib/http');
const { listUnassignedAssets, deleteUnassignedAsset } = require('../lib/products');

function toErrorPayload(error, fallbackMessage) {
  const nestedMessage = error?.error?.message || error?.cause?.message;
  return {
    error: error?.message || nestedMessage || fallbackMessage,
    code: error?.code || 'UNASSIGNED_ASSET_OPERATION_FAILED',
    details: error?.details || null,
  };
}

module.exports = async function handler(req, res) {
  console.log('[admin/unassigned] request start', {
    method: req?.method,
    url: req?.url,
    hasAuth: Boolean(req?.headers?.authorization),
  });

  try {
    const { cloudinary, initError, missingConfig } = getCloudinaryState();
    if (!cloudinary) {
      return sendJson(res, 500, {
        error: 'Cloudinary failed to initialize',
        code: 'CLOUDINARY_INIT_FAILED',
        details: initError?.message || 'Unknown Cloudinary initialization error',
      });
    }

    if (missingConfig.length) {
      return sendJson(res, 500, {
        error: 'Cloudinary configuration is incomplete',
        code: 'CLOUDINARY_CONFIG_MISSING',
        details: { missing: missingConfig },
      });
    }

    const token = parseBearerToken(req.headers);
    if (!verifyToken(token)) {
      return sendJson(res, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (req.method === 'GET') {
      const assets = await listUnassignedAssets(cloudinary);
      return sendJson(res, 200, { success: true, assets });
    }

    if (req.method === 'DELETE') {
      const body = await parseJsonBody(req);
      const publicId = body?.publicId;
      if (!publicId) {
        return sendJson(res, 400, {
          error: 'publicId is required',
          code: 'MISSING_PUBLIC_ID',
        });
      }

      const deleted = await deleteUnassignedAsset(cloudinary, publicId);
      return sendJson(res, 200, { success: true, deleted });
    }

    return sendJson(res, 405, {
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
      expectedMethods: ['GET', 'DELETE'],
    });
  } catch (error) {
    console.error('[admin/unassigned] catch', error);
    const statusCode = error?.message?.toLowerCase().includes('invalid') ? 400 : 500;
    return sendJson(res, statusCode, toErrorPayload(error, 'Unassigned asset operation failed'));
  }
};
