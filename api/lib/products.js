const crypto = require('crypto');

const FOLDER = 'nailit_gallery';
const VALID_CATEGORIES = ['Chrome', 'French Tips', 'Cateye', '3D Art'];

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

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}

function normalizeCategory(category) {
  const clean = sanitizeText(category, 64);
  const found = VALID_CATEGORIES.find((name) => name.toLowerCase() === clean.toLowerCase());
  return found || clean;
}

function normalizeStatus(status) {
  return String(status || '').toLowerCase() === 'draft' ? 'draft' : 'published';
}

function normalizeImageAsset(asset, index) {
  if (!asset || typeof asset !== 'object') return null;
  const publicId = sanitizeText(asset.publicId || asset.public_id, 255);
  const url = sanitizeText(asset.url || asset.secure_url, 2000);
  if (!publicId || !url) return null;
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
  const shortDescription = sanitizeText(input.shortDescription || input.description || fallback.shortDescription || fallback.description, 500);
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
    id: sanitizeText(input.id || fallback.id, 96),
    title,
    category,
    price,
    shortDescription,
    fullDescription,
    status,
    isCategoryCover,
    images,
    mainImagePublicId: mainImage ? mainImage.publicId : '',
    createdAt: sanitizeText(fallback.createdAt || input.createdAt || nowIso(), 64),
    updatedAt: nowIso(),
  };
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
  };
}

function mergeResourceToImage(resource) {
  return {
    publicId: resource.public_id,
    id: resource.asset_id,
    url: resource.secure_url,
    order: Number(resource.context?.custom?.product_image_order || 0),
    isMain: resource.context?.custom?.product_is_main === '1',
  };
}

function productFromResources(productId, resources) {
  const images = resources
    .map(mergeResourceToImage)
    .sort((a, b) => a.order - b.order)
    .map((img, index) => ({ ...img, order: index }));

  const mainImage = images.find((img) => img.isMain) || images[0] || null;
  const source = mainImage ? resources.find((r) => r.public_id === mainImage.publicId) : resources[0];
  const custom = source?.context?.custom || {};

  return {
    id: productId,
    title: custom.product_title || source?.display_name || 'Untitled Nail Set',
    category: custom.product_category || 'Gallery',
    price: custom.product_price || '',
    shortDescription: custom.product_short_description || '',
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
    .sort_by('created_at', 'desc')
    .execute();
  return result.resources || [];
}

async function listProducts(cloudinary) {
  const resources = await listProductResources(cloudinary);
  const grouped = new Map();

  resources.forEach((resource) => {
    const custom = resource.context?.custom || {};
    const productId = sanitizeText(custom.product_id, 96) || `legacy-${resource.public_id}`;
    if (!grouped.has(productId)) grouped.set(productId, []);
    grouped.get(productId).push(resource);
  });

  return Array.from(grouped.entries()).map(([id, group]) => productFromResources(id, group));
}

async function findProductById(cloudinary, id) {
  const products = await listProducts(cloudinary);
  return products.find((product) => product.id === id) || null;
}

async function applyProductContextToImages(cloudinary, product) {
  const contextUpdates = product.images.map(async (image, index) => {
    await cloudinary.uploader.explicit(image.publicId, {
      type: 'upload',
      context: contextForImage(product, image, index),
      tags: [
        'nailit_product',
        `product:${product.id}`,
        `category:${slug(product.category)}`,
        `status:${product.status}`,
        product.isCategoryCover ? `cover:${slug(product.category)}` : '',
      ].filter(Boolean),
    });
  });

  await Promise.all(contextUpdates);
}

async function clearCoverForCategory(cloudinary, category, exceptProductId) {
  const products = await listProducts(cloudinary);
  const targets = products.filter((product) => product.category === category && product.isCategoryCover && product.id !== exceptProductId);

  await Promise.all(targets.map(async (target) => {
    const updated = {
      ...target,
      isCategoryCover: false,
      updatedAt: nowIso(),
    };
    await applyProductContextToImages(cloudinary, updated);
  }));
}

async function createProduct(cloudinary, payload) {
  const normalized = normalizeProductInput(payload, {
    id: payload.id || `${slug(payload.category || 'set')}-${uid()}`,
    createdAt: nowIso(),
  });

  if (!normalized.title) throw new Error('Title is required');
  if (!normalized.category) throw new Error('Category is required');
  if (!normalized.mainImagePublicId) throw new Error('Main image is required');

  if (normalized.isCategoryCover) {
    await clearCoverForCategory(cloudinary, normalized.category, normalized.id);
  }

  await applyProductContextToImages(cloudinary, normalized);
  return normalized;
}

async function updateProduct(cloudinary, payload) {
  if (!payload?.id) throw new Error('Product id is required');
  const existing = await findProductById(cloudinary, payload.id);
  if (!existing) throw new Error('Product not found');

  const normalized = normalizeProductInput(payload, existing);
  normalized.id = existing.id;
  normalized.createdAt = existing.createdAt;

  const removedImages = (payload.removeImagePublicIds || [])
    .map((value) => sanitizeText(value, 255))
    .filter(Boolean);

  if (removedImages.length) {
    await Promise.all(removedImages.map((publicId) => cloudinary.uploader.destroy(publicId, { resource_type: 'image' })));
    normalized.images = normalized.images.filter((img) => !removedImages.includes(img.publicId));
  }

  if (!normalized.images.length) {
    throw new Error('At least one image is required');
  }

  if (!normalized.images.some((img) => img.publicId === normalized.mainImagePublicId)) {
    normalized.mainImagePublicId = normalized.images[0].publicId;
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
  const product = await findProductById(cloudinary, payload.id);
  if (!product) return false;

  await Promise.all(
    product.images.map((image) => cloudinary.uploader.destroy(image.publicId, { resource_type: 'image' })),
  );

  return true;
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
  listProducts,
  findProductById,
  createProduct,
  updateProduct,
  duplicateProduct,
  deleteProduct,
  toPublicProduct,
  sortProducts,
  filterProducts,
};
