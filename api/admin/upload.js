let cloudinary;
let cloudinaryInitError = null;
let formidable;
let formidableInitError = null;

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
  console.error('[upload] Cloudinary init failed', error);
}

try {
  formidable = require('formidable');
} catch (error) {
  formidableInitError = error;
  console.error('[upload] formidable init failed', error);
}

const { verifyToken } = require('./auth');

module.exports = async function handler(req, res) {
  console.log('[upload] request start', {
    method: req?.method,
    url: req?.url,
    hasAuth: Boolean(req?.headers?.authorization),
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', expectedMethod: 'POST' });
  }

  if (!cloudinary || !formidable) {
    return res.status(500).json({
      error: 'Upload dependencies failed to initialize',
      details: cloudinaryInitError?.message || formidableInitError?.message || 'Unknown initialization error',
    });
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  const missingConfig = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter((key) => !process.env[key]);
  if (missingConfig.length) {
    return res.status(500).json({ error: `Cloudinary credentials are missing: ${missingConfig.join(', ')}` });
  }

  try {
    const form = formidable({ multiples: true });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, parsedFields, parsedFiles) => {
        if (err) return reject(err);
        resolve({ fields: parsedFields, files: parsedFiles });
      });
    });

    const uploadedFiles = Array.isArray(files.photos) ? files.photos : [files.photos];
    const images = uploadedFiles.filter(Boolean);
    if (!images.length) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

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
  } catch (error) {
    console.error('[upload] catch', error);
    return res.status(500).json({ error: error.message || 'Upload failed' });
  }
};
