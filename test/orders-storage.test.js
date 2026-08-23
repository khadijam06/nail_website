const assert = require('node:assert/strict');
const test = require('node:test');

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('orders use memory only outside production when PostgreSQL is unavailable', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousVercel = process.env.VERCEL;
  const previousPostgresUrl = process.env.POSTGRES_URL;
  delete process.env.POSTGRES_URL;
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL;

  try {
    const { ensureOrdersTable, listOrdersFromStore } = require('../server/orders');
    await ensureOrdersTable();
    assert.deepEqual(await listOrdersFromStore(), []);
  } finally {
    restoreEnvironment('NODE_ENV', previousNodeEnv);
    restoreEnvironment('VERCEL_ENV', previousVercelEnv);
    restoreEnvironment('VERCEL', previousVercel);
    restoreEnvironment('POSTGRES_URL', previousPostgresUrl);
  }
});

test('orders reject volatile storage in production', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousVercel = process.env.VERCEL;
  const previousPostgresUrl = process.env.POSTGRES_URL;
  delete process.env.POSTGRES_URL;
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL;

  try {
    const { ensureOrdersTable } = require('../server/orders');
    await assert.rejects(
      ensureOrdersTable(),
      (error) => error?.code === 'ORDER_STORAGE_CONFIGURATION_ERROR',
    );
  } finally {
    restoreEnvironment('NODE_ENV', previousNodeEnv);
    restoreEnvironment('VERCEL_ENV', previousVercelEnv);
    restoreEnvironment('VERCEL', previousVercel);
    restoreEnvironment('POSTGRES_URL', previousPostgresUrl);
  }
});

test('orders reject volatile storage on Vercel Preview (VERCEL_ENV=preview), not just Production', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousVercel = process.env.VERCEL;
  const previousPostgresUrl = process.env.POSTGRES_URL;
  delete process.env.POSTGRES_URL;
  process.env.NODE_ENV = 'production'; // Vercel's Node runtime sets this even for Preview builds
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL = '1';

  try {
    const { ensureOrdersTable } = require('../server/orders');
    await assert.rejects(
      ensureOrdersTable(),
      (error) => error?.code === 'ORDER_STORAGE_CONFIGURATION_ERROR',
    );
  } finally {
    restoreEnvironment('NODE_ENV', previousNodeEnv);
    restoreEnvironment('VERCEL_ENV', previousVercelEnv);
    restoreEnvironment('VERCEL', previousVercel);
    restoreEnvironment('POSTGRES_URL', previousPostgresUrl);
  }
});

test('mapPersistedOrder keeps left/right/inspiration photos separate', () => {
  const { mapPersistedOrder } = require('../server/orders');

  const order = mapPersistedOrder({
    id: 'NIK-AAA111',
    order_id: 'NIK-AAA111',
    customer_name: 'Test Customer',
    status: 'New',
    left_hand_images: [{ label: 'Left Hand Photo 1', url: 'https://example.com/left-1.jpg' }],
    right_hand_images: [{ label: 'Right Hand Photo 1', url: 'https://example.com/right-1.jpg' }],
    inspiration_images: [
      { label: 'Inspiration Photo 1', url: 'https://example.com/insp-1.jpg' },
      { label: 'Inspiration Photo 2', url: 'https://example.com/insp-2.jpg' },
    ],
    data: {},
  });

  assert.equal(order.leftHandImages.length, 1);
  assert.equal(order.rightHandImages.length, 1);
  assert.equal(order.inspirationImages.length, 2);
  assert.equal(order.legacyImages.length, 0);
  assert.equal(order.imageCount, 4);
  assert.equal(order.leftHandImages[0].url, 'https://example.com/left-1.jpg');
});

test('mapPersistedOrder surfaces an empty category as an empty array, not a crash', () => {
  const { mapPersistedOrder } = require('../server/orders');

  const order = mapPersistedOrder({
    id: 'NIK-BBB222',
    order_id: 'NIK-BBB222',
    customer_name: 'No Inspiration Customer',
    status: 'New',
    left_hand_images: [{ label: 'Left Hand Photo 1', url: 'https://example.com/left-1.jpg' }],
    right_hand_images: [{ label: 'Right Hand Photo 1', url: 'https://example.com/right-1.jpg' }],
    inspiration_images: [],
    data: {},
  });

  assert.deepEqual(order.inspirationImages, []);
  assert.equal(order.imageCount, 2);
});

test('mapPersistedOrder routes pre-migration orders (flat images array) into legacyImages, never guessing a category', () => {
  const { mapPersistedOrder } = require('../server/orders');

  const legacyOrder = mapPersistedOrder({
    id: 'NIK-OLD001',
    order_id: 'NIK-OLD001',
    customer_name: 'Legacy Customer',
    status: 'New',
    data: {
      images: [
        { label: 'Inspiration Image 1', url: 'https://example.com/legacy-1.jpg' },
        { label: 'Inspiration Image 2', url: 'https://example.com/legacy-2.jpg' },
      ],
    },
  });

  assert.equal(legacyOrder.legacyImages.length, 2);
  assert.deepEqual(legacyOrder.leftHandImages, []);
  assert.deepEqual(legacyOrder.rightHandImages, []);
  assert.deepEqual(legacyOrder.inspirationImages, []);
  assert.equal(legacyOrder.imageCount, 2);
});

test('sendOrderEmailConfig reads the exact EMAIL_USER/EMAIL_PASS/EMAIL_TO names and strips spaces from the app password', () => {
  const keys = ['EMAIL_USER', 'EMAIL_PASS', 'EMAIL_TO', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'ADMIN_EMAIL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);

  process.env.EMAIL_USER = 'shop@example.com';
  // Google displays app passwords in 4-char groups; simulate a verbatim copy-paste.
  process.env.EMAIL_PASS = 'abcd efgh ijkl mnop';
  process.env.EMAIL_TO = 'orders@example.com';

  try {
    const { sendOrderEmailConfig } = require('../server/orders');
    const config = sendOrderEmailConfig();
    assert.equal(config.user, 'shop@example.com');
    assert.equal(config.to, 'orders@example.com');
    assert.equal(config.pass, 'abcdefghijklmnop');
    assert.equal(config.pass.length, 16);
  } finally {
    keys.forEach((key) => restoreEnvironment(key, previous[key]));
  }
});

test('sendOrderEmailConfig never silently substitutes a hardcoded email when EMAIL_USER/EMAIL_TO are unset', () => {
  const keys = ['EMAIL_USER', 'EMAIL_PASS', 'EMAIL_TO', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'ADMIN_EMAIL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);

  try {
    const { sendOrderEmailConfig } = require('../server/orders');
    const config = sendOrderEmailConfig();
    // Must come back empty, not a hardcoded fallback address — a hardcoded
    // fallback would silently try to authenticate as the wrong account.
    assert.equal(config.user, '');
    assert.equal(config.to, '');
  } finally {
    keys.forEach((key) => restoreEnvironment(key, previous[key]));
  }
});

test('normalizeAppPassword strips all whitespace regardless of position', () => {
  const { normalizeAppPassword } = require('../server/orders');
  assert.equal(normalizeAppPassword('abcd efgh ijkl mnop'), 'abcdefghijklmnop');
  assert.equal(normalizeAppPassword('  abcdefghijklmnop  '), 'abcdefghijklmnop');
  assert.equal(normalizeAppPassword(''), '');
  assert.equal(normalizeAppPassword(undefined), '');
});

test('order email notifications default to disabled', () => {
  const previous = process.env.ORDER_EMAIL_NOTIFICATIONS;
  delete process.env.ORDER_EMAIL_NOTIFICATIONS;

  try {
    const { isOrderEmailNotificationsEnabled } = require('../server/orders');
    assert.equal(isOrderEmailNotificationsEnabled(), false);
  } finally {
    restoreEnvironment('ORDER_EMAIL_NOTIFICATIONS', previous);
  }
});

test('order email notifications only turn on with the exact value "true"', () => {
  const previous = process.env.ORDER_EMAIL_NOTIFICATIONS;

  try {
    const { isOrderEmailNotificationsEnabled } = require('../server/orders');

    process.env.ORDER_EMAIL_NOTIFICATIONS = 'true';
    assert.equal(isOrderEmailNotificationsEnabled(), true);

    // Common near-misses must NOT enable it — only the literal string "true" does.
    ['TRUE', '1', 'yes', 'false', ''].forEach((value) => {
      process.env.ORDER_EMAIL_NOTIFICATIONS = value;
      assert.equal(isOrderEmailNotificationsEnabled(), false, `expected "${value}" to be treated as disabled`);
    });
  } finally {
    restoreEnvironment('ORDER_EMAIL_NOTIFICATIONS', previous);
  }
});

test('mapPersistedOrder never crashes on an order with no images at all', () => {
  const { mapPersistedOrder } = require('../server/orders');

  const order = mapPersistedOrder({
    id: 'NIK-CCC333',
    order_id: 'NIK-CCC333',
    customer_name: 'No Photos Customer',
    status: 'New',
    data: {},
  });

  assert.deepEqual(order.leftHandImages, []);
  assert.deepEqual(order.rightHandImages, []);
  assert.deepEqual(order.inspirationImages, []);
  assert.deepEqual(order.legacyImages, []);
  assert.equal(order.imageCount, 0);
});