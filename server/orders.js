const crypto = require('crypto');
const { IncomingForm } = require('formidable');
const nodemailer = require('nodemailer');
const { sql } = require('@vercel/postgres');

const ORDER_STATUSES = ['New', 'Reviewing', 'Confirmed', 'In Progress', 'Ready', 'Completed', 'Cancelled'];
const ORDER_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_COUNT = 8;
const MEMORY_STORE = [];

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

function getOrderImageFiles(files = {}) {
  const candidates = ['leftHand', 'rightHand', 'inspiration', 'images', 'image', 'photos', 'photo'];
  const collected = [];
  candidates.forEach((name) => {
    const match = files[name];
    if (!match) return;
    const list = Array.isArray(match) ? match : [match];
    list.forEach((file) => {
      if (file && file.filepath) collected.push(file);
    });
  });
  return collected;
}

function validateImageFile(file, index) {
  if (!file || !file.filepath) {
    const error = new Error(`Inspiration image ${index + 1} is missing from the upload.`);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const mimeType = (file.mimetype || file.type || '').toLowerCase();
  const filename = String(file.originalFilename || file.newFilename || `image-${index + 1}`);
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

function buildImageLabel(index, fallback) {
  return fallback ? `${fallback} ${index + 1}` : `Inspiration Image ${index + 1}`;
}

async function uploadOrderImages(cloudinary, files) {
  if (!cloudinary || !files.length) return [];

  const uploads = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    validateImageFile(file, index);
    const uploadResult = await cloudinary.uploader.upload(file.filepath, {
      folder: 'nailit_orders',
      resource_type: 'image',
      tags: ['customer_order'],
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      context: { order_image_label: buildImageLabel(index, 'Inspiration Image') },
    });

    uploads.push({
      originalName: String(file.originalFilename || file.newFilename || `image-${index + 1}`),
      publicId: uploadResult.public_id,
      url: uploadResult.secure_url,
      width: uploadResult.width,
      height: uploadResult.height,
      label: buildImageLabel(index, 'Inspiration Image'),
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

function buildEmailHtml(order, images) {
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

  const imageMarkup = images.length
    ? images.map((image, index) => `
        <div style="margin-bottom:18px;">
          <p style="margin:0 0 8px;font-weight:700;color:#5d2d49;">${escapeHtml(image.label)}</p>
          <a href="${escapeHtml(image.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;max-width:100%;margin-bottom:10px;">
            <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.label)}" style="max-width:220px;max-height:220px;border-radius:12px;border:1px solid #f1d9e7;background:#fff;display:block;" />
          </a>
          <div style="font-size:12px;color:#7d5b7b;">
            <a href="${escapeHtml(image.url)}" target="_blank" rel="noopener noreferrer" style="color:#b30f65;">Open image</a>
          </div>
        </div>
      `).join('')
    : '<p style="margin:0;color:#7d5b7b;">No inspiration images uploaded.</p>';

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

        <div style="margin-top:24px;">
          <p style="margin:0 0 12px;font-weight:700;color:#5d2d49;">Uploaded inspiration/reference images</p>
          ${imageMarkup}
        </div>
      </div>
    </div>
  `;
}

function buildPlainText(order, images) {
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
    '',
    'Uploaded inspiration/reference images:',
  ];

  if (images.length) {
    images.forEach((image, index) => {
      lines.push(`${index + 1}. ${image.label}: ${image.url}`);
    });
  } else {
    lines.push('No inspiration images uploaded.');
  }

  lines.push('', 'Admin dashboard: /admin → Orders');
  return lines.join('\n');
}

async function sendOrderEmail(order, images) {
  const to = process.env.EMAIL_TO || process.env.ADMIN_EMAIL || 'nailitbyk28@gmail.com';
  const user = process.env.EMAIL_USER || process.env.GMAIL_USER || 'nailitbyk28@gmail.com';
  const pass = process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    const error = new Error('Email delivery is not configured. Missing EMAIL_USER/EMAIL_PASS environment variables.');
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
    text: buildPlainText(order, images),
    html: buildEmailHtml(order, images),
  });

  return info;
}

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
  const images = Array.isArray(record?.images) ? record.images : (Array.isArray(data.images) ? data.images : []);

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
    imageCount: Array.isArray(images) ? images.length : 0,
    images,
    details: form,
  };
}

async function saveOrderToStore(order) {
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
    image_count: order.images.length,
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
      images: order.images,
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

  await sql`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS delivery TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS design TEXT,
    ADD COLUMN IF NOT EXISTS shape TEXT,
    ADD COLUMN IF NOT EXISTS length TEXT,
    ADD COLUMN IF NOT EXISTS image_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ DEFAULT NOW()
  `;

  ordersTableEnsured = true;
}

async function listOrdersFromStore({ status = 'all', search = '', sort = 'newest' } = {}) {
  let rows = [];

  if (hasPersistentOrderStore()) {
    const result = await sql`SELECT * FROM orders WHERE archived = false ORDER BY created_at DESC`;
    rows = (result.rows || []).map((row) => ({
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
      created_at: row.created_at,
      data: row.data || {},
    }));
  } else {
    rows = MEMORY_STORE.filter((row) => !row.archived).map((row) => ({
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
      created_at: row.created_at,
      data: row.data || {},
    }));
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
  const imageFiles = getOrderImageFiles(files);
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

  if (imageFiles.length > MAX_IMAGE_COUNT) {
    const error = new Error(`You can upload up to ${MAX_IMAGE_COUNT} images per order.`);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const uploadedImages = await uploadOrderImages(cloudinary, imageFiles);

  const orderId = createOrderId();
  const submittedAt = new Date().toISOString();
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
    images: uploadedImages.map((image) => ({
      label: image.label,
      url: image.url,
      publicId: image.publicId,
      originalName: image.originalName,
    })),
    details: {
      ...fields,
      inspirationImageCount: uploadedImages.length,
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
  // under Admin -> Orders regardless of what happens next. If the
  // confirmation email fails (bad credentials, Gmail hiccup, etc.) we must
  // NOT throw here: the client's error path tells the customer to retry,
  // and retrying would create a second, duplicate order for the same
  // request since order IDs are randomly generated, not idempotent. Instead
  // we still report success and just note that the email didn't go out.
  let emailWarning = null;
  try {
    await sendOrderEmail(order, order.images);
  } catch (emailError) {
    console.error('[orders] confirmation email failed', { orderId, error: emailError?.message });
    emailWarning = 'Your order was saved, but the confirmation email could not be sent. Our team can still see it in the admin dashboard.';
  }

  return {
    success: true,
    orderId,
    status: 'New',
    message: emailWarning || `Your order has been submitted successfully. Order reference: ${orderId}`,
    emailWarning,
    order: mapPersistedOrder({
      id: orderId,
      order_id: orderId,
      customer_name: customerName,
      email,
      phone,
      status: 'New',
      created_at: submittedAt,
      data: { form: order.details, images: order.images },
    }),
  };
}

module.exports = {
  ORDER_STATUSES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGE_COUNT,
  sanitizeText,
  sanitizePlainText,
  ensureOrdersTable,
  listOrdersFromStore,
  findOrderById,
  updateOrderStatus,
  archiveOrder,
  submitOrderFromRequest,
  mapPersistedOrder,
};
