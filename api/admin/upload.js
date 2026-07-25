const { Cloudinary } = require('cloudinary').v2;
const formidable = require('formidable');
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  const form = formidable({ multiples: true });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'Invalid form data' });

    const images = Array.isArray(files.photos) ? files.photos : [files.photos];
    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    try {
      const uploads = await Promise.all(images.map(photo => {
        return cloudinary.uploader.upload(photo.filepath, {
          folder: 'nailit_gallery',
          resource_type: 'image',
          context: `title=${fields.title || ''}|category=${fields.category || ''}|price=${fields.price || ''}|description=${fields.description || ''}`,
          transformation: [{ quality: 'auto' }, { fetch_format: 'auto' }],
        });
      }));

      res.status(200).json({ uploaded: uploads.map(u => ({ id: u.asset_id, url: u.secure_url })) });
    } catch (uploadError) {
      res.status(500).json({ error: uploadError.message || 'Upload failed' });
    }
  });
};
