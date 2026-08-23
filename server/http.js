// Every response from this codebase's API is either authenticated admin
// data or a listing that must reflect the current DB/CMS state immediately
// (orders, products, content) — none of it should ever be cached by a
// browser, a proxy, or Vercel's edge network. Setting this here, once,
// covers the whole API surface instead of relying on every route to
// remember it individually.
function sendJson(res, statusCode, payload) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }

  if (typeof res.status === 'function') {
    return res.status(statusCode).json(payload);
  }

  res.statusCode = statusCode;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
  }
  return res.end(JSON.stringify(payload));
}

function parseBearerToken(headers) {
  const auth = headers?.authorization || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7);
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  if (!req || typeof req.on !== 'function') {
    return {};
  }

  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  sendJson,
  parseBearerToken,
  parseJsonBody,
};
