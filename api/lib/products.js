const crypto = require('crypto');

const FOLDER = 'nailit_gallery';
const VALID_CATEGORIES = ['Chrome', 'French Tips', 'Cateye', '3D Art'];
const VALID_STATUSES = ['draft', 'published'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,95}$/;
const PUBLIC_ID_PATTERN = /^[a-zA-Z0-9_\-./]{3,255}$/;

function nowIso() {
  return new Date().toISOString();
}

function slug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

function sanitizeText(value, max = 4000) {
  return String(value || '').replace(/\|/g, ' ').trim().slice(0, max);
}

function sanitizeContextValue(value) {
  return String(value || '')
    .replace(/[|=]/g, ' ')
    .trim();
}

function toCloudinaryContext(contextObj) {
  return Object.entries(contextObj || {})
    .map(([key, value]) => [sanitizeText(key, 64), sanitizeContextValue(value)])
    .filter(([key, value]) => key && value)
    .map(([key, value]) => `${key}=${value}`)
    .join('|');
}

function getResourceContext(resource) {
  const raw = resource?.context;
  if (!raw || typeof raw !== 'object') return {};

  if (raw.custom && typeof raw.custom === 'object') {
    return raw.custom;
  }

  return raw;
}

async function setImageMetadata(cloudinary, publicId, contextObj, tags) {
  const context = toCloudinaryContext(contextObj);
  const cleanTags = Array.isArray(tags)
    ? tags.map((tag) => sanitizeText(tag, 120)).filter(Boolean)
    : [];

  await cloudinary.api.update(publicId, {
    type: 'upload',
    resource_type: 'image',
    context: context || undefined,
    tags: cleanTags,
  });
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}

function normalizeCategory(category) {
  const clean = sanitizeText(category, 64);
  const found = VALID_CATEGORIES.find((name) => name.toLowerCase() === clean.toLowerCase());
  return found || '';
}

function normalizeStatus(status) {
  const clean = String(status || '').toLowerCase();
  return VALID_STATUSES.includes(clean) ? clean : 'published';
}

function sanitizeId(value) {
  return sanitizeText(value, 96).toLowerCase();
}

function isValidProductId(id) {
  return ID_PATTERN.test(id);
}

function isValidPublicId(value) {
  return PUBLIC_ID_PATTERN.test(String(value || ''));
}

function normalizeImageAsset(asset, index) {
  if (!asset || typeof asset !== 'object') return null;

  const publicId = sanitizeText(asset.publicId || asset.public_id, 255);
  const url = sanitizeText(asset.url || asset.secure_url, 2000);
  if (!publicId || !url || !isValidPublicId(publicId)) return null;

  return {
    publicId,
    url,
    order: Number.isFinite(Number(asset.order)) ? Number(asset.order) : index,
    id: sanitizeText(asset.id || '', 128),
  };
}

function normalizeProductInput(input = {}, fallback = {}) {
  const title = sanitizeText(input.title || fallback.title, 120);
  const category = normalizeCategory(input.category || fallback.category || '');
  const shortDescription = sanitizeText(
    input.shortDescription || input.description || fallback.shortDescription || fallback.description,
    500,
  );
  const fullDescription = sanitizeText(input.fullDescription || fallback.fullDescription, 5000);
  const price = sanitizeText(input.price || fallback.price, 64);
  const status = normalizeStatus(input.status || fallback.status);
  const isCategoryCover = toBool(input.isCategoryCover ?? fallback.isCategoryCover);

  const imagesRaw = Array.isArray(input.images) ? input.images : fallback.images || [];
  const images = imagesRaw
    .map((img, index) => normalizeImageAsset(img, index))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((img, index) => ({ ...img, order: index }));

  const mainImagePublicIdInput = sanitizeText(input.mainImagePublicId || fallback.mainImagePublicId, 255);
  const mainImage = images.find((img) => img.publicId === mainImagePublicIdInput) || images[0] || null;

  return {
    id: sanitizeId(input.id || fallback.id),
    title,
    category,
    price,
    shortDescription,
    fullDescription,
    status,
    isCategoryCover: status === 'draft' ? false : isCategoryCover,
    images,
    mainImagePublicId: mainImage ? mainImage.publicId : '',
    createdAt: sanitizeText(fallback.createdAt || input.createdAt || nowIso(), 64),
    updatedAt: nowIso(),
  };
}

function validateProductInput(product, { forUpdate = false } = {}) {
  const errors = [];

  if (forUpdate) {
    if (!product.id) {
      errors.push('Product id is required');
    } else if (!isValidProductId(product.id)) {
      errors.push('Product id format is invalid');
    }
  }

  if (!product.title) errors.push('Title is required');
  if (product.title.length > 120) errors.push('Title is too long');

  if (!product.category) {
    errors.push('Category is required and must be one of Chrome, French Tips, Cateye, or 3D Art');
  }

  if (!VALID_STATUSES.includes(product.status)) {
    errors.push('Status must be either draft or published');
  }

  if (!Array.isArray(product.images) || product.images.length === 0) {
    errors.push('At least one image is required');
  }

  product.images.forEach((img, index) => {
    if (!img.publicId || !isValidPublicId(img.publicId)) {
      errors.push(`Image ${index + 1} has an invalid publicId`);
    }
    if (!img.url || img.url.length > 2000) {
      errors.push(`Image ${index + 1} has an invalid URL`);
    }
  });

  if (product.mainImagePublicId && !product.images.some((img) => img.publicId === product.mainImagePublicId)) {
    errors.push('mainImagePublicId must reference one of the product images');
  }

  if (product.price.length > 64) errors.push('Price is too long');
  if (product.shortDescription.length > 500) errors.push('Short description is too long');
  if (product.fullDescription.length > 5000) errors.push('Full description is too long');

  if (product.status === 'draft' && product.isCategoryCover) {
    errors.push('Draft products cannot be category covers');
  }

  return errors;
}

function contextForImage(product, image, index) {
  return {
    product_id: product.id,
    product_title: product.title,
    product_category: product.category,
    product_price: product.price,
    product_short_description: product.shortDescription,
    product_full_description: product.fullDescription,
    product_status: product.status,
    product_is_cover: product.isCategoryCover ? '1' : '0',
    product_created_at: product.createdAt,
    product_updated_at: product.updatedAt,
    product_image_order: String(index),
    product_is_main: image.publicId === product.mainImagePublicId ? '1' : '0',
    asset_state: 'assigned',
  };
}

function mergeResourceToImage(resource) {
  const context = getResourceContext(resource);
  return {
    publicId: resource.public_id,
    id: resource.asset_id,
    url: resource.secure_url,
    order: Number(context.product_image_order || 0),
    isMain: context.product_is_main === '1',
  };
}

function getResourceProductId(resource) {
  const custom = getResourceContext(resource);
  const fromContext = sanitizeId(custom.product_id || '');
  if (fromContext && isValidProductId(fromContext)) {
    return fromContext;
  }

  const hasLegacyDetails = Boolean(custom.title || custom.category || custom.price || custom.description);
  if (hasLegacyDetails) {
    return `legacy-${sanitizeText(resource.public_id, 80).replace(/[^a-zA-Z0-9-]/g, '-')}`.toLowerCase();
  }

  return '';
}

function productFromResources(productId, resources) {
  const images = resources
    .map(mergeResourceToImage)
    .sort((a, b) => a.order - b.order)
    .map((img, index) => ({ ...img, order: index }));

  const mainImage = images.find((img) => img.isMain) || images[0] || null;
  const source = mainImage ? resources.find((r) => r.public_id === mainImage.publicId) : resources[0];
  const custom = getResourceContext(source);

  return {
    id: productId,
    title: custom.product_title || custom.title || source?.display_name || 'Untitled Nail Set',
    category: normalizeCategory(custom.product_category || custom.category || '') || 'Chrome',
    price: custom.product_price || custom.price || '',
    shortDescription: custom.product_short_description || custom.description || '',
    fullDescription: custom.product_full_description || '',
    status: normalizeStatus(custom.product_status || 'published'),
    isCategoryCover: custom.product_is_cover === '1',
    createdAt: custom.product_created_at || source?.created_at || nowIso(),
    updatedAt: custom.product_updated_at || source?.created_at || nowIso(),
    mainImagePublicId: mainImage?.publicId || '',
    mainImageUrl: mainImage?.url || '',
    images,
  };
}

async function listProductResources(cloudinary) {
  const result = await cloudinary.search
    .expression(`folder:${FOLDER} AND resource_type:image`)
    .max_results(500)
    .with_field('context')
    .with_field('tags')
    .sort_by('created_at', 'desc')
    .execute();
  return result.resources || [];
}

async function listProducts(cloudinary) {
  const resources = await listProductResources(cloudinary);
  const grouped = new Map();

  resources.forEach((resource) => {
    const productId = getResourceProductId(resource);
    if (!productId) return;

    if (!grouped.has(productId)) grouped.set(productId, []);
    grouped.get(productId).push(resource);
  });

  return Array.from(grouped.entries()).map(([id, group]) => productFromResources(id, group));
}

async function listUnassignedAssets(cloudinary) {
  const resources = await listProductResources(cloudinary);

  return resources
    .filter((resource) => {
      const productId = getResourceProductId(resource);
      return !productId;
    })
    .map((resource) => ({
      id: resource.asset_id,
      publicId: resource.public_id,
      url: resource.secure_url,
      createdAt: resource.created_at,
      bytes: resource.bytes || 0,
      width: resource.width || null,
      height: resource.height || null,
    }));
}

async function findProductById(cloudinary, id) {
  const normalizedId = sanitizeId(id);
  const products = await listProducts(cloudinary);
  return products.find((product) => product.id === normalizedId) || null;
}

async function getAssetState(cloudinary, publicId) {
  const resource = await cloudinary.api.resource(publicId, {
    resource_type: 'image',
    context: true,
    tags: true,
  });

  return {
    context: getResourceContext(resource),
    tags: Array.isArray(resource.tags) ? resource.tags : [],
  };
}

function toPartialMetadataError(message, details) {
  const error = new Error(message);
  error.code = 'PARTIAL_METADATA_UPDATE';
  error.details = details;
  return error;
}

async function rollbackImageStates(cloudinary, snapshots, publicIds) {
  const failures = [];

  for (const publicId of publicIds) {
    const state = snapshots.get(publicId);
    if (!state) continue;

    try {
      await setImageMetadata(cloudinary, publicId, state.context, state.tags);
    } catch (error) {
      failures.push({ publicId, error: error?.message || 'Rollback failed' });
    }
  }

  return failures;
}

async function applyProductContextToImages(cloudinary, product) {
  const snapshots = new Map();
  const updated = [];

  for (const image of product.images) {
    snapshots.set(image.publicId, await getAssetState(cloudinary, image.publicId));
  }

  for (let index = 0; index < product.images.length; index += 1) {
    const image = product.images[index];

    try {
      await setImageMetadata(
        cloudinary,
        image.publicId,
        contextForImage(product, image, index),
        [
          'nailit_product',
          `product:${product.id}`,
          `category:${slug(product.category)}`,
          `status:${product.status}`,
          product.isCategoryCover ? `cover:${slug(product.category)}` : '',
        ],
      );

      const persisted = await getAssetState(cloudinary, image.publicId);
      const persistedProductId = sanitizeId(persisted.context?.product_id || '');
      if (persistedProductId !== product.id) {
        throw new Error('Metadata update did not persist product assignment');
      }

      updated.push(image.publicId);
    } catch (error) {
      const rollbackFailures = await rollbackImageStates(cloudinary, snapshots, updated);
      throw toPartialMetadataError(
        'Failed to update metadata for all product images. Applied changes were rolled back.',
        {
          failedImagePublicId: image.publicId,
          updatedImagePublicIds: updated,
          rollbackFailures,
          reason: error?.message || 'Unknown metadata update error',
        },
      );
    }
  }
}

async function clearCoverForCategory(cloudinary, category, exceptProductId) {
  const products = await listProducts(cloudinary);
  const targets = products.filter(
    (product) =>
      product.category === category &&
      product.isCategoryCover &&
      product.id !== exceptProductId &&
      product.status === 'published',
  );

  for (const target of targets) {
    const updated = {
      ...target,
      isCategoryCover: false,
      updatedAt: nowIso(),
    };
    await applyProductContextToImages(cloudinary, updated);
  }
}

function ensureRemoveIdsBelongToProduct(existingProduct, removeIds) {
  const existingIds = new Set(existingProduct.images.map((img) => img.publicId));
  const invalid = removeIds.filter((publicId) => !existingIds.has(publicId));

  if (invalid.length) {
    const error = new Error('One or more images marked for deletion do not belong to this product');
    error.code = 'INVALID_REMOVE_IMAGES';
    error.details = { invalidPublicIds: invalid };
    throw error;
  }
}

function ensureNoImplicitImageDrop(existingProduct, normalizedProduct, removeIds) {
  const existingIds = new Set(existingProduct.images.map((img) => img.publicId));
  const nextIds = new Set(normalizedProduct.images.map((img) => img.publicId));
  const removedSet = new Set(removeIds);

  const missing = [];
  existingIds.forEach((publicId) => {
    if (!nextIds.has(publicId) && !removedSet.has(publicId)) {
      missing.push(publicId);
    }
  });

  if (missing.length) {
    const error = new Error('Update payload is missing existing product images. Explicitly remove images before saving.');
    error.code = 'MISSING_EXISTING_IMAGES';
    error.details = { missingPublicIds: missing };
    throw error;
  }
}

async function createProduct(cloudinary, payload) {
  const generatedId = payload.id || `${slug(payload.category || 'set')}-${uid()}`;
  const normalized = normalizeProductInput(payload, {
    id: sanitizeId(generatedId),
    createdAt: nowIso(),
  });

  if (!normalized.id || !isValidProductId(normalized.id)) {
    throw new Error('Generated product ID is invalid');
  }

  const validationErrors = validateProductInput(normalized, { forUpdate: false });
  if (validationErrors.length) {
    const error = new Error(validationErrors.join('; '));
    error.code = 'VALIDATION_ERROR';
    error.details = { validationErrors };
    throw error;
  }

  if (normalized.isCategoryCover) {
    await clearCoverForCategory(cloudinary, normalized.category, normalized.id);
  }

  await applyProductContextToImages(cloudinary, normalized);
  return normalized;
}

async function updateProduct(cloudinary, payload) {
  if (!payload?.id) throw new Error('Product id is required');
  const id = sanitizeId(payload.id);
  if (!isValidProductId(id)) {
    throw new Error('Product id format is invalid');
  }

  const existing = await findProductById(cloudinary, id);
  if (!existing) throw new Error('Product not found');

  const normalized = normalizeProductInput(payload, existing);
  normalized.id = existing.id;
  normalized.createdAt = existing.createdAt;

  const removedImages = (payload.removeImagePublicIds || [])
    .map((value) => sanitizeText(value, 255))
    .filter((value) => value && isValidPublicId(value));

  ensureRemoveIdsBelongToProduct(existing, removedImages);
  ensureNoImplicitImageDrop(existing, normalized, removedImages);

  if (removedImages.length) {
    await Promise.all(
      removedImages.map((publicId) =>
        cloudinary.uploader.destroy(publicId, { resource_type: 'image' }),
      ),
    );
    normalized.images = normalized.images.filter((img) => !removedImages.includes(img.publicId));
  }

  if (!normalized.images.length) {
    throw new Error('At least one image is required');
  }

  if (!normalized.images.some((img) => img.publicId === normalized.mainImagePublicId)) {
    normalized.mainImagePublicId = normalized.images[0].publicId;
  }

  const validationErrors = validateProductInput(normalized, { forUpdate: true });
  if (validationErrors.length) {
    const error = new Error(validationErrors.join('; '));
    error.code = 'VALIDATION_ERROR';
    error.details = { validationErrors };
    throw error;
  }

  if (normalized.isCategoryCover) {
    await clearCoverForCategory(cloudinary, normalized.category, normalized.id);
  }

  await applyProductContextToImages(cloudinary, normalized);
  return normalized;
}

async function duplicateProduct(cloudinary, payload) {
  if (!payload?.id) throw new Error('Product id is required');
  const source = await findProductById(cloudinary, payload.id);
  if (!source) throw new Error('Product not found');

  const uploaded = [];
  for (const image of source.images) {
    const copy = await cloudinary.uploader.upload(image.url, {
      folder: FOLDER,
      resource_type: 'image',
      tags: ['nailit_unassigned'],
      context: 'asset_state=unassigned',
    });
    uploaded.push({
      publicId: copy.public_id,
      url: copy.secure_url,
      id: copy.asset_id,
      order: image.order,
    });
  }

  const duplicate = await createProduct(cloudinary, {
    title: `${source.title} Copy`,
    category: source.category,
    price: source.price,
    shortDescription: source.shortDescription,
    fullDescription: source.fullDescription,
    status: 'draft',
    isCategoryCover: false,
    images: uploaded,
    mainImagePublicId: uploaded[0]?.publicId,
  });

  return duplicate;
}

async function deleteProduct(cloudinary, payload) {
  if (!payload?.id) throw new Error('Product id is required');
  const id = sanitizeId(payload.id);
  if (!isValidProductId(id)) {
    throw new Error('Product id format is invalid');
  }

  const product = await findProductById(cloudinary, id);
  if (!product) return false;

  const failures = [];

  for (const image of product.images) {
    try {
      const resource = await cloudinary.api.resource(image.publicId, {
        resource_type: 'image',
        context: true,
      });
      const ownerId = sanitizeId(getResourceContext(resource).product_id || '');
      if (ownerId !== id) {
        failures.push({ publicId: image.publicId, reason: 'Image ownership mismatch' });
        continue;
      }

      await cloudinary.uploader.destroy(image.publicId, { resource_type: 'image' });
    } catch (error) {
      failures.push({ publicId: image.publicId, reason: error?.message || 'Delete failed' });
    }
  }

  if (failures.length) {
    const error = new Error('Failed to delete all product images');
    error.code = 'PARTIAL_DELETE_FAILURE';
    error.details = { failures };
    throw error;
  }

  return true;
}

async function deleteUnassignedAsset(cloudinary, publicId) {
  const cleanPublicId = sanitizeText(publicId, 255);
  if (!cleanPublicId || !isValidPublicId(cleanPublicId)) {
    throw new Error('Invalid publicId');
  }

  const resource = await cloudinary.api.resource(cleanPublicId, {
    resource_type: 'image',
    context: true,
  });

  const ownerId = getResourceProductId(resource);
  if (ownerId) {
    throw new Error('Asset is assigned to a product and cannot be deleted as unassigned');
  }

  const result = await cloudinary.uploader.destroy(cleanPublicId, { resource_type: 'image' });
  return result.result === 'ok';
}

function toPublicProduct(product) {
  return {
    id: product.id,
    title: product.title,
    category: product.category,
    price: product.price,
    shortDescription: product.shortDescription,
    fullDescription: product.fullDescription,
    mainImageUrl: product.mainImageUrl,
    images: product.images,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    isCategoryCover: product.isCategoryCover,
  };
}

function sortProducts(products, sort) {
  const copy = [...products];
  if (sort === 'oldest') {
    return copy.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
  if (sort === 'alpha') {
    return copy.sort((a, b) => a.title.localeCompare(b.title));
  }
  return copy.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function filterProducts(products, { category, status, search }) {
  return products.filter((product) => {
    if (category && category !== 'all' && product.category !== category) return false;
    if (status && status !== 'all' && product.status !== status) return false;
    if (search) {
      const needle = search.toLowerCase();
      const hay = `${product.title} ${product.shortDescription} ${product.fullDescription}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

module.exports = {
  VALID_CATEGORIES,
  VALID_STATUSES,
  isValidProductId,
  listProducts,
  listUnassignedAssets,
  findProductById,
  createProduct,
  updateProduct,
  duplicateProduct,
  deleteProduct,
  deleteUnassignedAsset,
  toPublicProduct,
  sortProducts,
  filterProducts,
};
