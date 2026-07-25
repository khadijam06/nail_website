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
  console.error('[cloudinary] init failed', error);
}

function missingCloudinaryConfig() {
  return [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ].filter((key) => !process.env[key]);
}

function getCloudinaryState() {
  return {
    cloudinary,
    initError: cloudinaryInitError,
    missingConfig: missingCloudinaryConfig(),
  };
}

module.exports = {
  getCloudinaryState,
};
