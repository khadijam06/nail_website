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

// Shared editing state for every content-backed admin page (Homepage,
// Branding, Navigation, FAQ, Footer live in one shared instance; more pages
// reuse this later). Tracks which *top-level* field groups were touched so
// Save Draft only ever patches what actually changed — this is what keeps
// one open tab's edits from clobbering another's.
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
