const { Cloudinary } = require('cloudinary').v2;
const { verifyToken } = require('./auth');

const cloudinary = new Cloudinary({
  cloud: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  },
  url: { secure: true },
});

module.exports = async (req, res) => {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  const { public_id } = req.body || {};
  if (!public_id) return res.status(400).json({ error: 'Missing public_id' });

  try {
    const result = await cloudinary.uploader.destroy(public_id, { resource_type: 'image' });
    if (result.result !== 'ok') {
      return res.status(500).json({ error: 'Failed to delete image' });
    }
    res.status(200).json({ deleted: public_id });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Delete failed' });
  }
};
