const crypto = require('crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

function createToken() {
  const payload = {
    exp: Date.now() + 1000 * 60 * 60,
    iat: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', ADMIN_JWT_SECRET)
    .update(encoded)
    .digest('hex');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  const expected = crypto
    .createHmac('sha256', ADMIN_JWT_SECRET)
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!ADMIN_PASSWORD || !ADMIN_JWT_SECRET) {
    return res.status(500).json({ error: 'Admin environment variables are not configured.' });
  }

  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = createToken();
  return res.status(200).json({ token, expiresIn: 3600 });
};
