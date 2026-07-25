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

  const missingConfig = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter((key) => !process.env[key]);
  if (missingConfig.length) {
    return res.status(500).json({ error: `Cloudinary credentials are missing: ${missingConfig.join(', ')}` });
  }

  const form = formidable({ multiples: true });
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse failed', err);
      return res.status(400).json({ error: 'Invalid form data' });
    }

    const uploadedFiles = Array.isArray(files.photos) ? files.photos : [files.photos];
    const images = uploadedFiles.filter(Boolean);
    if (!images.length) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    try {
      const uploads = await Promise.all(images.map((photo) => {
        const title = String(fields.title || '').replace(/\|/g, ' ').trim();
        const category = String(fields.category || '').replace(/\|/g, ' ').trim();
        const price = String(fields.price || '').replace(/\|/g, ' ').trim();
        const description = String(fields.description || '').replace(/\|/g, ' ').trim();

        return cloudinary.uploader.upload(photo.filepath, {
          folder: 'nailit_gallery',
          resource_type: 'image',
          context: {
            custom: {
              title,
              category,
              price,
              description,
            },
          },
          transformation: [{ quality: 'auto' }, { fetch_format: 'auto' }],
        });
      }));

      return res.status(200).json({ uploaded: uploads.map((u) => ({ id: u.asset_id, url: u.secure_url })) });
    } catch (uploadError) {
      console.error('Cloudinary upload failed', uploadError);
      return res.status(500).json({ error: uploadError.message || 'Upload failed' });
    }
  });
};
