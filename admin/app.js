import { getToken, clearToken, login, onUnauthorized, getDashboard } from './api-client.js';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard', kind: 'dashboard' }],
  },
  {
    label: 'Website content',
    items: [
      { key: 'homepage', label: 'Homepage', kind: 'content', contentKey: 'homepage', previewPath: '/index.html' },
      { key: 'branding', label: 'Branding', kind: 'content', contentKey: 'branding', previewPath: '/index.html' },
      { key: 'navigation', label: 'Navigation', kind: 'content', contentKey: 'navigation', previewPath: '/index.html' },
      { key: 'footer', label: 'Footer', kind: 'content', contentKey: 'footer', previewPath: '/index.html' },
      { key: 'faq', label: 'FAQ', kind: 'content', contentKey: 'faq', previewPath: '/index.html#faq' },
    ],
  },
  {
    label: 'Products & photos',
    items: [
      { key: 'products', label: 'Nail Sets (all categories)', kind: 'operational' },
      { key: 'gallery', label: 'Homepage Gallery', kind: 'operational' },
    ],
  },
  {
    label: 'Coming in Phase 2',
    items: [
      { key: 'order-page', label: 'Order Page', kind: 'disabled' },
      { key: 'category-chrome', label: 'Chrome', kind: 'disabled' },
      { key: 'category-french-tips', label: 'French Tips', kind: 'disabled' },
      { key: 'category-cateye', label: 'Cateye', kind: 'disabled' },
      { key: 'category-3d-art', label: '3D Art', kind: 'disabled' },
      { key: 'settings', label: 'Settings', kind: 'disabled' },
    ],
  },
];

const NAV_ITEMS_BY_KEY = new Map(
  NAV_GROUPS.flatMap((group) => group.items).map((item) => [item.key, item]),
);

const MODULE_LOADERS = {
  homepage: () => import('./sections/homepage.js'),
  branding: () => import('./sections/branding.js'),
  navigation: () => import('./sections/navigation.js'),
  footer: () => import('./sections/footer.js'),
  faq: () => import('./sections/faq.js'),
  products: () => import('./sections/products.js'),
  gallery: () => import('./sections/gallery.js'),
};

const loginCard = document.getElementById('loginCard');
const shell = document.getElementById('adminShell');
const sidebarEl = document.getElementById('sidebar');
const contentAreaEl = document.getElementById('contentArea');
const topbarActionsEl = document.getElementById('topbarActions');
const toastEl = document.getElementById('toast');
const loginStatusEl = document.getElementById('loginStatusMessage');

let currentKey = '';
let currentController = null;

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
  currentKey = '';
  showLogin();
}

onUnauthorized(() => {
  showToast('Session expired. Please log in again.', 'error');
  doLogout();
});

function renderSidebar() {
  sidebarEl.innerHTML = NAV_GROUPS.map((group) => `
    <div class="sidebar-group">
      <div class="sidebar-group-label">${group.label}</div>
      ${group.items.map((item) => `
        <button
          type="button"
          class="sidebar-link${item.kind === 'disabled' ? ' disabled' : ''}"
          data-key="${item.key}"
          ${item.kind === 'disabled' ? 'disabled title="Coming in a later phase"' : ''}
        >${item.label}</button>
      `).join('')}
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
    return window.confirm('You have unsaved changes on this page. Leave without saving?');
  }
  return true;
}

function renderTopbarActions(item) {
  if (!item || item.kind !== 'content') {
    topbarActionsEl.innerHTML = '';
    return;
  }

  topbarActionsEl.innerHTML = `
    <button type="button" class="btn btn-secondary" id="actionPreview">Preview</button>
    <button type="button" class="btn btn-secondary" id="actionCancel">Cancel Changes</button>
    <button type="button" class="btn btn-secondary" id="actionSaveDraft">Save Draft</button>
    <button type="button" class="btn" id="actionPublish">Publish</button>
  `;

  document.getElementById('actionPreview').addEventListener('click', () => {
    const token = getToken();
    const separator = item.previewPath.includes('?') ? '&' : '?';
    window.open(`${item.previewPath}${separator}preview=1&token=${encodeURIComponent(token)}`, '_blank', 'noopener');
  });

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
    const rows = sections
      .filter((section) => NAV_ITEMS_BY_KEY.has(section.key) || section.key.startsWith('category-') || section.key === 'order-page')
      .map((section) => {
        const navItem = NAV_ITEMS_BY_KEY.get(section.key);
        const label = navItem ? navItem.label : section.key;
        const editable = navItem && navItem.kind !== 'disabled';
        return `
          <div class="row dashboard-row">
            <div style="font-weight:700;">${label}</div>
            <div class="small">${section.isSeeded ? '' : 'Not migrated yet'}</div>
            <div>${section.hasUnpublishedChanges ? '<span class="badge draft">Unpublished changes</span>' : '<span class="badge published">Up to date</span>'}</div>
            <div class="small">Draft saved: ${section.draftUpdatedAt ? new Date(section.draftUpdatedAt).toLocaleString() : '—'}</div>
            <div class="small">Published: ${section.publishedUpdatedAt ? new Date(section.publishedUpdatedAt).toLocaleString() : '—'}</div>
            <div>${editable ? `<button class="btn btn-secondary" data-goto="${section.key}">Edit</button>` : ''}</div>
          </div>
        `;
      })
      .join('');

    container.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>Welcome back</h2></div>
        <p class="muted">This is your private control panel for Nail It By K. Pick a section from the left to edit it. Every content page has its own Save Draft / Preview / Publish so you can review changes before your visitors see them.</p>
      </div>
      <div class="card">
        <div class="section-title"><h2>Section status</h2></div>
        <div class="dashboard-list">${rows || '<p class="muted">No sections found.</p>'}</div>
      </div>
    `;

    container.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-goto')));
    });
  } catch (error) {
    container.innerHTML = `<div class="status error">${error.message || 'Failed to load dashboard'}</div>`;
  }
}

async function mountSection(key) {
  const item = NAV_ITEMS_BY_KEY.get(key);
  if (!item || item.kind === 'disabled') return;

  contentAreaEl.innerHTML = '';
  currentController = null;
  renderTopbarActions(item);

  if (item.kind === 'dashboard') {
    await renderDashboard(contentAreaEl);
    return;
  }

  const loader = MODULE_LOADERS[key];
  if (!loader) {
    contentAreaEl.innerHTML = '<div class="status error">This section is not available yet.</div>';
    return;
  }

  try {
    const module = await loader();
    const controller = await module.mount(contentAreaEl, { showToast });
    if (item.kind === 'content' && controller) {
      currentController = controller;
      // Re-render the topbar action handlers now that the controller exists
      // (the buttons were built before mount() finished loading data).
      renderTopbarActions(item);
    }
  } catch (error) {
    contentAreaEl.innerHTML = `<div class="status error">${error.message || 'Failed to load this section'}</div>`;
  }
}

function navigateTo(key) {
  if (!NAV_ITEMS_BY_KEY.has(key) || key === currentKey) return;
  if (!confirmDiscardIfDirty()) return;

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
  const initialKey = window.location.hash.replace('#', '') || 'dashboard';
  currentKey = NAV_ITEMS_BY_KEY.has(initialKey) ? initialKey : 'dashboard';
  setActiveSidebarLink(currentKey);
  mountSection(currentKey);
}

boot();
