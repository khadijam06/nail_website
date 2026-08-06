const { getCloudinaryState } = require('../server/cloudinary-client');
const { sendJson } = require('../server/http');
const { verifyToken } = require('../server/admin-auth');
const { isValidSectionKey, getSection } = require('../server/content-store');

function parseKeys(rawPage) {
  return String(rawPage || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
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
    return sendJson(res, 500, { error: 'Cloudinary configuration is incomplete', missing: missingConfig });
  }

  const query = req.query || {};
  const keys = parseKeys(query.page);

  if (!keys.length) {
    return sendJson(res, 400, { error: 'page query parameter is required', code: 'INVALID_QUERY' });
  }

  const invalidKeys = keys.filter((key) => !isValidSectionKey(key));
  if (invalidKeys.length) {
    return sendJson(res, 400, {
      error: 'Unknown content section requested',
      code: 'INVALID_QUERY',
      details: { invalidKeys },
    });
  }

  const wantsDraft = String(query.status || '') === 'draft';
  let status = 'published';

  if (wantsDraft) {
    const previewToken = String(query.previewToken || '');
    if (!verifyToken(previewToken)) {
      return sendJson(res, 401, { error: 'A valid preview token is required to view draft content', code: 'UNAUTHORIZED' });
    }
    status = 'draft';
  }

  try {
    const sections = {};
    await Promise.all(
      keys.map(async (key) => {
        sections[key] = await getSection(cloudinary, key, status);
      }),
    );

    return sendJson(res, 200, { success: true, status, sections });
  } catch (error) {
    console.error('[content] failed to load sections', error);
    return sendJson(res, 500, { error: error?.message || 'Unable to load content' });
  }
};
