const crypto = require('crypto');

module.exports = {
  verifyToken(token) {
    if (!token || typeof token !== 'string') return false;
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return false;
    const expected = crypto
      .createHmac('sha256', process.env.ADMIN_JWT_SECRET)
      .update(encoded)
      .digest('hex');
    if (signature !== expected) return false;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      return payload.exp && payload.exp > Date.now();
    } catch {
      return false;
    }
  },
};
