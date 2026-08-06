import { requestJson, authHeaders, escapeHtml, formatApiError, uploadFiles } from '../api-client.js';

export async function mount(container, ctx) {
  const showToast = ctx?.showToast || (() => {});

  const state = {
    products: [],
    unassignedAssets: [],
    editingId: '',
    images: [],
    removeImagePublicIds: [],
    selectedMainPublicId: '',
  };

  container.innerHTML = `
    <div class="card">
      <div id="productStatusMessage" class="status info" role="status" aria-live="polite"></div>
      <div class="section-title">
        <h2 id="formTitle">Add New Nail Set</h2>
        <button id="cancelEditBtn" class="btn btn-secondary" style="display:none;" type="button">Cancel Edit</button>
      </div>

      <form id="productForm" novalidate>
        <input id="productId" type="hidden">
        <div class="grid">
          <div class="field"><label for="productTitle">Title</label><input id="productTitle" type="text" required></div>
          <div class="field"><label for="productCategory">Category</label>
            <select id="productCategory">
              <option>Chrome</option>
              <option>French Tips</option>
              <option>Cateye</option>
              <option>3D Art</option>
            </select>
          </div>
          <div class="field"><label for="productPrice">Price</label><input id="productPrice" type="text" placeholder="QAR 130"></div>
          <div class="field"><label for="productStatus">Status</label>
            <select id="productStatus"><option value="published">Published</option><option value="draft">Draft</option></select>
          </div>
        </div>
        <div class="field"><label for="productShortDescription">Short Description</label><textarea id="productShortDescription"></textarea></div>
        <div class="field"><label for="productFullDescription">Full Description (optional)</label><textarea id="productFullDescription"></textarea></div>
        <div class="field"><label><input id="isCategoryCover" type="checkbox"> Set as homepage category cover</label></div>

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
          <button class="btn" id="newProductBtn2" type="button">Add New Nail Set</button>
        </div>
      </form>
    </div>

    <div class="card">
      <div class="section-title">
        <h2>Product Library</h2>
        <button id="refreshBtn" class="btn btn-secondary" type="button">Refresh</button>
      </div>

      <div class="controls">
        <input id="searchInput" placeholder="Search title or description">
        <select id="filterCategory">
          <option value="all">All Categories</option>
          <option>Chrome</option>
          <option>French Tips</option>
          <option>Cateye</option>
          <option>3D Art</option>
        </select>
        <select id="filterStatus">
          <option value="all">All Statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <select id="sortBy">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="alpha">A to Z</option>
        </select>
        <button id="applyFiltersBtn" class="btn btn-secondary" type="button">Apply</button>
      </div>

      <div class="table-head">
        <div>Image</div><div>Title</div><div>Category</div><div>Price</div><div>Status</div><div>Cover</div><div>Created</div><div>Actions</div>
      </div>
      <div id="productsList"></div>
    </div>

    <div class="card">
      <div class="section-title">
        <h2>Unassigned Uploads</h2>
        <button id="refreshUnassignedBtn" class="btn btn-secondary" type="button">Refresh</button>
      </div>
      <p class="muted" style="margin-bottom:10px;">These are uploaded images not attached to any saved product yet.</p>
      <div id="unassignedAssetsList"></div>
    </div>
  `;

  const statusMessage = container.querySelector('#productStatusMessage');

  function setStatus(message, type = 'info') {
    statusMessage.textContent = message || '';
    statusMessage.className = `status ${type}`;
  }

  function productBadgeStatus(status) {
    return status === 'draft' ? '<span class="badge draft">Draft</span>' : '<span class="badge published">Published</span>';
  }

  function renderProducts() {
    const el = container.querySelector('#productsList');
    if (!state.products.length) {
      el.innerHTML = '<p class="muted" style="padding:12px 0;">No products found.</p>';
      return;
    }

    el.innerHTML = state.products.map((product) => {
      const thumb = product.mainImageUrl || product.images?.[0]?.url || 'brand_assets/nail logo.jpg';
      const created = product.createdAt ? new Date(product.createdAt).toLocaleDateString() : '-';
      const id = escapeHtml(product.id || '');
      return `
        <div class="row">
          <div><img class="thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(product.title)}"></div>
          <div>
            <div style="font-weight:700;">${escapeHtml(product.title || 'Untitled')}</div>
            <div class="small">${escapeHtml(product.shortDescription || '')}</div>
          </div>
          <div>${escapeHtml(product.category || '-')}</div>
          <div>${escapeHtml(product.price || '-')}</div>
          <div>${productBadgeStatus(product.status)}</div>
          <div>${product.isCategoryCover ? '<span class="badge cover">Cover</span>' : '-'}</div>
          <div class="small">${escapeHtml(created)}</div>
          <div class="actions">
            <button class="btn btn-secondary" type="button" data-action="edit" data-id="${id}">Edit</button>
            <button class="btn btn-secondary" type="button" data-action="duplicate" data-id="${id}">Duplicate</button>
            <button class="btn btn-secondary" type="button" data-action="toggle-status" data-id="${id}" data-next="${product.status === 'published' ? 'draft' : 'published'}">${product.status === 'published' ? 'Unpublish' : 'Publish'}</button>
            <button class="btn btn-secondary" type="button" data-action="set-cover" data-id="${id}">Set Cover</button>
            <button class="btn btn-danger" type="button" data-action="delete" data-id="${id}">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function loadProducts() {
    const search = container.querySelector('#searchInput').value.trim();
    const category = container.querySelector('#filterCategory').value;
    const status = container.querySelector('#filterStatus').value;
    const sort = container.querySelector('#sortBy').value;

    const query = new URLSearchParams({ search, category, status, sort });
    const { res, data } = await requestJson(`/api/admin/products?${query.toString()}`, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      setStatus(formatApiError(data, 'Failed to load products'), 'error');
      return;
    }

    state.products = data.products || [];
    renderProducts();
  }

  function resetForm() {
    state.editingId = '';
    state.images = [];
    state.removeImagePublicIds = [];
    state.selectedMainPublicId = '';

    container.querySelector('#productId').value = '';
    container.querySelector('#productTitle').value = '';
    container.querySelector('#productCategory').value = 'Chrome';
    container.querySelector('#productPrice').value = '';
    container.querySelector('#productStatus').value = 'published';
    container.querySelector('#productShortDescription').value = '';
    container.querySelector('#productFullDescription').value = '';
    container.querySelector('#isCategoryCover').checked = false;
    container.querySelector('#mainImageFile').value = '';
    container.querySelector('#additionalImageFiles').value = '';
    container.querySelector('#formTitle').textContent = 'Add New Nail Set';
    container.querySelector('#cancelEditBtn').style.display = 'none';
    renderImages();
  }

  function startEdit(id) {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;

    state.editingId = product.id;
    state.images = (product.images || []).map((img, index) => ({ ...img, order: index }));
    state.selectedMainPublicId = product.mainImagePublicId || product.images?.[0]?.publicId || '';
    state.removeImagePublicIds = [];

    container.querySelector('#productId').value = product.id;
    container.querySelector('#productTitle').value = product.title || '';
    container.querySelector('#productCategory').value = product.category || 'Chrome';
    container.querySelector('#productPrice').value = product.price || '';
    container.querySelector('#productStatus').value = product.status || 'published';
    container.querySelector('#productShortDescription').value = product.shortDescription || '';
    container.querySelector('#productFullDescription').value = product.fullDescription || '';
    container.querySelector('#isCategoryCover').checked = Boolean(product.isCategoryCover);
    container.querySelector('#mainImageFile').value = '';
    container.querySelector('#additionalImageFiles').value = '';
    container.querySelector('#formTitle').textContent = `Edit: ${product.title}`;
    container.querySelector('#cancelEditBtn').style.display = 'inline-flex';
    renderImages();
    setStatus(`Editing ${product.title}`, 'info');
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderImages() {
    const list = container.querySelector('#imagesList');
    if (!state.images.length) {
      list.innerHTML = '<p class="muted">No images yet. Upload a main image to create this product.</p>';
      return;
    }

    list.innerHTML = state.images.map((img, index) => `
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

    list.querySelectorAll('input[name="mainImageRadio"]').forEach((el) => {
      el.addEventListener('change', () => {
        state.selectedMainPublicId = el.value;
      });
    });
  }

  function moveImage(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.images.length) return;
    const clone = [...state.images];
    const temp = clone[index];
    clone[index] = clone[target];
    clone[target] = temp;
    state.images = clone.map((img, i) => ({ ...img, order: i }));
    renderImages();
  }

  function removeImageAt(index) {
    const removed = state.images[index];
    if (!removed) return;
    state.images.splice(index, 1);
    if (removed.publicId) state.removeImagePublicIds.push(removed.publicId);
    if (state.selectedMainPublicId === removed.publicId) {
      state.selectedMainPublicId = state.images[0]?.publicId || '';
    }
    state.images = state.images.map((img, i) => ({ ...img, order: i }));
    renderImages();
  }

  async function saveProduct(forceStatus) {
    try {
      setStatus('Saving product...', 'info');
      const id = container.querySelector('#productId').value.trim();
      const title = container.querySelector('#productTitle').value.trim();
      const category = container.querySelector('#productCategory').value;
      const price = container.querySelector('#productPrice').value.trim();
      const shortDescription = container.querySelector('#productShortDescription').value.trim();
      const fullDescription = container.querySelector('#productFullDescription').value.trim();
      const status = forceStatus || container.querySelector('#productStatus').value;
      const isCategoryCover = container.querySelector('#isCategoryCover').checked;

      if (!title) {
        setStatus('Title is required', 'error');
        return;
      }

      const mainImageFiles = container.querySelector('#mainImageFile').files;
      const additionalImageFiles = container.querySelector('#additionalImageFiles').files;

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
        id,
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
        await loadUnassignedAssets();
        return;
      }

      setStatus(isEdit ? 'Product updated.' : 'Product created.', 'success');
      showToast(isEdit ? 'Product updated.' : 'Product created.', 'success');
      resetForm();
      await loadProducts();
      await loadUnassignedAssets();
    } catch (error) {
      console.error('[admin] save failed', error);
      setStatus(error.message || 'Save failed', 'error');
      await loadUnassignedAssets();
    }
  }

  async function duplicateProduct(id) {
    const { res, data } = await requestJson('/api/admin/products', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'duplicate', id }),
    });
    if (!res.ok) {
      setStatus(formatApiError(data, 'Duplicate failed'), 'error');
      return;
    }
    setStatus('Product duplicated as draft.', 'success');
    await loadProducts();
    await loadUnassignedAssets();
  }

  async function toggleStatus(id, status) {
    const { res, data } = await requestJson('/api/admin/products', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) {
      setStatus(formatApiError(data, 'Status update failed'), 'error');
      return;
    }
    setStatus('Status updated.', 'success');
    await loadProducts();
  }

  async function setCover(id) {
    const { res, data } = await requestJson('/api/admin/products', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id, isCategoryCover: true }),
    });
    if (!res.ok) {
      setStatus(formatApiError(data, 'Cover update failed'), 'error');
      return;
    }
    setStatus('Category cover updated.', 'success');
    await loadProducts();
  }

  async function deleteProduct(id) {
    if (!window.confirm('Delete this product and all its images permanently?')) return;
    const { res, data } = await requestJson('/api/admin/products', {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      setStatus(formatApiError(data, 'Delete failed'), 'error');
      return;
    }
    setStatus('Product deleted.', 'success');
    if (state.editingId === id) resetForm();
    await loadProducts();
    await loadUnassignedAssets();
  }

  async function loadUnassignedAssets() {
    const { res, data } = await requestJson('/api/admin/unassigned', {
      headers: authHeaders(),
    });

    if (!res.ok) {
      setStatus(formatApiError(data, 'Failed to load unassigned assets'), 'error');
      return;
    }

    state.unassignedAssets = data.assets || [];
    renderUnassignedAssets();
  }

  function renderUnassignedAssets() {
    const list = container.querySelector('#unassignedAssetsList');
    if (!list) return;

    if (!state.unassignedAssets.length) {
      list.innerHTML = '<p class="muted">No unassigned images. Great.</p>';
      return;
    }

    list.innerHTML = state.unassignedAssets.map((asset) => {
      const publicId = escapeHtml(asset.publicId || '');
      const date = asset.createdAt ? new Date(asset.createdAt).toLocaleString() : '-';
      return `
        <div class="img-row">
          <img src="${escapeHtml(asset.url)}" alt="Unassigned image">
          <div>
            <div style="font-weight:700;word-break:break-all;">${escapeHtml(asset.publicId)}</div>
            <div class="small">Created: ${escapeHtml(date)}</div>
          </div>
          <div class="img-controls">
            <button class="btn btn-danger" type="button" data-action="delete-unassigned" data-id="${publicId}">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function deleteUnassignedAsset(publicId) {
    if (!publicId) return;
    if (!window.confirm('Delete this unassigned image permanently?')) return;

    const { res, data } = await requestJson('/api/admin/unassigned', {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ publicId }),
    });

    if (!res.ok) {
      setStatus(formatApiError(data, 'Failed to delete unassigned image'), 'error');
      return;
    }

    setStatus('Unassigned image deleted.', 'success');
    await loadUnassignedAssets();
  }

  container.querySelector('#newProductBtn2').addEventListener('click', resetForm);
  container.querySelector('#cancelEditBtn').addEventListener('click', resetForm);
  container.querySelector('#refreshBtn').addEventListener('click', loadProducts);
  container.querySelector('#refreshUnassignedBtn').addEventListener('click', loadUnassignedAssets);
  container.querySelector('#applyFiltersBtn').addEventListener('click', loadProducts);
  container.querySelector('#saveDraftBtn').addEventListener('click', () => saveProduct('draft'));

  container.querySelector('#productForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveProduct();
  });

  container.querySelector('#productsList').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');
    if (action === 'edit') startEdit(id);
    else if (action === 'duplicate') duplicateProduct(id);
    else if (action === 'toggle-status') toggleStatus(id, btn.getAttribute('data-next'));
    else if (action === 'set-cover') setCover(id);
    else if (action === 'delete') deleteProduct(id);
  });

  container.querySelector('#imagesList').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const index = Number(btn.getAttribute('data-index'));
    if (btn.getAttribute('data-action') === 'move-image') moveImage(index, Number(btn.getAttribute('data-delta')));
    else if (btn.getAttribute('data-action') === 'remove-image') removeImageAt(index);
  });

  container.querySelector('#unassignedAssetsList').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="delete-unassigned"]');
    if (!btn) return;
    deleteUnassignedAsset(btn.getAttribute('data-id'));
  });

  setStatus('Loading products...', 'info');
  await loadProducts();
  await loadUnassignedAssets();
  resetForm();
}
