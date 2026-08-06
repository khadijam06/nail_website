import { escapeHtml } from './api-client.js';

export { escapeHtml };

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cursor = obj;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    const nextKeyLooksLikeIndex = /^\d+$/.test(keys[index + 1]);
    if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') {
      cursor[key] = nextKeyLooksLikeIndex ? [] : {};
    }
    cursor = cursor[key];
  });
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// Shared editing state for every content-backed admin section (Homepage,
// Branding, Navigation, FAQ, Footer, ...). Tracks which *top-level* field
// groups were touched so Save Draft only ever patches what actually changed —
// this is what keeps one open tab's edits from clobbering another's.
export function createSectionState({ contentKey, defaultData = {} }) {
  let working = clone(defaultData) || {};
  const dirtyKeys = new Set();
  const snapshotStorageKey = `admin:draft-snapshot:${contentKey}`;

  function readSnapshot() {
    try {
      const raw = localStorage.getItem(snapshotStorageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeSnapshot() {
    try {
      localStorage.setItem(snapshotStorageKey, JSON.stringify({
        data: working,
        dirtyKeys: Array.from(dirtyKeys),
        savedAt: new Date().toISOString(),
      }));
    } catch {
      // localStorage unavailable/full — the server draft remains the source of truth
    }
  }

  function clearSnapshot() {
    try {
      localStorage.removeItem(snapshotStorageKey);
    } catch {
      // ignore
    }
  }

  return {
    get data() {
      return working;
    },
    get(path) {
      return getPath(working, path);
    },
    set(path, value) {
      setPath(working, path, value);
      dirtyKeys.add(path.split('.')[0]);
      writeSnapshot();
    },
    isDirty() {
      return dirtyKeys.size > 0;
    },
    getPatch() {
      const patch = {};
      dirtyKeys.forEach((key) => {
        patch[key] = working[key];
      });
      return patch;
    },
    markClean() {
      dirtyKeys.clear();
      clearSnapshot();
    },
    reload(freshData) {
      working = clone(freshData) || {};
      dirtyKeys.clear();
      clearSnapshot();
    },
    // Called once after the initial server load. If a newer unsaved snapshot
    // exists locally (e.g. the tab was closed/refreshed mid-edit), offers to
    // restore it instead of silently discarding the work.
    offerLocalRestore(serverUpdatedAt) {
      const snapshot = readSnapshot();
      if (!snapshot) return false;
      if (serverUpdatedAt && new Date(snapshot.savedAt) <= new Date(serverUpdatedAt)) {
        clearSnapshot();
        return false;
      }
      const restore = window.confirm(
        'This section has unsaved changes from a previous session (likely from a page refresh). Restore them?',
      );
      if (!restore) {
        clearSnapshot();
        return false;
      }
      working = clone(snapshot.data) || working;
      (snapshot.dirtyKeys || []).forEach((key) => dirtyKeys.add(key));
      return true;
    },
  };
}

export function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export function bindField(container, selector, { get, set, event = 'input', transform }) {
  const node = container.querySelector(selector);
  if (!node) return;
  node.value = get() ?? '';
  node.addEventListener(event, () => {
    const value = transform ? transform(node.value) : node.value;
    set(value);
  });
}

export function bindCheckbox(container, selector, { get, set }) {
  const node = container.querySelector(selector);
  if (!node) return;
  node.checked = Boolean(get());
  node.addEventListener('change', () => set(node.checked));
}

// Generic add/remove/reorder editor for arrays of similarly-shaped objects
// (FAQ items, nav links, hero stats, how-it-works steps, why-us cards, ...).
// `fieldsHtml(item, index)` renders the inner inputs for one row; the caller
// wires those inputs up with bindField/bindCheckbox after each re-render.
export function renderListEditor({
  container,
  items,
  onChange,
  fieldsHtml,
  bindRowFields,
  newItem,
  addLabel = 'Add item',
  emptyLabel = 'No items yet.',
  minItems = 0,
}) {
  container.innerHTML = `
    <div class="list-editor-rows"></div>
    <button type="button" class="btn btn-secondary list-editor-add">${escapeHtml(addLabel)}</button>
  `;

  const rows = container.querySelector('.list-editor-rows');

  function renderRows() {
    if (!items.length) {
      rows.innerHTML = `<p class="muted">${escapeHtml(emptyLabel)}</p>`;
      return;
    }

    rows.innerHTML = items
      .map(
        (item, index) => `
          <div class="list-editor-row" data-index="${index}">
            <div class="list-editor-row-fields">${fieldsHtml(item, index)}</div>
            <div class="list-editor-row-controls">
              <button type="button" class="btn btn-secondary" data-action="up" ${index === 0 ? 'disabled' : ''}>Up</button>
              <button type="button" class="btn btn-secondary" data-action="down" ${index === items.length - 1 ? 'disabled' : ''}>Down</button>
              <button type="button" class="btn btn-danger" data-action="remove" ${items.length <= minItems ? 'disabled' : ''}>Remove</button>
            </div>
          </div>
        `,
      )
      .join('');

    rows.querySelectorAll('.list-editor-row').forEach((rowEl) => {
      const index = Number(rowEl.getAttribute('data-index'));
      if (bindRowFields) bindRowFields(rowEl, items[index], index);

      rowEl.querySelector('[data-action="up"]')?.addEventListener('click', () => {
        if (index === 0) return;
        [items[index - 1], items[index]] = [items[index], items[index - 1]];
        onChange();
        renderRows();
      });
      rowEl.querySelector('[data-action="down"]')?.addEventListener('click', () => {
        if (index === items.length - 1) return;
        [items[index + 1], items[index]] = [items[index], items[index + 1]];
        onChange();
        renderRows();
      });
      rowEl.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
        if (items.length <= minItems) return;
        if (!window.confirm('Remove this item?')) return;
        items.splice(index, 1);
        onChange();
        renderRows();
      });
    });
  }

  container.querySelector('.list-editor-add').addEventListener('click', () => {
    items.push(newItem());
    onChange();
    renderRows();
  });

  renderRows();
}
