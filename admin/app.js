import {
  getToken,
  clearToken,
  login,
  onUnauthorized,
  getDashboard,
  escapeHtml,
  getOrders,
  updateOrderStatus,
  archiveOrder,
} from './api-client.js';
import { fetchUnassignedAssets, deleteUnassignedAsset, closeProductModal } from './sections/products.js';
import * as homepageEditor from './pages/homepage-editor.js';

const DASHBOARD_KEYS = [
  { key: 'homepage', label: 'Homepage' },
  { key: 'navigation', label: 'Navigation' },
  { key: 'footer', label: 'Footer' },
  { key: 'faq', label: 'FAQ' },
  { key: 'branding', label: 'Branding' },
];

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard', kind: 'dashboard' }],
  },
  {
    label: 'Website',
    items: [
      { key: 'homepage', label: 'Homepage', kind: 'live', family: 'homepage-live', scrollTarget: 'top' },
      { key: 'branding', label: 'Branding', kind: 'live', family: 'homepage-live', scrollTarget: 'top', showBranding: true },
      { key: 'navigation', label: 'Navigation', kind: 'live', family: 'homepage-live', scrollTarget: 'top' },
      { key: 'footer', label: 'Footer', kind: 'live', family: 'homepage-live', scrollTarget: 'footer' },
      { key: 'faq', label: 'FAQ', kind: 'live', family: 'homepage-live', scrollTarget: '#faq' },
      { key: 'gallery', label: 'Homepage Gallery', kind: 'live', family: 'homepage-live', scrollTarget: '#gallery' },
    ],
  },
  {
    label: 'Styles',
    items: [
      { key: 'category-chrome', label: 'Chrome', kind: 'category', category: 'Chrome', pageFile: 'styles-chrome.html' },
      { key: 'category-french-tips', label: 'French Tips', kind: 'category', category: 'French Tips', pageFile: 'styles-french-tips.html' },
      { key: 'category-cateye', label: 'Cateye', kind: 'category', category: 'Cateye', pageFile: 'styles-cateye.html' },
      { key: 'category-3d-art', label: '3D Art', kind: 'category', category: '3D Art', pageFile: 'styles-3d-art.html' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { key: 'orders', label: 'Orders', kind: 'orders' },
      { key: 'unassigned', label: 'Unassigned Uploads', kind: 'operational' },
    ],
  },
  {
    label: 'Coming later',
    items: [
      { key: 'order-page', label: 'Order Page', kind: 'disabled' },
      { key: 'settings', label: 'Settings', kind: 'disabled' },
    ],
  },
];

const NAV_ITEMS_BY_KEY = new Map(
  NAV_GROUPS.flatMap((group) => group.items).map((item) => [item.key, item]),
);

const loginCard = document.getElementById('loginCard');
const shell = document.getElementById('adminShell');
const sidebarEl = document.getElementById('sidebar');
const contentAreaEl = document.getElementById('contentArea');
const topbarActionsEl = document.getElementById('topbarActions');
const toastEl = document.getElementById('toast');
const loginStatusEl = document.getElementById('loginStatusMessage');

let currentKey = '';
let currentFamily = '';
let currentController = null;
let orderBadgeCount = 0;

function showToast(message, type = 'info') {
  if (!toastEl) return;
  toastEl.textContent = message || '';
  toastEl.className = `toast toast-${type} visible`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.className = 'toast';
  }, 3200);
}

function setLoginStatus(message, type = 'info') {
  if (!loginStatusEl) return;
  loginStatusEl.textContent = message || '';
  loginStatusEl.className = `status ${type}`;
}

function showApp() {
  loginCard.style.display = 'none';
  shell.style.display = 'flex';
}

function showLogin() {
  loginCard.style.display = 'block';
  shell.style.display = 'none';
}

function doLogout() {
  clearToken();
  currentController = null;
  currentFamily = '';
  currentKey = '';
  showLogin();
}

onUnauthorized(() => {
  showToast('Session expired. Please log in again.', 'error');
  doLogout();
});

async function refreshOrderBadge() {
  try {
    const { newCount = 0 } = await getOrders({ status: 'all', search: '', sort: 'newest' });
    orderBadgeCount = Number(newCount || 0);
  } catch {
    orderBadgeCount = 0;
  }
  // renderSidebar() rebuilds the whole sidebar's innerHTML, which drops the
  // 'active' class on whichever item is currently selected — reapply it so
  // refreshing the badge (e.g. after every order list load) doesn't make
  // the sidebar highlight silently disappear.
  renderSidebar();
  if (currentKey) setActiveSidebarLink(currentKey);
}

function renderSidebar() {
  sidebarEl.innerHTML = NAV_GROUPS.map((group) => `
    <div class="sidebar-group">
      <div class="sidebar-group-label">${group.label}</div>
      ${group.items.map((item) => {
        const label = item.key === 'orders'
          ? `Orders${orderBadgeCount ? ` (${orderBadgeCount})` : ''}`
          : item.label;

        return `
          <button
            type="button"
            class="sidebar-link${item.kind === 'disabled' ? ' disabled' : ''}"
            data-key="${item.key}"
            ${item.kind === 'disabled' ? 'disabled title="Coming in a later phase"' : ''}
          >${label}</button>
        `;
      }).join('')}
    </div>
  `).join('');

  sidebarEl.querySelectorAll('.sidebar-link:not(.disabled)').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-key')));
  });
}

function setActiveSidebarLink(key) {
  sidebarEl.querySelectorAll('.sidebar-link').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-key') === key);
  });
}

function confirmDiscardIfDirty() {
  if (currentController && typeof currentController.isDirty === 'function' && currentController.isDirty()) {
    return window.confirm('You have unsaved changes. Leave without saving?');
  }
  return true;
}

function renderTopbarActions(item) {
  if (!item || item.kind !== 'live') {
    topbarActionsEl.innerHTML = '';
    return;
  }

  topbarActionsEl.innerHTML = `
    <button type="button" class="btn btn-secondary" id="actionCancel">Cancel Changes</button>
    <button type="button" class="btn btn-secondary" id="actionSaveDraft">Save Draft</button>
    <button type="button" class="btn" id="actionPublish">Publish</button>
  `;

  document.getElementById('actionCancel').addEventListener('click', async () => {
    if (!currentController) return;
    if (currentController.isDirty() && !window.confirm('Discard all unsaved changes on this page?')) return;
    await currentController.reloadFromServer();
    showToast('Changes discarded.', 'info');
  });

  document.getElementById('actionSaveDraft').addEventListener('click', async () => {
    if (!currentController) return;
    if (!currentController.isDirty()) {
      showToast('No changes to save.', 'info');
      return;
    }
    try {
      await currentController.saveDraft();
      showToast('Draft saved. Not live yet — use Publish to go live.', 'success');
    } catch (error) {
      showToast(error.message || 'Failed to save draft', 'error');
    }
  });

  document.getElementById('actionPublish').addEventListener('click', async () => {
    if (!currentController) return;
    try {
      if (currentController.isDirty()) {
        await currentController.saveDraft();
      }
      await currentController.publish();
      showToast('Published! Changes are now live.', 'success');
    } catch (error) {
      showToast(error.message || 'Failed to publish', 'error');
    }
  });
}

async function renderDashboard(container) {
  container.innerHTML = '<p class="muted">Loading dashboard...</p>';
  try {
    const sections = await getDashboard();
    const byKey = new Map(sections.map((s) => [s.key, s]));

    const rows = DASHBOARD_KEYS.map(({ key, label }) => {
      const section = byKey.get(key) || {};
      return `
        <div class="row dashboard-row">
          <div style="font-weight:700;">${label}</div>
          <div class="small">${section.isSeeded ? '' : 'Not migrated yet'}</div>
          <div>${section.hasUnpublishedChanges ? '<span class="badge draft">Unpublished changes</span>' : '<span class="badge published">Up to date</span>'}</div>
          <div class="small">Draft saved: ${section.draftUpdatedAt ? new Date(section.draftUpdatedAt).toLocaleString() : '—'}</div>
          <div class="small">Published: ${section.publishedUpdatedAt ? new Date(section.publishedUpdatedAt).toLocaleString() : '—'}</div>
          <div><button class="btn btn-secondary" data-goto="${key}">Edit</button></div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>Welcome back</h2></div>
        <p class="muted">This is your private control panel for Nail It By K. Pick a section from the left — you'll see the real page and can edit it directly. Nothing goes live until you Publish.</p>
      </div>
      <div class="card">
        <div class="section-title"><h2>Section status</h2></div>
        <div class="dashboard-list">${rows}</div>
      </div>
    `;

    container.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-goto')));
    });
  } catch (error) {
    container.innerHTML = `<div class="status error">${error.message || 'Failed to load dashboard'}</div>`;
  }
}

async function renderUnassignedPanel(container) {
  container.innerHTML = `
    <div class="card">
      <div class="section-title">
        <h2>Unassigned Uploads</h2>
        <button class="btn btn-secondary" type="button" id="refreshUnassignedBtn">Refresh</button>
      </div>
      <p class="muted" style="margin-bottom:10px;">Images uploaded but not attached to any saved product yet.</p>
      <div id="unassignedList"></div>
    </div>
  `;

  const listEl = container.querySelector('#unassignedList');

  async function load() {
    listEl.innerHTML = '<p class="muted">Loading...</p>';
    try {
      const assets = await fetchUnassignedAssets();
      if (!assets.length) {
        listEl.innerHTML = '<p class="muted">No unassigned images. Great.</p>';
        return;
      }
      listEl.innerHTML = assets.map((asset) => `
        <div class="img-row">
          <img src="${escapeHtml(asset.url)}" alt="Unassigned image">
          <div>
            <div style="font-weight:700;word-break:break-all;">${escapeHtml(asset.publicId)}</div>
            <div class="small">Created: ${escapeHtml(asset.createdAt ? new Date(asset.createdAt).toLocaleString() : '-')}</div>
          </div>
          <div class="img-controls">
            <button class="btn btn-danger" type="button" data-id="${escapeHtml(asset.publicId)}">Delete</button>
          </div>
        </div>
      `).join('');

      listEl.querySelectorAll('[data-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!window.confirm('Delete this unassigned image permanently?')) return;
          try {
            await deleteUnassignedAsset(btn.getAttribute('data-id'));
            showToast('Image deleted.', 'success');
            load();
          } catch (error) {
            showToast(error.message || 'Delete failed', 'error');
          }
        });
      });
    } catch (error) {
      listEl.innerHTML = `<div class="status error">${error.message || 'Failed to load'}</div>`;
    }
  }

  container.querySelector('#refreshUnassignedBtn').addEventListener('click', load);
  await load();
}

async function mountSection(key) {
  const item = NAV_ITEMS_BY_KEY.get(key);
  if (!item || item.kind === 'disabled') return;

  // The product modal renders into its own document.body-level root (not
  // contentAreaEl), since it needs to float above whichever category page
  // opened it — close it on any navigation so it can't get orphaned.
  closeProductModal();

  if (item.kind === 'live' && item.family === 'homepage-live') {
    if (currentFamily !== 'homepage-live') {
      contentAreaEl.innerHTML = '';
      currentFamily = 'homepage-live';
      renderTopbarActions(item);
      try {
        currentController = await homepageEditor.mount(contentAreaEl, { showToast });
      } catch (error) {
        contentAreaEl.innerHTML = `<div class="status error">${error.message || 'Failed to load the live editor'}</div>`;
        currentFamily = '';
        return;
      }
    }
    homepageEditor.scrollTo(item.scrollTarget);
    homepageEditor.setBrandingPanelVisible(Boolean(item.showBranding), contentAreaEl);
    renderTopbarActions(item);
    return;
  }

  currentFamily = '';
  contentAreaEl.innerHTML = '';
  currentController = null;
  renderTopbarActions(null);

  if (item.kind === 'dashboard') {
    await renderDashboard(contentAreaEl);
    return;
  }

  if (item.kind === 'category') {
    try {
      const module = await import('./pages/category-editor.js');
      await module.mount(contentAreaEl, { showToast, category: item.category, pageFile: item.pageFile });
    } catch (error) {
      contentAreaEl.innerHTML = `<div class="status error">${error.message || 'Failed to load this category'}</div>`;
    }
    return;
  }

  if (item.key === 'orders') {
    await renderOrdersPanel(contentAreaEl);
    return;
  }

  if (item.key === 'unassigned') {
    await renderUnassignedPanel(contentAreaEl);
    return;
  }

  contentAreaEl.innerHTML = '<div class="status error">This section is not available yet.</div>';
}

async function renderOrdersPanel(container) {
  container.innerHTML = `
    <div class="card">
      <div class="section-title">
        <h2>Orders</h2>
      </div>
      <div class="orders-toolbar">
        <input id="ordersSearch" type="search" placeholder="Search by customer, phone, order ID..." aria-label="Search orders">
        <select id="ordersStatusFilter">
          <option value="all">All statuses</option>
          <option value="New">New</option>
          <option value="Reviewing">Reviewing</option>
          <option value="Confirmed">Confirmed</option>
          <option value="In Progress">In Progress</option>
          <option value="Ready">Ready</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select id="ordersSort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      <div id="ordersTableWrap"></div>
      <div id="ordersDetailWrap"></div>
    </div>
  `;

  const ordersTableWrap = container.querySelector('#ordersTableWrap');
  const ordersDetailWrap = container.querySelector('#ordersDetailWrap');
  const searchInput = container.querySelector('#ordersSearch');
  const statusFilter = container.querySelector('#ordersStatusFilter');
  const sortSelect = container.querySelector('#ordersSort');

  let currentOrderId = '';

  function renderStatusBadge(status) {
    const safeStatus = status || 'New';
    const className = safeStatus === 'New' ? 'badge new' : safeStatus === 'Completed' ? 'badge completed' : safeStatus === 'Cancelled' ? 'badge cancelled' : 'badge review';
    return `<span class="${className}">${safeStatus}</span>`;
  }

  function renderOrderDetail(order) {
    if (!order) {
      ordersDetailWrap.innerHTML = '<p class="muted">Select an order to view the full details.</p>';
      return;
    }

    const imageMarkup = (order.images || []).length
      ? `<div class="order-detail-images">${(order.images || []).map((image) => `
          <a class="order-image-link" href="${escapeHtml(image.url)}" target="_blank" rel="noopener noreferrer">
            <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.label || 'Order inspiration')}" />
          </a>
        `).join('')}</div>`
      : '<p class="muted">No inspiration images uploaded.</p>';

    const detail = order.details || {};
    const lines = [
      ['Customer name', order.customerName || detail.customerName || '—'],
      ['Email', order.email || detail.email || '—'],
      ['Phone', order.phone || detail.phone || '—'],
      ['Delivery', order.delivery || detail.delivery || '—'],
      ['Design / category', order.design || detail.design || detail.category || '—'],
      ['Shape', order.shape || detail.shape || '—'],
      ['Length', order.length || detail.length || '—'],
      ['Notes', order.notes || detail.notes || detail.specialRequests || '—'],
    ];

    const statusOptions = ['New', 'Reviewing', 'Confirmed', 'In Progress', 'Ready', 'Completed', 'Cancelled']
      .map((value) => `<option value="${value}" ${value === (order.status || 'New') ? 'selected' : ''}>${value}</option>`)
      .join('');

    ordersDetailWrap.innerHTML = `
      <div class="order-detail">
        <div class="section-title">
          <h3>Order ${escapeHtml(order.orderId || order.id || '')}</h3>
          <div class="order-detail-actions">
            <select id="orderStatusSelect" aria-label="Order status">${statusOptions}</select>
            <button class="btn btn-secondary" type="button" id="archiveOrderBtn">Archive</button>
          </div>
        </div>
        <div class="order-detail-grid">
          <div class="detail-panel">
            <div class="detail-header">Customer</div>
            <div class="detail-list">${lines.map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join('')}</div>
          </div>
          <div class="detail-panel">
            <div class="detail-header">Submission</div>
            <div class="detail-list">
              <div><strong>Order ID:</strong> ${escapeHtml(order.orderId || order.id || '')}</div>
              <div><strong>Date:</strong> ${escapeHtml(order.submittedAt ? new Date(order.submittedAt).toLocaleString() : '—')}</div>
              <div><strong>Status:</strong> ${renderStatusBadge(order.status || 'New')}</div>
              <div><strong>Images:</strong> ${escapeHtml(String(order.imageCount || (order.images || []).length || 0))}</div>
            </div>
          </div>
        </div>
        <div class="detail-panel" style="margin-top:14px;">
          <div class="detail-header">Inspiration / reference pictures</div>
          ${imageMarkup}
        </div>
      </div>
    `;

    const statusSelect = ordersDetailWrap.querySelector('#orderStatusSelect');
    statusSelect.addEventListener('change', async () => {
      try {
        const updated = await updateOrderStatus(order.orderId || order.id, statusSelect.value);
        renderOrderDetail(updated || order);
        // refreshOrderBadge() re-fetches the authoritative "New" count from
        // the server, so there's no need to (and no correct way to) guess
        // the delta here.
        await refreshOrderBadge();
        await loadOrders();
      } catch (error) {
        showToast(error.message || 'Failed to update status', 'error');
      }
    });

    ordersDetailWrap.querySelector('#archiveOrderBtn').addEventListener('click', async () => {
      if (!window.confirm('Archive this order? It will stay stored but be removed from the active list.')) return;
      try {
        await archiveOrder(order.orderId || order.id);
        showToast('Order archived.', 'success');
        await loadOrders();
      } catch (error) {
        showToast(error.message || 'Failed to archive order', 'error');
      }
    });
  }

  async function loadOrders() {
    try {
      const { orders } = await getOrders({
        status: statusFilter.value,
        search: searchInput.value,
        sort: sortSelect.value,
      });

      if (!orders.length) {
        ordersTableWrap.innerHTML = '<p class="muted">No orders match your current filter.</p>';
        ordersDetailWrap.innerHTML = '';
        return;
      }

      if (!currentOrderId || !orders.some((order) => (order.orderId || order.id) === currentOrderId)) {
        currentOrderId = orders[0].orderId || orders[0].id;
      }

      ordersTableWrap.innerHTML = `
        <div class="orders-table">
          <div class="orders-head">
            <span>Order ID</span>
            <span>Customer</span>
            <span>Date</span>
            <span>Phone</span>
            <span>Status</span>
            <span>Images</span>
          </div>
          ${orders.map((order) => `
            <button type="button" class="orders-row ${currentOrderId === (order.orderId || order.id) ? 'selected' : ''}" data-order-id="${escapeHtml(order.orderId || order.id)}">
              <span><strong>${escapeHtml(order.orderId || order.id || '—')}</strong>${order.status === 'New' ? ' <span class="new-dot">New</span>' : ''}</span>
              <span>${escapeHtml(order.customerName || '—')}</span>
              <span>${escapeHtml(order.submittedAt ? new Date(order.submittedAt).toLocaleString() : '—')}</span>
              <span>${escapeHtml(order.phone || '—')}</span>
              <span>${renderStatusBadge(order.status || 'New')}</span>
              <span>${escapeHtml(String(order.imageCount || (order.images || []).length || 0))}</span>
            </button>
          `).join('')}
        </div>
      `;

      const orderRows = [...ordersTableWrap.querySelectorAll('[data-order-id]')];
      orderRows.forEach((btn) => {
        btn.addEventListener('click', async () => {
          currentOrderId = btn.getAttribute('data-order-id');
          const nextOrder = orders.find((order) => (order.orderId || order.id) === currentOrderId) || null;
          renderOrderDetail(nextOrder);
          await loadOrders();
        });
      });

      const selectedOrder = orders.find((order) => (order.orderId || order.id) === currentOrderId) || orders[0];
      renderOrderDetail(selectedOrder);
      refreshOrderBadge();
    } catch (error) {
      ordersTableWrap.innerHTML = `<div class="status error">${escapeHtml(error.message || 'Failed to load orders')}</div>`;
      ordersDetailWrap.innerHTML = '';
    }
  }

  searchInput.addEventListener('input', () => loadOrders());
  statusFilter.addEventListener('change', () => loadOrders());
  sortSelect.addEventListener('change', () => loadOrders());

  await loadOrders();
}

function navigateTo(key) {
  const item = NAV_ITEMS_BY_KEY.get(key);
  if (!item || key === currentKey) return;

  const isSameFamily = Boolean(item.family) && item.family === currentFamily;
  if (!isSameFamily && !confirmDiscardIfDirty()) return;

  currentKey = key;
  setActiveSidebarLink(key);
  window.history.replaceState(null, '', `#${key}`);
  mountSection(key);
}

window.addEventListener('beforeunload', (event) => {
  if (currentController && typeof currentController.isDirty === 'function' && currentController.isDirty()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const password = document.getElementById('adminPassword').value;
  const result = await login(password);
  if (!result.ok) {
    setLoginStatus(result.error || 'Login failed', 'error');
    return;
  }
  setLoginStatus('');
  boot();
});

document.getElementById('adminPassword').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('loginBtn').click();
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  if (!confirmDiscardIfDirty()) return;
  doLogout();
});

function boot() {
  if (!getToken()) {
    showLogin();
    return;
  }
  showApp();
  renderSidebar();
  refreshOrderBadge();
  const initialKey = window.location.hash.replace('#', '') || 'dashboard';
  currentKey = NAV_ITEMS_BY_KEY.has(initialKey) ? initialKey : 'dashboard';
  setActiveSidebarLink(currentKey);
  mountSection(currentKey);
}

boot();
