import { requestJson, authHeaders, escapeHtml, formatApiError } from '../api-client.js';

export async function mount(container, ctx) {
  const showToast = ctx?.showToast || (() => {});

  const state = {
    galleryImages: [],
    galleryDraftSlots: [],
    galleryPendingReplacements: {},
    galleryDirty: false,
    galleryLoading: false,
    galleryUploading: false,
    gallerySaving: false,
    galleryRefreshQueued: false,
  };

  container.innerHTML = `
    <div class="card">
      <div id="galleryStatusMessage" class="status info" role="status" aria-live="polite"></div>
      <div class="section-title">
        <h2>Homepage Gallery</h2>
        <button id="refreshGalleryBtn" class="btn btn-secondary" type="button">Refresh</button>
      </div>
      <p class="muted" style="margin-bottom:10px;">Manage up to 6 homepage collage images. These are separate from product/style images.</p>

      <div class="grid" style="margin-bottom:10px;">
        <div class="field">
          <label for="galleryFilesInput">Upload Gallery Images (up to 6 total)</label>
          <input id="galleryFilesInput" type="file" accept="image/*" multiple>
        </div>
        <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;">
          <button id="uploadGalleryBtn" class="btn" type="button">Upload Selected</button>
          <button id="saveGalleryBtn" class="btn btn-secondary" type="button">Save Order &amp; Alt Text</button>
          <button id="cancelGalleryChangesBtn" class="btn btn-secondary" type="button">Cancel Changes</button>
        </div>
      </div>

      <div id="galleryManagerList" class="img-list"></div>
    </div>
  `;

  const statusMessage = container.querySelector('#galleryStatusMessage');

  function setStatus(message, type = 'info') {
    statusMessage.textContent = message || '';
    statusMessage.className = `status ${type}`;
  }

  function galleryPlaceholder(slot) {
    return { slot, publicId: '', url: '', alt: '', isPlaceholder: true };
  }

  function buildGallerySlots(images) {
    const slots = Array.from({ length: 6 }, (_, slot) => galleryPlaceholder(slot));
    (images || []).forEach((image, index) => {
      const target = Number.isInteger(Number(image.slot)) ? Number(image.slot) : index;
      if (target < 0 || target >= 6) return;
      slots[target] = {
        slot: target,
        publicId: image.publicId || '',
        url: image.url || '',
        alt: image.alt || '',
        isPlaceholder: false,
      };
    });
    return slots;
  }

  function cloneGallerySlots(slots) {
    return (slots || []).map((item, index) => ({
      slot: Number.isInteger(Number(item?.slot)) ? Number(item.slot) : index,
      publicId: item?.publicId || '',
      url: item?.url || '',
      alt: item?.alt || '',
      isPlaceholder: !item?.publicId,
    }));
  }

  function hasPendingGalleryUploadSelection() {
    const filesInput = container.querySelector('#galleryFilesInput');
    return Boolean(filesInput?.files?.length);
  }

  function updateGalleryActionButtons() {
    const refreshBtn = container.querySelector('#refreshGalleryBtn');
    const uploadBtn = container.querySelector('#uploadGalleryBtn');
    const saveBtn = container.querySelector('#saveGalleryBtn');
    const cancelBtn = container.querySelector('#cancelGalleryChangesBtn');
    const filesInput = container.querySelector('#galleryFilesInput');
    const busy = state.galleryLoading || state.galleryUploading || state.gallerySaving;
    const hasPendingUploads = hasPendingGalleryUploadSelection();
    const hasDiscardableChanges = state.galleryDirty || hasPendingUploads;

    if (refreshBtn) refreshBtn.disabled = busy || hasDiscardableChanges;
    if (uploadBtn) uploadBtn.disabled = busy || state.galleryDirty;
    if (saveBtn) saveBtn.disabled = busy || !state.galleryDirty;
    if (cancelBtn) cancelBtn.disabled = busy || !hasDiscardableChanges;
    if (filesInput) filesInput.disabled = busy || state.galleryDirty;
  }

  function markGalleryDirty() {
    state.galleryDirty = true;
    updateGalleryActionButtons();
  }

  function clearGalleryDirty() {
    state.galleryDirty = false;
    updateGalleryActionButtons();
  }

  function renderGalleryManager() {
    const list = container.querySelector('#galleryManagerList');
    if (!list) return;

    const slots = cloneGallerySlots(state.galleryDraftSlots.length ? state.galleryDraftSlots : buildGallerySlots(state.galleryImages));
    list.innerHTML = slots.map((item, index) => {
      const publicId = escapeHtml(item.publicId || '');
      const pendingFileName = state.galleryPendingReplacements[index]?.name || '';
      const preview = item.url
        ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || `Gallery image ${index + 1}`)}">`
        : '<div style="width:52px;height:52px;border-radius:10px;background:#f5ecf9;display:flex;align-items:center;justify-content:center;font-size:11px;color:#7d5b7b;font-weight:700;">Empty</div>';

      const controls = item.isPlaceholder
        ? ''
        : `
            <button class="btn btn-secondary" type="button" data-action="move" data-index="${index}" data-delta="-1">Up</button>
            <button class="btn btn-secondary" type="button" data-action="move" data-index="${index}" data-delta="1">Down</button>
            <button class="btn btn-danger" type="button" data-action="delete" data-id="${publicId}">Delete</button>
          `;

      return `
        <div class="img-row">
          ${preview}
          <div>
            <div style="font-weight:700;">Slot ${index + 1}</div>
            <div class="small" style="word-break:break-all;">${escapeHtml(item.publicId || 'No image uploaded')}</div>
            <div class="field" style="margin:8px 0 0;">
              <label for="galleryAlt_${index}">Alt text</label>
              <input id="galleryAlt_${index}" type="text" value="${escapeHtml(item.alt || '')}" placeholder="Describe this image" data-action="alt" data-index="${index}">
            </div>
            <div class="field" style="margin:8px 0 0;">
              <label for="replaceGallery_${index}">Replace slot ${index + 1}</label>
              <input id="replaceGallery_${index}" type="file" accept="image/*" data-action="replace" data-index="${index}">
              ${pendingFileName ? `<div class="small">Pending file: ${escapeHtml(pendingFileName)}</div>` : ''}
            </div>
          </div>
          <div class="img-controls">${controls}</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-action="alt"]').forEach((input) => {
      input.addEventListener('input', () => updateGalleryAlt(Number(input.getAttribute('data-index')), input.value));
    });
    list.querySelectorAll('[data-action="replace"]').forEach((input) => {
      input.addEventListener('change', () => stageGalleryReplacement(Number(input.getAttribute('data-index')), input));
    });
    list.querySelectorAll('[data-action="move"]').forEach((btn) => {
      btn.addEventListener('click', () => moveGalleryImage(Number(btn.getAttribute('data-index')), Number(btn.getAttribute('data-delta'))));
    });
    list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => deleteGalleryImage(btn.getAttribute('data-id')));
    });

    updateGalleryActionButtons();
  }

  async function loadGalleryManager(options = {}) {
    const force = Boolean(options.force);
    if (!force && (state.galleryDirty || hasPendingGalleryUploadSelection() || state.galleryUploading || state.gallerySaving)) {
      state.galleryRefreshQueued = true;
      updateGalleryActionButtons();
      setStatus('Gallery has unsaved or in-progress changes. Save or cancel before refreshing.', 'info');
      return;
    }

    state.galleryLoading = true;
    updateGalleryActionButtons();
    try {
      const { res, data } = await requestJson('/api/admin/gallery', { headers: authHeaders() });

      if (!res.ok) {
        setStatus(formatApiError(data, 'Failed to load gallery manager'), 'error');
        return;
      }

      state.galleryImages = (data.images || [])
        .map((img, index) => ({
          publicId: img.publicId || '',
          url: img.url || '',
          alt: img.alt || '',
          slot: Number.isInteger(Number(img.slot)) ? Number(img.slot) : index,
        }))
        .slice(0, 6)
        .sort((a, b) => a.slot - b.slot)
        .map((img, index) => ({ ...img, slot: index }));

      state.galleryDraftSlots = cloneGallerySlots(buildGallerySlots(state.galleryImages));
      state.galleryPendingReplacements = {};
      clearGalleryDirty();
      state.galleryRefreshQueued = false;

      renderGalleryManager();
    } catch (error) {
      setStatus(error?.message || 'Failed to load gallery manager', 'error');
    } finally {
      state.galleryLoading = false;
      updateGalleryActionButtons();
    }
  }

  function updateGalleryAlt(slotIndex, value) {
    const image = state.galleryDraftSlots[slotIndex];
    if (!image) return;
    image.alt = String(value || '').trim();
    markGalleryDirty();
  }

  function moveGalleryImage(slotIndex, delta) {
    const target = slotIndex + delta;
    if (target < 0 || target >= state.galleryDraftSlots.length) return;

    const clone = cloneGallerySlots(state.galleryDraftSlots);
    const temp = clone[slotIndex];
    clone[slotIndex] = clone[target];
    clone[target] = temp;
    state.galleryDraftSlots = clone.map((img, index) => ({ ...img, slot: index, isPlaceholder: !img.publicId }));
    markGalleryDirty();
    renderGalleryManager();
  }

  function stageGalleryReplacement(slotIndex, inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return;
    state.galleryPendingReplacements[slotIndex] = file;
    markGalleryDirty();
    renderGalleryManager();
    setStatus(`Replacement selected for slot ${slotIndex + 1}. Click Save Order & Alt Text to apply.`, 'info');
  }

  function cancelGalleryChanges() {
    if (state.galleryUploading || state.gallerySaving || state.galleryLoading) return;

    state.galleryDraftSlots = cloneGallerySlots(buildGallerySlots(state.galleryImages));
    state.galleryPendingReplacements = {};
    clearGalleryDirty();

    const input = container.querySelector('#galleryFilesInput');
    if (input) input.value = '';

    renderGalleryManager();
    setStatus('Gallery changes discarded.', 'info');
  }

  async function uploadSelectedGalleryImages() {
    const input = container.querySelector('#galleryFilesInput');
    const files = input?.files ? Array.from(input.files) : [];
    if (state.galleryDirty) {
      setStatus('Save or cancel current gallery changes before uploading new images.', 'error');
      return;
    }

    if (!files.length) {
      setStatus('Select at least one gallery image to upload.', 'error');
      return;
    }

    const available = state.galleryDraftSlots.filter((item) => !item.publicId).length;
    if (files.length > available) {
      setStatus(`Only ${available} gallery slots are currently available.`, 'error');
      return;
    }

    const formData = new FormData();
    formData.append('mode', 'add');
    files.forEach((file) => formData.append('photos', file));

    state.galleryUploading = true;
    updateGalleryActionButtons();
    try {
      const { res, data } = await requestJson('/api/admin/gallery', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });

      if (!res.ok) {
        setStatus(formatApiError(data, 'Gallery upload failed'), 'error');
        return;
      }

      if (input) input.value = '';
      setStatus('Gallery images uploaded.', 'success');
      showToast('Gallery images uploaded.', 'success');
      await loadGalleryManager({ force: true });
    } catch (error) {
      setStatus(error?.message || 'Gallery upload failed', 'error');
    } finally {
      state.galleryUploading = false;
      updateGalleryActionButtons();
    }
  }

  async function deleteGalleryImage(publicId) {
    if (state.galleryDirty || hasPendingGalleryUploadSelection()) {
      setStatus('Save or cancel gallery changes before deleting an image.', 'error');
      return;
    }

    if (!publicId) return;
    if (!window.confirm('Delete this gallery image?')) return;

    const { res, data } = await requestJson('/api/admin/gallery', {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ publicId }),
    });

    if (!res.ok) {
      setStatus(formatApiError(data, 'Failed to delete gallery image'), 'error');
      return;
    }

    setStatus('Gallery image deleted.', 'success');
    await loadGalleryManager({ force: true });
  }

  async function saveGalleryMeta() {
    if (state.gallerySaving || state.galleryUploading || state.galleryLoading) return;
    if (!state.galleryDirty) {
      setStatus('No gallery changes to save.', 'info');
      return;
    }

    state.gallerySaving = true;
    updateGalleryActionButtons();
    try {
      const replacementEntries = Object.entries(state.galleryPendingReplacements || {});
      for (const [slotKey, file] of replacementEntries) {
        const slot = Number(slotKey);
        const draftItem = state.galleryDraftSlots[slot] || galleryPlaceholder(slot);

        const formData = new FormData();
        formData.append('mode', 'replace');
        formData.append('slot', String(slot));
        formData.append('alt', String(draftItem.alt || '').trim());
        formData.append('photo', file);

        const replaceResult = await requestJson('/api/admin/gallery', {
          method: 'POST',
          headers: authHeaders(),
          body: formData,
        });

        if (!replaceResult.res.ok) {
          setStatus(formatApiError(replaceResult.data, `Failed to replace gallery image in slot ${slot + 1}`), 'error');
          return;
        }
      }

      const items = state.galleryDraftSlots
        .slice(0, 6)
        .map((img, index) => ({
          publicId: img.publicId,
          slot: index,
          alt: String(img.alt || '').trim(),
        }))
        .filter((img) => img.publicId);

      const { res, data } = await requestJson('/api/admin/gallery', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ items }),
      });

      if (!res.ok) {
        setStatus(formatApiError(data, 'Failed to save gallery order and alt text'), 'error');
        return;
      }

      setStatus('Gallery order and alt text saved.', 'success');
      showToast('Gallery saved.', 'success');
      await loadGalleryManager({ force: true });
    } catch (error) {
      setStatus(error?.message || 'Failed to save gallery order and alt text', 'error');
    } finally {
      state.gallerySaving = false;
      updateGalleryActionButtons();
    }
  }

  container.querySelector('#refreshGalleryBtn').addEventListener('click', () => loadGalleryManager({ force: false }));
  container.querySelector('#uploadGalleryBtn').addEventListener('click', uploadSelectedGalleryImages);
  container.querySelector('#saveGalleryBtn').addEventListener('click', saveGalleryMeta);
  container.querySelector('#cancelGalleryChangesBtn').addEventListener('click', cancelGalleryChanges);
  container.querySelector('#galleryFilesInput').addEventListener('change', () => {
    if (container.querySelector('#galleryFilesInput').files?.length) {
      setStatus('Gallery files selected. Upload to apply or cancel to discard.', 'info');
    }
    updateGalleryActionButtons();
  });

  await loadGalleryManager({ force: true });
}
