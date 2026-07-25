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
  console.error('[gallery] Cloudinary init failed', error);
}

module.exports = async function handler(req, res) {
  console.log('[gallery] request start', { method: req?.method, url: req?.url });

  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed', expectedMethod: 'GET' });
    }

    if (!cloudinary) {
      return res.status(500).json({ error: 'Cloudinary failed to initialize', details: cloudinaryInitError?.message || 'Unknown initialization error' });
    }

    const folder = 'nailit_gallery';
    const result = await cloudinary.search
      .expression(`folder:${folder} AND resource_type:image`)
      .sort_by('uploaded_at', 'desc')
      .max_results(50)
      .execute();

    const images = result.resources.map(item => ({
      id: item.asset_id,
      title: item.context?.custom?.title || '',
      category: item.context?.custom?.category || '',
      description: item.context?.custom?.description || '',
      price: item.context?.custom?.price || '',
      url: item.secure_url,
      thumbnail: item.secure_url,
    }));

    return res.status(200).json({ images });
  } catch (error) {
    console.error('[gallery] catch', error);
    return res.status(500).json({ error: error.message || 'Unable to load gallery' });
  }
};
