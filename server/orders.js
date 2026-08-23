const crypto = require('crypto');
const { IncomingForm } = require('formidable');
const nodemailer = require('nodemailer');
const { sql } = require('@vercel/postgres');

const ORDER_STATUSES = ['New', 'Reviewing', 'Confirmed', 'In Progress', 'Ready', 'Completed', 'Cancelled'];
const ORDER_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_COUNT = 8;
const MEMORY_STORE = [];

// The three photo categories the order form actually collects, and how each
// is represented across the codebase: the multipart field name the browser
// sends, the Cloudinary subfolder/label prefix, and the JS/DB field names.
// Keeping this in one table is what keeps upload/store/email/admin in sync
// instead of the categories drifting apart across those four call sites.
const IMAGE_CATEGORIES = [
  { field: 'leftHand', slug: 'left-hand', label: 'Left Hand Photo', orderKey: 'leftHandImages', column: 'left_hand_images', heading: 'Left Hand Photos' },
  { field: 'rightHand', slug: 'right-hand', label: 'Right Hand Photo', orderKey: 'rightHandImages', column: 'right_hand_images', heading: 'Right Hand Photos' },
  { field: 'inspiration', slug: 'inspiration', label: 'Inspiration Photo', orderKey: 'inspirationImages', column: 'inspiration_images', heading: 'Inspiration / Reference Photos' },
];

function hasPersistentOrderStore() {
  if (process.env.POSTGRES_URL) return true;

  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    const error = new Error('Persistent order storage is not configured. Set POSTGRES_URL before accepting production orders.');
    error.code = 'ORDER_STORAGE_CONFIGURATION_ERROR';
    throw error;
  }

  return false;
}

function sanitizeText(value, maxLength = 500) {
  const text = typeof value === 'string' ? value : (value == null ? '' : String(value));
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const limited = maxLength > 0 ? trimmed.slice(0, maxLength) : trimmed;
  return limited
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizePlainText(value, maxLength = 500) {
  const text = typeof value === 'string' ? value : (value == null ? '' : String(value));
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength || 500);
}

function safeDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function createOrderId() {
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `NIK-${random}`;
}

function firstFormValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function normaliseFields(fields = {}) {
  const normalised = {};
  Object.entries(fields).forEach(([key, value]) => {
    normalised[key] = firstFormValue(value);
  });
  return normalised;
}

// Strict per-field extraction — deliberately does NOT fall back to generic
// names like "images"/"photo" the way the old single-bucket version did,
// so a left-hand photo can never accidentally end up mixed into another
// category just because of how a field happened to be named.
function getFilesForField(files = {}, fieldName) {
  const match = files[fieldName];
  if (!match) return [];
  const list = Array.isArray(match) ? match : [match];
  return list.filter((file) => file && file.filepath);
}

function validateImageFile(file, label) {
  if (!file || !file.filepath) {
    const error = new Error(`${label} is missing from the upload.`);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const mimeType = (file.mimetype || file.type || '').toLowerCase();
  const filename = String(file.originalFilename || file.newFilename || label);
  const extMatches = /\.(jpe?g|png|webp)$/i.test(filename);

  if (!ORDER_IMAGE_MIME_TYPES.has(mimeType) && !extMatches) {
    const error = new Error('Unsupported file type. Please upload JPG, JPEG, PNG, or WEBP images only.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (Number(file.size || 0) > MAX_IMAGE_SIZE_BYTES) {
    const error = new Error('One or more uploaded images are larger than the 10MB limit. Please choose smaller images.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

async function parseOrderMultipart(req) {
  const form = new IncomingForm({
    multiples: true,
    keepExtensions: true,
    maxFiles: MAX_IMAGE_COUNT,
    maxFileSize: MAX_IMAGE_SIZE_BYTES,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ fields: normaliseFields(fields || {}), files: files || {} });
    });
  });
}

// Uploads one category's files into its own Cloudinary subfolder
// (nailit_orders/<order-id>/<category-slug>) so the category survives in
// Cloudinary too, not just in our own database.
async function uploadOrderImageGroup(cloudinary, files, orderId, category) {
  if (!cloudinary || !files.length) return [];

  const uploads = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const label = `${category.label} ${index + 1}`;
    validateImageFile(file, label);

    const uploadResult = await cloudinary.uploader.upload(file.filepath, {
      folder: `nailit_orders/${orderId}/${category.slug}`,
      resource_type: 'image',
      tags: ['customer_order', `order:${orderId}`, `category:${category.slug}`],
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      context: { order_image_label: label, order_id: orderId, order_category: category.slug },
    });

    uploads.push({
      originalName: String(file.originalFilename || file.newFilename || `image-${index + 1}`),
      publicId: uploadResult.public_id,
      url: uploadResult.secure_url,
      width: uploadResult.width,
      height: uploadResult.height,
      label,
    });
  }

  return uploads;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emailImageSection(heading, images) {
  if (!images.length) return '';

  const imageMarkup = images.map((image) => `
    <div style="margin-bottom:18px;">
      <p style="margin:0 0 8px;font-weight:700;color:#5d2d49;">${escapeHtml(image.label)}</p>
      <a href="${escapeHtml(image.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;max-width:100%;margin-bottom:10px;">
        <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.label)}" style="max-width:220px;max-height:220px;border-radius:12px;border:1px solid #f1d9e7;background:#fff;display:block;" />
      </a>
      <div style="font-size:12px;color:#7d5b7b;">
        <a href="${escapeHtml(image.url)}" target="_blank" rel="noopener noreferrer" style="color:#b30f65;">Open image</a>
      </div>
    </div>
  `).join('');

  return `
    <div style="margin-top:20px;">
      <p style="margin:0 0 12px;font-weight:700;color:#5d2d49;">${escapeHtml(heading)}</p>
      ${imageMarkup}
    </div>
  `;
}

function buildEmailHtml(order, imageGroups) {
  const rows = [
    ['Order ID', order.orderId],
    ['Customer name', order.customerName],
    ['Email', order.email],
    ['Phone', order.phone],
    ['Delivery', order.delivery],
    ['Submission time', new Date(order.submittedAt).toLocaleString()],
    ['Design / category', order.design || '—'],
    ['Shape', order.shape || '—'],
    ['Length', order.length || '—'],
    ['Notes', order.notes || '—'],
  ].map(([label, value]) => `
    <tr>
      <td style="padding:10px 12px;border:1px solid #f1d9e7;vertical-align:top;font-weight:700;color:#5d2d49;">${escapeHtml(label)}</td>
      <td style="padding:10px 12px;border:1px solid #f1d9e7;vertical-align:top;color:#3b1b35;">${escapeHtml(value || '—')}</td>
    </tr>
  `).join('');

  const imageSections = IMAGE_CATEGORIES
    .map((category) => emailImageSection(category.heading, imageGroups[category.orderKey] || []))
    .join('');

  const hasAnyImages = IMAGE_CATEGORIES.some((category) => (imageGroups[category.orderKey] || []).length);

  return `
    <div style="font-family:Arial,sans-serif;color:#3b1b35;line-height:1.6;max-width:760px;margin:0 auto;">
      <div style="background:linear-gradient(168deg,#CBA6D9,#E58FC9,#FF5AA6,#F5279A);padding:20px 24px;border-radius:18px 18px 0 0;">
        <h2 style="margin:0;color:#fff;font-size:28px;">New Nail Order Request</h2>
      </div>
      <div style="background:#fff;border:1px solid #f1d9e7;border-top:none;border-radius:0 0 18px 18px;padding:24px;">
        <p style="margin:0 0 18px;color:#7d5b7b;">A customer submitted a new order. The same order is available in the admin dashboard: <strong>/admin → Orders</strong>.</p>
        <table style="width:100%;border-collapse:collapse;border-spacing:0;">
          ${rows}
        </table>

        ${hasAnyImages ? imageSections : '<p style="margin:20px 0 0;color:#7d5b7b;">No photos were uploaded with this order.</p>'}
      </div>
    </div>
  `;
}

function buildPlainText(order, imageGroups) {
  const lines = [
    `Order ID: ${order.orderId}`,
    `Customer name: ${order.customerName}`,
    `Email: ${order.email}`,
    `Phone: ${order.phone}`,
    `Delivery: ${order.delivery}`,
    `Submission time: ${new Date(order.submittedAt).toLocaleString()}`,
    `Design / category: ${order.design || '—'}`,
    `Shape: ${order.shape || '—'}`,
    `Length: ${order.length || '—'}`,
    `Notes: ${order.notes || '—'}`,
  ];

  const hasAnyImages = IMAGE_CATEGORIES.some((category) => (imageGroups[category.orderKey] || []).length);

  if (!hasAnyImages) {
    lines.push('', 'No photos were uploaded with this order.');
  } else {
    IMAGE_CATEGORIES.forEach((category) => {
      const images = imageGroups[category.orderKey] || [];
      if (!images.length) return;
      lines.push('', `${category.heading}:`);
      images.forEach((image, index) => {
        lines.push(`${index + 1}. ${image.label}: ${image.url}`);
      });
    });
  }

  lines.push('', 'Admin dashboard: /admin → Orders');
  return lines.join('\n');
}

// Google displays App Passwords in 4-character groups for readability
// ("abcd efgh ijkl mnop"); pasted verbatim into an env var, those spaces
// become part of the literal password nodemailer sends, and Gmail rejects
// it. App Passwords are always exactly 16 characters with no separators, so
// stripping all whitespace is always safe, never ambiguous.
function normalizeAppPassword(value) {
  return String(value || '').replace(/\s+/g, '');
}

// Opt-in, default off: order confirmation email is a nice-to-have, not part
// of the order system itself, and leaving it on by default while Gmail
// delivery isn't configured correctly just fills the logs with repeated
// auth failures on every submission. Set ORDER_EMAIL_NOTIFICATIONS=true in
// Vercel to turn it back on once Gmail is sorted out — no code change needed.
function isOrderEmailNotificationsEnabled() {
  return process.env.ORDER_EMAIL_NOTIFICATIONS === 'true';
}

function sendOrderEmailConfig() {
  // No hardcoded literal fallback for user/to: silently substituting a
  // different address when the real env var isn't visible (e.g. only
  // scoped to Production, not Preview, in Vercel) would attempt to log in
  // as the WRONG account while still using a real EMAIL_PASS — that's a
  // guaranteed, hard-to-diagnose auth failure. Missing config should throw
  // loudly instead of silently mismatching.
  const to = (process.env.EMAIL_TO || process.env.ADMIN_EMAIL || '').trim();
  const user = (process.env.EMAIL_USER || process.env.GMAIL_USER || '').trim();
  const pass = normalizeAppPassword(process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD);

  return { to, user, pass };
}

async function sendOrderEmail(order, imageGroups) {
  const { to, user, pass } = sendOrderEmailConfig();

  // Safe by design: booleans only, never the values themselves or their length.
  console.log('[orders] email env check', {
    hasEmailUser: Boolean(user),
    hasEmailPass: Boolean(pass),
    hasEmailTo: Boolean(to),
  });

  if (!user || !pass || !to) {
    const missing = [!user && 'EMAIL_USER', !pass && 'EMAIL_PASS', !to && 'EMAIL_TO'].filter(Boolean).join(', ');
    const error = new Error(`Email delivery is not configured. Missing or empty: ${missing}.`);
    error.code = 'EMAIL_CONFIGURATION_ERROR';
    throw error;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || `Nail It By K <${user}>`,
    to,
    subject: `New Nail Order Request - ${order.orderId}`,
    text: buildPlainText(order, imageGroups),
    html: buildEmailHtml(order, imageGroups),
  });

  return info;
}

function toImageArray(value) {
  return Array.isArray(value) ? value : [];
}

// Reads each category from wherever it lives: a dedicated Postgres column
// (left_hand_images, ...) if present, else the mirrored copy inside the
// `data` JSONB blob (used for the in-memory fallback store, and as a
// belt-and-suspenders copy alongside the dedicated columns). If NONE of the
// three categories have anything AND the order still only has the old
// pre-migration `images` array, that array is surfaced separately as
// `legacyImages` — never guessed into left/right/inspiration.
function mapPersistedOrder(record) {
  const data = record?.data || {};
  const form = data.form || {};
  const customerName = sanitizePlainText(record?.customer_name || form.name || form.customerName || 'Unknown customer', 160);
  const email = sanitizePlainText(record?.email || form.email || '', 160);
  const phone = sanitizePlainText(record?.phone || form.phone || '', 120);
  const delivery = sanitizePlainText(record?.delivery || form.delivery || '', 120);
  const notes = sanitizePlainText(record?.notes || form.notes || form.specialRequests || '', 2000);
  const design = sanitizePlainText(record?.design || form.design || form.category || '', 160);
  const shape = sanitizePlainText(record?.shape || form.shape || '', 80);
  const length = sanitizePlainText(record?.length || form.length || '', 80);

  const leftHandImages = toImageArray(record?.left_hand_images ?? data.leftHandImages);
  const rightHandImages = toImageArray(record?.right_hand_images ?? data.rightHandImages);
  const inspirationImages = toImageArray(record?.inspiration_images ?? data.inspirationImages);
  const hasCategorizedImages = leftHandImages.length || rightHandImages.length || inspirationImages.length;

  // Pre-migration orders only ever had a flat `images` array inside `data`.
  const legacyImages = hasCategorizedImages ? [] : toImageArray(record?.images ?? data.images);
  const imageCount = leftHandImages.length + rightHandImages.length + inspirationImages.length + legacyImages.length;

  return {
    id: record?.id || record?.order_id || '',
    orderId: record?.order_id || record?.id || '',
    customerName,
    email,
    phone,
    delivery,
    notes,
    design,
    shape,
    length,
    status: record?.status || 'New',
    submittedAt: record?.created_at || record?.submittedAt || new Date().toISOString(),
    imageCount,
    leftHandImages,
    rightHandImages,
    inspirationImages,
    legacyImages,
    details: form,
  };
}

async function saveOrderToStore(order) {
  const imageCount = IMAGE_CATEGORIES.reduce((sum, category) => sum + (order[category.orderKey] || []).length, 0);

  const record = {
    id: order.id,
    order_id: order.orderId,
    customer_name: order.customerName,
    email: order.email,
    phone: order.phone,
    status: order.status,
    delivery: order.delivery,
    notes: order.notes,
    design: order.design,
    shape: order.shape,
    length: order.length,
    image_count: imageCount,
    left_hand_images: order.leftHandImages || [],
    right_hand_images: order.rightHandImages || [],
    inspiration_images: order.inspirationImages || [],
    created_at: order.submittedAt,
    data: {
      orderId: order.orderId,
      customerName: order.customerName,
      email: order.email,
      phone: order.phone,
      delivery: order.delivery,
      notes: order.notes,
      design: order.design,
      shape: order.shape,
      length: order.length,
      form: order.details,
      leftHandImages: order.leftHandImages || [],
      rightHandImages: order.rightHandImages || [],
      inspirationImages: order.inspirationImages || [],
    },
  };

  if (!hasPersistentOrderStore()) {
    MEMORY_STORE.push(record);
    return { ...record, created_at: record.created_at || new Date().toISOString() };
  }

  await sql`
    INSERT INTO orders (
      id,
      order_id,
      customer_name,
      email,
      phone,
      status,
      delivery,
      notes,
      design,
      shape,
      length,
      image_count,
      left_hand_images,
      right_hand_images,
      inspiration_images,
      created_at,
      data
    ) VALUES (
      ${record.id},
      ${record.order_id},
      ${record.customer_name},
      ${record.email},
      ${record.phone},
      ${record.status},
      ${record.delivery},
      ${record.notes},
      ${record.design},
      ${record.shape},
      ${record.length},
      ${record.image_count},
      ${JSON.stringify(record.left_hand_images)}::jsonb,
      ${JSON.stringify(record.right_hand_images)}::jsonb,
      ${JSON.stringify(record.inspiration_images)}::jsonb,
      ${record.created_at},
      ${JSON.stringify(record.data)}::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      customer_name = EXCLUDED.customer_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      status = EXCLUDED.status,
      delivery = EXCLUDED.delivery,
      notes = EXCLUDED.notes,
      design = EXCLUDED.design,
      shape = EXCLUDED.shape,
      length = EXCLUDED.length,
      image_count = EXCLUDED.image_count,
      left_hand_images = EXCLUDED.left_hand_images,
      right_hand_images = EXCLUDED.right_hand_images,
      inspiration_images = EXCLUDED.inspiration_images,
      data = EXCLUDED.data,
      last_updated = NOW()
  `;

  return record;
}

// Memoized per warm serverless instance so every request doesn't re-run
// DDL — CREATE/ALTER ... IF NOT EXISTS is idempotent but still a real
// round-trip we don't need to pay on every single API call.
let ordersTableEnsured = false;

async function ensureOrdersTable() {
  if (!hasPersistentOrderStore()) return;
  if (ordersTableEnsured) return;

  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      customer_name TEXT,
      email TEXT,
      phone TEXT,
      status TEXT DEFAULT 'New',
      delivery TEXT,
      notes TEXT,
      design TEXT,
      shape TEXT,
      length TEXT,
      image_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_updated TIMESTAMPTZ DEFAULT NOW(),
      archived BOOLEAN DEFAULT FALSE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `;

  // Safe to run on every deploy: IF NOT EXISTS means this never touches
  // existing rows or columns, so pre-migration orders (and their old flat
  // `data.images` array) are left exactly as they were.
  await sql`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS delivery TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS design TEXT,
    ADD COLUMN IF NOT EXISTS shape TEXT,
    ADD COLUMN IF NOT EXISTS length TEXT,
    ADD COLUMN IF NOT EXISTS image_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS left_hand_images JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS right_hand_images JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS inspiration_images JSONB NOT NULL DEFAULT '[]'::jsonb
  `;

  ordersTableEnsured = true;
}

function rowFromDbRecord(row) {
  return {
    id: row.id,
    order_id: row.order_id,
    customer_name: row.customer_name,
    email: row.email,
    phone: row.phone,
    status: row.status || 'New',
    delivery: row.delivery,
    notes: row.notes,
    design: row.design,
    shape: row.shape,
    length: row.length,
    image_count: Number(row.image_count || 0),
    left_hand_images: row.left_hand_images,
    right_hand_images: row.right_hand_images,
    inspiration_images: row.inspiration_images,
    created_at: row.created_at,
    data: row.data || {},
  };
}

async function listOrdersFromStore({ status = 'all', search = '', sort = 'newest' } = {}) {
  let rows = [];

  if (hasPersistentOrderStore()) {
    const result = await sql`SELECT * FROM orders WHERE archived = false ORDER BY created_at DESC`;
    rows = (result.rows || []).map(rowFromDbRecord);
  } else {
    rows = MEMORY_STORE.filter((row) => !row.archived).map(rowFromDbRecord);
  }

  const filtered = rows.filter((row) => {
    const item = mapPersistedOrder(row);
    const matchesStatus = status === 'all' || row.status === status || item.status === status;
    const haystack = [item.customerName, item.email, item.phone, item.orderId, item.design, item.notes, item.delivery].join(' ').toLowerCase();
    const matchesSearch = !search || haystack.includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  if (sort === 'oldest') {
    filtered.sort((a, b) => new Date(a.created_at || a.submittedAt) - new Date(b.created_at || b.submittedAt));
  } else {
    filtered.sort((a, b) => new Date(b.created_at || b.submittedAt) - new Date(a.created_at || a.submittedAt));
  }

  return filtered.map((row) => mapPersistedOrder(row));
}

async function findOrderById(orderId) {
  if (hasPersistentOrderStore()) {
    const result = await sql`SELECT * FROM orders WHERE order_id = ${orderId} LIMIT 1`;
    if (!(result.rows || []).length) return null;
    return mapPersistedOrder(result.rows[0]);
  }

  const match = MEMORY_STORE.find((row) => row.order_id === orderId || row.id === orderId);
  if (!match) return null;
  return mapPersistedOrder(match);
}

async function updateOrderStatus(orderId, status) {
  const safeStatus = ORDER_STATUSES.includes(status) ? status : 'New';

  if (hasPersistentOrderStore()) {
    await sql`
      UPDATE orders
      SET status = ${safeStatus}, last_updated = NOW()
      WHERE order_id = ${orderId}
    `;
  } else {
    const match = MEMORY_STORE.find((row) => row.order_id === orderId || row.id === orderId);
    if (match) match.status = safeStatus;
  }

  return findOrderById(orderId);
}

async function archiveOrder(orderId) {
  if (hasPersistentOrderStore()) {
    await sql`
      UPDATE orders
      SET archived = true, last_updated = NOW()
      WHERE order_id = ${orderId}
    `;
    return true;
  }

  const match = MEMORY_STORE.find((row) => row.order_id === orderId || row.id === orderId);
  if (match) match.archived = true;
  return true;
}

async function submitOrderFromRequest(req, cloudinary) {
  await ensureOrdersTable();

  const { fields, files } = await parseOrderMultipart(req);

  const customerName = sanitizePlainText(fields.name || fields.customerName || fields.fullName || '', 160);
  const email = sanitizePlainText(fields.email || '', 160);
  const phone = sanitizePlainText(fields.phone || '', 120);
  const delivery = sanitizePlainText(fields.delivery || '', 120);
  const notes = sanitizePlainText(fields.notes || fields.specialRequests || '', 2000);
  const design = sanitizePlainText(fields.design || fields.category || fields.style || '', 160);
  const shape = sanitizePlainText(fields.shape || '', 80);
  const length = sanitizePlainText(fields.length || '', 80);

  if (!customerName || !email || !phone || !delivery) {
    const error = new Error('Please complete your name, email, phone number, and delivery method before submitting.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    const error = new Error('Please provide a valid email address.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const filesByCategory = IMAGE_CATEGORIES.map((category) => ({
    category,
    files: getFilesForField(files, category.field),
  }));

  const totalFileCount = filesByCategory.reduce((sum, entry) => sum + entry.files.length, 0);
  if (totalFileCount > MAX_IMAGE_COUNT) {
    const error = new Error(`You can upload up to ${MAX_IMAGE_COUNT} images per order.`);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const orderId = createOrderId();
  const submittedAt = new Date().toISOString();

  const uploadedByCategory = {};
  for (const entry of filesByCategory) {
    uploadedByCategory[entry.category.orderKey] = await uploadOrderImageGroup(cloudinary, entry.files, orderId, entry.category);
  }

  const totalUploadedCount = IMAGE_CATEGORIES.reduce((sum, category) => sum + uploadedByCategory[category.orderKey].length, 0);

  const order = {
    id: orderId,
    orderId,
    customerName,
    email,
    phone,
    delivery,
    notes,
    design,
    shape,
    length,
    status: 'New',
    submittedAt,
    leftHandImages: uploadedByCategory.leftHandImages,
    rightHandImages: uploadedByCategory.rightHandImages,
    inspirationImages: uploadedByCategory.inspirationImages,
    details: {
      ...fields,
      totalImageCount: totalUploadedCount,
      customerName,
      email,
      phone,
      delivery,
      notes,
      design,
      shape,
      length,
    },
  };

  await saveOrderToStore(order);

  // The order is safely persisted at this point — it will already show up
  // under Admin -> Orders regardless of what happens next. Email is opt-in
  // (default off) via ORDER_EMAIL_NOTIFICATIONS=true: Gmail delivery isn't
  // configured correctly yet, and leaving it on by default just fills
  // Vercel's logs with repeated auth failures on every order. The send
  // logic itself (sendOrderEmail, buildEmailHtml/buildPlainText) is
  // untouched so flipping that one env var re-enables it later without
  // rebuilding anything. Either way — disabled, or enabled but failing —
  // this must never throw: the client's error path would tell the customer
  // to retry, and retrying would create a second, duplicate order since
  // order IDs are randomly generated, not idempotent. The customer-facing
  // message is always the plain success text regardless of email outcome.
  let emailSent = false;

  if (!isOrderEmailNotificationsEnabled()) {
    console.log('[orders] email notifications disabled (set ORDER_EMAIL_NOTIFICATIONS=true to re-enable); skipping send', { orderId });
  } else {
    try {
      await sendOrderEmail(order, {
        leftHandImages: order.leftHandImages,
        rightHandImages: order.rightHandImages,
        inspirationImages: order.inspirationImages,
      });
      emailSent = true;
    } catch (emailError) {
      // Nodemailer/SMTP diagnostic fields only — never the credentials used
      // to authenticate. For Gmail, error.message/response on an auth
      // failure is itself just a generic SMTP response line (e.g. "Invalid
      // login: 535-5.7.8 Username and Password not accepted"), not a secret.
      console.error('[orders] confirmation email failed', {
        orderId,
        code: emailError?.code,
        responseCode: emailError?.responseCode,
        command: emailError?.command,
        message: emailError?.message,
      });
    }
  }

  return {
    success: true,
    orderId,
    status: 'New',
    message: `Your order has been submitted successfully. Order reference: ${orderId}`,
    emailSent,
    order: mapPersistedOrder({
      id: orderId,
      order_id: orderId,
      customer_name: customerName,
      email,
      phone,
      status: 'New',
      created_at: submittedAt,
      left_hand_images: order.leftHandImages,
      right_hand_images: order.rightHandImages,
      inspiration_images: order.inspirationImages,
      data: { form: order.details },
    }),
  };
}

module.exports = {
  ORDER_STATUSES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGE_COUNT,
  IMAGE_CATEGORIES,
  sanitizeText,
  sanitizePlainText,
  ensureOrdersTable,
  listOrdersFromStore,
  findOrderById,
  updateOrderStatus,
  archiveOrder,
  submitOrderFromRequest,
  mapPersistedOrder,
  normalizeAppPassword,
  sendOrderEmailConfig,
  isOrderEmailNotificationsEnabled,
};
