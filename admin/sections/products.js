import { requestJson, authHeaders, escapeHtml, formatApiError, uploadFiles } from '../api-client.js';

const CATEGORIES = ['Chrome', 'French Tips', 'Cateye', '3D Art'];

let modalRoot = null;
let modalState = null;

function ensureModalRoot() {
  if (modalRoot) return modalRoot;
  modalRoot = document.createElement('div');
  modalRoot.id = 'productModalRoot';
  document.body.appendChild(modalRoot);
  return modalRoot;
}

export function closeProductModal() {
  if (modalRoot) modalRoot.innerHTML = '';
  modalState = null;
}

function renderImages(state, listEl) {
  if (!state.images.length) {
    listEl.innerHTML = '<p class="muted">No images yet. Upload a main image to create this product.</p>';
    return;
  }

  listEl.innerHTML = state.images.map((img, index) => `
    <div class="img-row">
      <img src="${escapeHtml(img.url)}" alt="Product image ${index + 1}">
      <div>
        <div style="font-weight:700;word-break:break-all;">${escapeHtml(img.publicId)}</div>
        <label class="small"><input type="radio" name="mainImageRadio" value="${escapeHtml(img.publicId)}" ${state.selectedMainPublicId === img.publicId ? 'checked' : ''}> Main image</label>
      </div>
      <div class="img-controls">
        <button class="btn btn-secondary" type="button" data-action="move-image" data-index="${index}" data-delta="-1">Up</button>
        <button class="btn btn-secondary" type="button" data-action="move-image" data-index="${index}" data-delta="1">Down</button>
        <button class="btn btn-danger" type="button" data-action="remove-image" data-index="${index}">Delete</button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('input[name="mainImageRadio"]').forEach((el) => {
    el.addEventListener('change', () => { state.selectedMainPublicId = el.value; });
  });
}

export async function openProductModal({ mode = 'create', product = null, defaultCategory = '', onSaved } = {}) {
  ensureModalRoot();

  const state = {
    editingId: mode === 'edit' && product ? product.id : '',
    images: mode === 'edit' && product ? (product.images || []).map((img, index) => ({ ...img, order: index })) : [],
    removeImagePublicIds: [],
    selectedMainPublicId: mode === 'edit' && product ? (product.mainImagePublicId || product.images?.[0]?.publicId || '') : '',
  };
  modalState = state;

  const categoryOptions = CATEGORIES.map((c) => `<option ${((product?.category || defaultCategory) === c) ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');

  modalRoot.innerHTML = `
    <div class="cms-modal-backdrop" id="productModalBackdrop">
      <div class="cms-modal">
        <div class="section-title">
          <h2>${mode === 'edit' ? `Edit: ${escapeHtml(product?.title || '')}` : 'Add New Nail Set'}</h2>
          <button class="btn btn-secondary" type="button" id="productModalClose">Close</button>
        </div>
        <div id="productModalStatus" class="status info" role="status" aria-live="polite"></div>

        <form id="productModalForm" novalidate>
          <div class="grid">
            <div class="field"><label for="productTitle">Title</label><input id="productTitle" type="text" required value="${escapeHtml(product?.title || '')}"></div>
            <div class="field"><label for="productCategory">Category</label>
              <select id="productCategory">${categoryOptions}</select>
            </div>
            <div class="field"><label for="productPrice">Price</label><input id="productPrice" type="text" placeholder="QAR 130" value="${escapeHtml(product?.price || '')}"></div>
            <div class="field"><label for="productStatus">Status</label>
              <select id="productStatus">
                <option value="published" ${(!product || product.status === 'published') ? 'selected' : ''}>Published</option>
                <option value="draft" ${product?.status === 'draft' ? 'selected' : ''}>Draft</option>
              </select>
            </div>
          </div>
          <div class="field"><label for="productShortDescription">Short Description</label><textarea id="productShortDescription">${escapeHtml(product?.shortDescription || '')}</textarea></div>
          <div class="field"><label for="productFullDescription">Full Description (optional)</label><textarea id="productFullDescription">${escapeHtml(product?.fullDescription || '')}</textarea></div>
          <div class="field"><label><input id="isCategoryCover" type="checkbox" ${product?.isCategoryCover ? 'checked' : ''}> Set as homepage category cover</label></div>

          <div class="grid">
            <div class="field"><label for="mainImageFile">Main Image (optional for edit)</label><input id="mainImageFile" type="file" accept="image/*"></div>
            <div class="field"><label for="additionalImageFiles">Additional Images</label><input id="additionalImageFiles" type="file" accept="image/*" multiple></div>
          </div>

          <div>
            <label>Images (reorder, remove, choose main)</label>
            <div id="imagesList" class="img-list"></div>
          </div>

          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
            <button class="btn" type="submit">Save Product</button>
            <button class="btn btn-secondary" id="saveDraftBtn" type="button">Save as Draft</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const statusEl = modalRoot.querySelector('#productModalStatus');
  function setStatus(message, type = 'info') {
    statusEl.textContent = message || '';
    statusEl.className = `status ${type}`;
  }

  const imagesListEl = modalRoot.querySelector('#imagesList');
  renderImages(state, imagesListEl);

  imagesListEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const index = Number(btn.getAttribute('data-index'));
    if (btn.getAttribute('data-action') === 'move-image') {
      const delta = Number(btn.getAttribute('data-delta'));
      const target = index + delta;
      if (target < 0 || target >= state.images.length) return;
      const clone = [...state.images];
      const temp = clone[index];
      clone[index] = clone[target];
      clone[target] = temp;
      state.images = clone.map((img, i) => ({ ...img, order: i }));
      renderImages(state, imagesListEl);
    } else if (btn.getAttribute('data-action') === 'remove-image') {
      const removed = state.images[index];
      if (!removed) return;
      state.images.splice(index, 1);
      if (removed.publicId) state.removeImagePublicIds.push(removed.publicId);
      if (state.selectedMainPublicId === removed.publicId) {
        state.selectedMainPublicId = state.images[0]?.publicId || '';
      }
      state.images = state.images.map((img, i) => ({ ...img, order: i }));
      renderImages(state, imagesListEl);
    }
  });

  async function saveProduct(forceStatus) {
    try {
      setStatus('Saving product...', 'info');
      const title = modalRoot.querySelector('#productTitle').value.trim();
      const category = modalRoot.querySelector('#productCategory').value;
      const price = modalRoot.querySelector('#productPrice').value.trim();
      const shortDescription = modalRoot.querySelector('#productShortDescription').value.trim();
      const fullDescription = modalRoot.querySelector('#productFullDescription').value.trim();
      const status = forceStatus || modalRoot.querySelector('#productStatus').value;
      const isCategoryCover = modalRoot.querySelector('#isCategoryCover').checked;

      if (!title) {
        setStatus('Title is required', 'error');
        return;
      }

      const mainImageFiles = modalRoot.querySelector('#mainImageFile').files;
      const additionalImageFiles = modalRoot.querySelector('#additionalImageFiles').files;

      let images = [...state.images];

      if (mainImageFiles.length) {
        const uploadedMain = await uploadFiles(mainImageFiles, { folder: 'nailit_gallery' });
        if (!uploadedMain.length) throw new Error('Main image upload returned no file');
        images.unshift(uploadedMain[0]);
        state.selectedMainPublicId = uploadedMain[0].publicId;
      }

      if (additionalImageFiles.length) {
        const uploadedAdditional = await uploadFiles(additionalImageFiles, { folder: 'nailit_gallery' });
        images = images.concat(uploadedAdditional);
      }

      images = images.map((img, index) => ({ ...img, order: index }));
      const mainImagePublicId = state.selectedMainPublicId || images[0]?.publicId || '';

      if (!images.length || !mainImagePublicId) {
        setStatus('At least one image is required', 'error');
        return;
      }

      const payload = {
        id: state.editingId,
        title,
        category,
        price,
        shortDescription,
        fullDescription,
        status,
        isCategoryCover,
        images,
        mainImagePublicId,
        removeImagePublicIds: Array.from(new Set(state.removeImagePublicIds)),
      };

      const isEdit = Boolean(state.editingId);
      const { res, data } = await requestJson('/api/admin/products', {
        method: isEdit ? 'PUT' : 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setStatus(formatApiError(data, 'Save failed'), 'error');
        return;
      }

      setStatus(isEdit ? 'Product updated.' : 'Product created.', 'success');
      closeProductModal();
      if (onSaved) onSaved();
    } catch (error) {
      console.error('[admin] save failed', error);
      setStatus(error.message || 'Save failed', 'error');
    }
  }

  modalRoot.querySelector('#productModalForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveProduct();
  });
  modalRoot.querySelector('#saveDraftBtn').addEventListener('click', () => saveProduct('draft'));
  modalRoot.querySelector('#productModalClose').addEventListener('click', closeProductModal);
  modalRoot.querySelector('#productModalBackdrop').addEventListener('click', (event) => {
    if (event.target.id === 'productModalBackdrop') closeProductModal();
  });
}

export async function duplicateProduct(id, { onSaved } = {}) {
  const { res, data } = await requestJson('/api/admin/products', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: 'duplicate', id }),
  });
  if (!res.ok) {
    throw new Error(formatApiError(data, 'Duplicate failed'));
  }
  if (onSaved) onSaved();
  return data.product;
}

export async function deleteProduct(id, { onSaved } = {}) {
  const { res, data } = await requestJson('/api/admin/products', {
    method: 'DELETE',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    throw new Error(formatApiError(data, 'Delete failed'));
  }
  if (onSaved) onSaved();
  return true;
}

export async function fetchUnassignedAssets() {
  const { res, data } = await requestJson('/api/admin/unassigned', { headers: authHeaders() });
  if (!res.ok) throw new Error(formatApiError(data, 'Failed to load unassigned assets'));
  return data.assets || [];
}

export async function deleteUnassignedAsset(publicId) {
  const { res, data } = await requestJson('/api/admin/unassigned', {
    method: 'DELETE',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ publicId }),
  });
  if (!res.ok) throw new Error(formatApiError(data, 'Failed to delete unassigned image'));
  return true;
}
