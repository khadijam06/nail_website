const GALLERY_FOLDER = 'nailit_home_gallery';
const GALLERY_TAG = 'nailit_home_gallery';
const MAX_GALLERY_IMAGES = 6;

function sanitizeText(value, max = 600) {
  return String(value || '')
    .replace(/[|=]/g, ' ')
    .trim()
    .slice(0, max);
}

function toCloudinaryContext(contextObj) {
  return Object.entries(contextObj || {})
    .map(([key, value]) => `${sanitizeText(key, 64)}=${sanitizeText(value, 500)}`)
    .filter((entry) => entry !== '=')
    .join('|');
}

function getResourceContext(resource) {
  const raw = resource?.context;
  if (!raw || typeof raw !== 'object') return {};
  if (raw.custom && typeof raw.custom === 'object') return raw.custom;
  return raw;
}

function getGallerySlot(value) {
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_GALLERY_IMAGES) {
    return MAX_GALLERY_IMAGES + 100;
  }
  return slot;
}

function toGalleryImage(resource) {
  const context = getResourceContext(resource);
  const slot = getGallerySlot(context.gallery_slot);
  return {
    id: resource.asset_id || '',
    publicId: resource.public_id,
    url: resource.secure_url,
    alt: sanitizeText(context.gallery_alt || context.alt || '', 160),
    slot,
    createdAt: resource.created_at || null,
  };
}

async function listGalleryResources(cloudinary) {
  const result = await cloudinary.search
    .expression(`folder:${GALLERY_FOLDER} AND resource_type:image`)
    .max_results(120)
    .with_field('context')
    .with_field('tags')
    .sort_by('created_at', 'desc')
    .execute();

  return result.resources || [];
}

async function listGalleryImages(cloudinary) {
  const resources = await listGalleryResources(cloudinary);

  const images = resources
    .map(toGalleryImage)
    .sort((a, b) => {
      if (a.slot !== b.slot) return a.slot - b.slot;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

  const seenPublicIds = new Set();
  const deduped = [];
  images.forEach((img) => {
    if (!img.publicId || seenPublicIds.has(img.publicId)) return;
    seenPublicIds.add(img.publicId);
    deduped.push(img);
  });

  return deduped.slice(0, MAX_GALLERY_IMAGES);
}

function buildGallerySlots(images) {
  const slots = Array.from({ length: MAX_GALLERY_IMAGES }, (_, slot) => ({
    slot,
    image: null,
  }));

  images.forEach((image, index) => {
    const target = Number.isInteger(image.slot) && image.slot >= 0 && image.slot < MAX_GALLERY_IMAGES
      ? image.slot
      : index;

    if (!slots[target].image) {
      slots[target].image = image;
      return;
    }

    const fallback = slots.find((slotItem) => !slotItem.image);
    if (fallback) fallback.image = image;
  });

  return slots;
}

function ensureValidSlot(slotValue) {
  const slot = Number(slotValue);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_GALLERY_IMAGES) {
    const error = new Error('Slot must be an integer between 0 and 5');
    error.code = 'VALIDATION_ERROR';
    error.details = { field: 'slot' };
    throw error;
  }
  return slot;
}

async function uploadGalleryImage(cloudinary, filePath, slot, alt) {
  return cloudinary.uploader.upload(filePath, {
    folder: GALLERY_FOLDER,
    resource_type: 'image',
    tags: [GALLERY_TAG, 'asset_state:gallery'],
    context: toCloudinaryContext({
      gallery_slot: String(slot),
      gallery_alt: sanitizeText(alt, 160),
      asset_state: 'gallery',
    }),
    transformation: [
      { width: 1600, crop: 'limit' },
      { quality: 'auto' },
      { fetch_format: 'auto' },
    ],
  });
}

async function uploadGalleryImages(cloudinary, files, existingImages) {
  if (!Array.isArray(files) || !files.length) {
    const error = new Error('At least one gallery image file is required');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const availableSlots = [];
  const taken = new Set(existingImages.map((img) => img.slot).filter((slot) => slot >= 0 && slot < MAX_GALLERY_IMAGES));
  for (let i = 0; i < MAX_GALLERY_IMAGES; i += 1) {
    if (!taken.has(i)) availableSlots.push(i);
  }

  if (files.length > availableSlots.length) {
    const error = new Error('Gallery can contain at most 6 images');
    error.code = 'VALIDATION_ERROR';
    error.details = { availableSlots: availableSlots.length, requestedFiles: files.length };
    throw error;
  }

  const uploads = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!file?.filepath) {
      const error = new Error('Uploaded gallery file is missing a temporary filepath');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    const uploaded = await uploadGalleryImage(cloudinary, file.filepath, availableSlots[i], '');
    uploads.push(uploaded);
  }

  return uploads;
}

async function replaceGalleryImage(cloudinary, { file, slot, alt }, existingImages) {
  if (!file?.filepath) {
    const error = new Error('Replacement file is required');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const validSlot = ensureValidSlot(slot);

  const previous = existingImages.find((img) => img.slot === validSlot) || null;
  const uploaded = await uploadGalleryImage(cloudinary, file.filepath, validSlot, alt || previous?.alt || '');

  if (previous?.publicId) {
    try {
      await cloudinary.uploader.destroy(previous.publicId, { resource_type: 'image' });
    } catch (error) {
      const wrapped = new Error('Replacement uploaded but failed to remove previous image');
      wrapped.code = 'PARTIAL_DELETE_FAILURE';
      wrapped.details = {
        previousPublicId: previous.publicId,
        reason: error?.message || 'Delete failed',
      };
      throw wrapped;
    }
  }

  return uploaded;
}

async function deleteGalleryImage(cloudinary, publicId, existingImages) {
  const cleanPublicId = sanitizeText(publicId, 255);
  if (!cleanPublicId) {
    const error = new Error('publicId is required');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const found = existingImages.find((img) => img.publicId === cleanPublicId);
  if (!found) {
    const error = new Error('Gallery image not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const result = await cloudinary.uploader.destroy(cleanPublicId, { resource_type: 'image' });
  return result.result === 'ok' || result.result === 'not found';
}

async function saveGalleryItems(cloudinary, items, existingImages) {
  if (!Array.isArray(items)) {
    const error = new Error('items must be an array');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (items.length > MAX_GALLERY_IMAGES) {
    const error = new Error('Gallery can contain at most 6 images');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const validPublicIds = new Set(existingImages.map((img) => img.publicId));
  const usedSlots = new Set();

  for (const item of items) {
    const cleanPublicId = sanitizeText(item?.publicId, 255);
    if (!cleanPublicId || !validPublicIds.has(cleanPublicId)) {
      const error = new Error('One or more gallery images are invalid');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    const slot = ensureValidSlot(item.slot);
    if (usedSlots.has(slot)) {
      const error = new Error('Each gallery slot must be unique');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    usedSlots.add(slot);
  }

  for (const item of items) {
    const cleanPublicId = sanitizeText(item.publicId, 255);
    const slot = ensureValidSlot(item.slot);
    const alt = sanitizeText(item.alt, 160);

    await cloudinary.api.update(cleanPublicId, {
      resource_type: 'image',
      type: 'upload',
      tags: [GALLERY_TAG, 'asset_state:gallery'],
      context: toCloudinaryContext({
        gallery_slot: String(slot),
        gallery_alt: alt,
        asset_state: 'gallery',
      }),
    });
  }
}

module.exports = {
  GALLERY_FOLDER,
  GALLERY_TAG,
  MAX_GALLERY_IMAGES,
  listGalleryImages,
  buildGallerySlots,
  uploadGalleryImages,
  replaceGalleryImage,
  deleteGalleryImage,
  saveGalleryItems,
  ensureValidSlot,
  sanitizeText,
};
