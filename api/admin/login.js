const crypto = require('crypto');

function createToken(secret) {
  const payload = {
    exp: Date.now() + 1000 * 60 * 60,
    iat: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('hex');
  return `${encoded}.${signature}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('hex');
  if (signature !== expected) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.exp && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function parseBody(req) {
  if (req?.body === undefined || req?.body === null) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  if (typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body;
  }
  return null;
}

module.exports = async function handler(req, res) {
  console.log('[login] request start', {
    method: req?.method,
    url: req?.url,
    hasBody: req?.body !== undefined,
  });

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed', expectedMethod: 'POST' });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminJwtSecret = process.env.ADMIN_JWT_SECRET;
    if (!adminPassword || !adminJwtSecret) {
      return res.status(500).json({ error: 'Admin environment variables are not configured' });
    }

    const body = parseBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    const { password } = body;
    if (typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({ error: 'Password is required' });
    }

    if (password !== adminPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = createToken(adminJwtSecret);
    return res.status(200).json({ token, expiresIn: 3600 });
  } catch (error) {
    console.error('[login] catch', error);
    return res.status(500).json({ error: 'Login failed' });
  }
};
