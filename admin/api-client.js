const TOKEN_KEY = 'adminToken';

let unauthorizedHandler = null;

export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${getToken()}`, ...extra };
}

export function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatApiError(data, fallback) {
  if (!data || typeof data !== 'object') return fallback;

  const parts = [];
  if (data.error) parts.push(String(data.error));

  if (data.details?.validationErrors && Array.isArray(data.details.validationErrors)) {
    parts.push(data.details.validationErrors.join('; '));
  }
  if (data.details?.queryErrors && Array.isArray(data.details.queryErrors)) {
    parts.push(data.details.queryErrors.join('; '));
  }
  if (data.details?.reason) {
    parts.push(`Reason: ${data.details.reason}`);
  }

  return parts.filter(Boolean).join(' | ') || fallback;
}

export async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: raw };
    }
  }

  if (res.status === 401 && typeof unauthorizedHandler === 'function') {
    unauthorizedHandler();
  }

  return { res, data };
}

export async function login(password) {
  const { res, data } = await requestJson('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    return { ok: false, error: formatApiError(data, 'Login failed') };
  }

  setToken(data.token);
  return { ok: true };
}

export async function uploadFiles(fileList, { folder } = {}) {
  if (!fileList || !fileList.length) return [];

  const formData = new FormData();
  for (const file of fileList) formData.append('photos', file);
  if (folder) formData.append('folder', folder);

  const { res, data } = await requestJson('/api/admin/upload', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    throw new Error(formatApiError(data, 'Image upload failed'));
  }

  return (data.uploaded || []).map((item) => ({
    id: item.id || '',
    publicId: item.publicId || item.public_id,
    url: item.url,
  }));
}

export async function getContentSection(key, status = 'draft') {
  const { res, data } = await requestJson(`/api/admin/content?key=${encodeURIComponent(key)}&status=${status}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(formatApiError(data, `Failed to load "${key}" content`));
  }
  return data.section || { data: {}, updatedAt: null };
}

export async function saveContentPatch(key, patch) {
  const { res, data } = await requestJson('/api/admin/content', {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key, patch }),
  });
  if (!res.ok) {
    throw new Error(formatApiError(data, `Failed to save "${key}" draft`));
  }
  return data.section;
}

export async function publishContentSection(key) {
  const { res, data } = await requestJson('/api/admin/content', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key, action: 'publish' }),
  });
  if (!res.ok) {
    throw new Error(formatApiError(data, `Failed to publish "${key}"`));
  }
  return data.section;
}

export async function getDashboard() {
  const { res, data } = await requestJson('/api/admin/dashboard', {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(formatApiError(data, 'Failed to load dashboard'));
  }
  return data.sections || [];
}
