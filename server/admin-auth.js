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

function verifyToken(token, secret = process.env.ADMIN_JWT_SECRET) {
  if (!token || typeof token !== 'string' || !secret) return false;
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

module.exports = {
  createToken,
  verifyToken,
};
