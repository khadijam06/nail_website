import { openProductModal, duplicateProduct, deleteProduct } from '../sections/products.js';
import { createBadgeGroup, positionElementNear, wireHover, clearRegionBadges, prepareIframeDocument } from '../live-editor.js';
import { getToken } from '../api-client.js';

let iframeEl = null;
let currentCategory = '';
let showToast = () => {};

function iframeDoc() { return iframeEl.contentDocument; }
function iframeWin() { return iframeEl.contentWindow; }

function waitForEvent(target, event) {
  return new Promise((resolve) => target.addEventListener(event, resolve, { once: true }));
}

function waitForProductsReady() {
  const win = iframeWin();
  const grid = win.document.getElementById('productsGrid');
  // loadCategoryProducts() runs on the iframe's own DOMContentLoaded and may
  // still be mid-fetch when the iframe's `load` event fires — wait for its
  // explicit completion signal instead of racing it.
  if (grid && !grid.textContent.includes('Loading products')) return Promise.resolve();
  return waitForEvent(win, 'cms:productsready');
}

async function refreshProducts() {
  const win = iframeWin();
  if (typeof win.loadCategoryProducts === 'function') {
    const donePromise = waitForEvent(win, 'cms:productsready');
    win.loadCategoryProducts();
    await donePromise;
  }
  attachCardOverlays();
}

function attachCardOverlays() {
  const doc = iframeDoc();
  const win = iframeWin();
  clearRegionBadges(doc, 'product-cards');

  doc.querySelectorAll('.product-card').forEach((card) => {
    const raw = card.getAttribute('data-product');
    if (!raw) return;
    let product;
    try {
      product = JSON.parse(raw);
    } catch {
      return;
    }

    const badge = createBadgeGroup(doc, 'product-cards', [
      {
        icon: '✎',
        title: 'Edit',
        onClick: () => openProductModal({ mode: 'edit', product, defaultCategory: currentCategory, onSaved: refreshProducts }),
      },
      {
        icon: '⧉',
        title: 'Duplicate',
        onClick: async () => {
          try {
            await duplicateProduct(product.id, { onSaved: refreshProducts });
            showToast('Product duplicated as draft.', 'success');
          } catch (error) {
            showToast(error.message || 'Duplicate failed', 'error');
          }
        },
      },
      {
        icon: '🗑',
        title: 'Delete',
        danger: true,
        onClick: async () => {
          if (!win.confirm(`Delete "${product.title || 'this nail set'}" and all its images permanently?`)) return;
          try {
            await deleteProduct(product.id, { onSaved: refreshProducts });
            showToast('Product deleted.', 'success');
          } catch (error) {
            showToast(error.message || 'Delete failed', 'error');
          }
        },
      },
    ]);
    wireHover(win, card, badge, () => positionElementNear(win, card, badge, { corner: 'top-right' }));
  });
}

export async function mount(container, ctx) {
  showToast = ctx?.showToast || (() => {});
  currentCategory = ctx?.category || '';
  const pageFile = ctx?.pageFile || 'index.html';

  const toolbar = document.createElement('div');
  toolbar.className = 'cms-toolbar';
  toolbar.innerHTML = `
    <div><strong>${currentCategory}</strong> — this is the real public category page.</div>
    <button type="button" class="btn" id="addNailSetBtn">+ Add New Nail Set</button>
  `;
  container.appendChild(toolbar);
  toolbar.querySelector('#addNailSetBtn').addEventListener('click', () => {
    openProductModal({ mode: 'create', defaultCategory: currentCategory, onSaved: refreshProducts });
  });

  iframeEl = document.createElement('iframe');
  iframeEl.className = 'cms-frame';
  iframeEl.title = `${currentCategory} live editor`;

  const wrap = document.createElement('div');
  wrap.className = 'cms-frame-wrap';
  wrap.appendChild(iframeEl);
  container.appendChild(wrap);

  const token = getToken();
  iframeEl.src = `/${pageFile}?preview=1&token=${encodeURIComponent(token)}`;

  await waitForEvent(iframeEl, 'load');
  prepareIframeDocument(iframeDoc());
  await waitForProductsReady();
  attachCardOverlays();
}
