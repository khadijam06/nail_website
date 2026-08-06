const MAX_STRING_LENGTH = 5000;
const MAX_KEY_LENGTH = 80;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_KEYS = 60;
const MAX_DEPTH = 6;

const URL_KEY_PATTERN = /(href|url|link)$/i;
const SAFE_URL_PATTERN = /^(https?:\/\/|mailto:|tel:|#|\/|[a-z0-9][a-z0-9._-]*\.html)/i;
const UNSAFE_SCHEME_PATTERN = /^\s*(javascript|data|vbscript|file):/i;

function sanitizeText(value, max = MAX_STRING_LENGTH) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function isSafeUrl(value) {
  const clean = String(value || '').trim();
  if (!clean) return true; // empty link is allowed (renders as no-op / hidden)
  if (UNSAFE_SCHEME_PATTERN.test(clean)) return false;
  return SAFE_URL_PATTERN.test(clean);
}

function sanitizeUrl(value, max = 2000) {
  const clean = sanitizeText(value, max);
  return isSafeUrl(clean) ? clean : '';
}

// Generic guard applied to every content patch before it is merged into a
// section's draft: bounds every string, caps array/object size, and rejects
// unsafe URL schemes on any field whose key looks like a link. This lets new
// section editors ship without a bespoke server-side schema for every field.
function sanitizeContentValue(value, keyHint = '', depth = 0) {
  if (depth > MAX_DEPTH) return null;

  if (typeof value === 'string') {
    const clean = sanitizeText(value, MAX_STRING_LENGTH);
    return URL_KEY_PATTERN.test(keyHint) ? sanitizeUrl(clean) : clean;
  }

  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeContentValue(item, keyHint, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    Object.entries(value)
      .slice(0, MAX_OBJECT_KEYS)
      .forEach(([k, v]) => {
        const cleanKey = sanitizeText(k, MAX_KEY_LENGTH);
        if (!cleanKey) return;
        out[cleanKey] = sanitizeContentValue(v, cleanKey, depth + 1);
      });
    return out;
  }

  return null;
}

function sanitizePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const error = new Error('patch must be a JSON object');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return sanitizeContentValue(patch);
}

module.exports = {
  sanitizeText,
  isSafeUrl,
  sanitizeUrl,
  sanitizeContentValue,
  sanitizePatch,
};
