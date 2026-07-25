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
  console.error('[delete] Cloudinary init failed', error);
}

const { verifyToken } = require('./auth');

module.exports = async function handler(req, res) {
  console.log('[delete] request start', { method: req?.method, url: req?.url, hasAuth: Boolean(req?.headers?.authorization) });

  try {
    if (req.method !== 'DELETE') {
      return res.status(405).json({ error: 'Method not allowed', expectedMethod: 'DELETE' });
    }

    if (!cloudinary) {
      return res.status(500).json({ error: 'Cloudinary failed to initialize', details: cloudinaryInitError?.message || 'Unknown initialization error' });
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });

    const { public_id } = req.body || {};
    if (!public_id) return res.status(400).json({ error: 'Missing public_id' });

    const result = await cloudinary.uploader.destroy(public_id, { resource_type: 'image' });
    if (result.result !== 'ok') {
      return res.status(500).json({ error: 'Failed to delete image' });
    }
    return res.status(200).json({ deleted: public_id });
  } catch (error) {
    console.error('[delete] catch', error);
    return res.status(500).json({ error: error.message || 'Delete failed' });
  }
};
