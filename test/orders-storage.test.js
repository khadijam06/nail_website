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