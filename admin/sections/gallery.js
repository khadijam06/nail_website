import { requestJson, authHeaders, formatApiError } from '../api-client.js';

const MAX_GALLERY_IMAGES = 6;

export function buildGallerySlots(images) {
  const slots = Array.from({ length: MAX_GALLERY_IMAGES }, (_, slot) => ({ slot, publicId: '', url: '', alt: '', isPlaceholder: true }));
  (images || []).forEach((image, index) => {
    const target = Number.isInteger(Number(image.slot)) ? Number(image.slot) : index;
    if (target < 0 || target >= MAX_GALLERY_IMAGES) return;
    slots[target] = { slot: target, publicId: image.publicId || '', url: image.url || '', alt: image.alt || '', isPlaceholder: false };
  });
  return slots;
}

export async function loadGalleryImages() {
  const { res, data } = await requestJson('/api/admin/gallery', { headers: authHeaders() });
  if (!res.ok) throw new Error(formatApiError(data, 'Failed to load gallery'));

  return (data.images || [])
    .map((img, index) => ({
      publicId: img.publicId || '',
      url: img.url || '',
      alt: img.alt || '',
      slot: Number.isInteger(Number(img.slot)) ? Number(img.slot) : index,
    }))
    .slice(0, MAX_GALLERY_IMAGES)
    .sort((a, b) => a.slot - b.slot)
    .map((img, index) => ({ ...img, slot: index }));
}

export async function uploadNewImages(files) {
  const formData = new FormData();
  formData.append('mode', 'add');
  files.forEach((file) => formData.append('photos', file));

  const { res, data } = await requestJson('/api/admin/gallery', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) throw new Error(formatApiError(data, 'Gallery upload failed'));
  return data;
}

export async function replaceImage(slot, file, alt) {
  const formData = new FormData();
  formData.append('mode', 'replace');
  formData.append('slot', String(slot));
  formData.append('alt', String(alt || '').trim());
  formData.append('photo', file);

  const { res, data } = await requestJson('/api/admin/gallery', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) throw new Error(formatApiError(data, `Failed to replace image in slot ${slot + 1}`));
  return data;
}

export async function deleteImage(publicId) {
  const { res, data } = await requestJson('/api/admin/gallery', {
    method: 'DELETE',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ publicId }),
  });
  if (!res.ok) throw new Error(formatApiError(data, 'Failed to delete gallery image'));
  return data;
}

export async function saveOrder(items) {
  const { res, data } = await requestJson('/api/admin/gallery', {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(formatApiError(data, 'Failed to save gallery order'));
  return data;
}
