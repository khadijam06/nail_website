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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const folder = 'nailit_gallery';
    const result = await cloudinary.search
      .expression(`folder:${folder} AND resource_type:image`)
      .sort_by('uploaded_at', 'desc')
      .max_results(100)
      .execute();

    const images = result.resources.map(item => ({
      public_id: item.public_id,
      title: item.context?.custom?.title || '',
      category: item.context?.custom?.category || '',
      description: item.context?.custom?.description || '',
      price: item.context?.custom?.price || '',
      url: item.secure_url,
    }));
    res.status(200).json({ images });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to list images' });
  }
};
