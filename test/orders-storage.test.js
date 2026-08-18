const assert = require('node:assert/strict');
const test = require('node:test');

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('orders use memory only outside production when PostgreSQL is unavailable', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousPostgresUrl = process.env.POSTGRES_URL;
  delete process.env.POSTGRES_URL;
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;

  try {
    const { ensureOrdersTable, listOrdersFromStore } = require('../server/orders');
    await ensureOrdersTable();
    assert.deepEqual(await listOrdersFromStore(), []);
  } finally {
    restoreEnvironment('NODE_ENV', previousNodeEnv);
    restoreEnvironment('VERCEL_ENV', previousVercelEnv);
    restoreEnvironment('POSTGRES_URL', previousPostgresUrl);
  }
});

test('orders reject volatile storage in production', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousPostgresUrl = process.env.POSTGRES_URL;
  delete process.env.POSTGRES_URL;
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL_ENV;

  try {
    const { ensureOrdersTable } = require('../server/orders');
    await assert.rejects(
      ensureOrdersTable(),
      (error) => error?.code === 'ORDER_STORAGE_CONFIGURATION_ERROR',
    );
  } finally {
    restoreEnvironment('NODE_ENV', previousNodeEnv);
    restoreEnvironment('VERCEL_ENV', previousVercelEnv);
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