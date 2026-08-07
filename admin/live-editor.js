import { escapeHtml } from './section-kit.js';

const OVERLAY_STYLE_ID = 'cms-live-editor-styles';

// Injected into the iframe document (same-origin) so hovered targets and
// badges look right regardless of the public page's own CSS.
const OVERLAY_CSS = `
  .cms-hover-outline { outline: 2px dashed #F5279A !important; outline-offset: 3px; border-radius: 4px; }
  .cms-badge-group {
    position: absolute;
    display: flex;
    gap: 3px;
    z-index: 999999;
    opacity: 0;
    pointer-events: none;
    transition: opacity .12s ease;
  }
  .cms-badge-group.cms-badge-visible { opacity: 1; pointer-events: auto; }
  .cms-edit-badge {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    border: none;
    background: #3b1b35;
    color: #fff;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 10px rgba(0,0,0,.25);
  }
  .cms-edit-badge:hover { background: #F5279A; }
  .cms-hidden-item { opacity: .4; position: relative; }
  .cms-hidden-item::after {
    content: "Hidden";
    position: absolute;
    top: 4px;
    right: 4px;
    background: #3b1b35;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 999px;
    z-index: 999998;
  }
`;

function injectOverlayStyles(iframeDoc) {
  if (iframeDoc.getElementById(OVERLAY_STYLE_ID)) return;
  const style = iframeDoc.createElement('style');
  style.id = OVERLAY_STYLE_ID;
  style.textContent = OVERLAY_CSS;
  iframeDoc.head.appendChild(style);
}

function clearRegionBadges(iframeDoc, regionKey) {
  iframeDoc.querySelectorAll(`[data-cms-region="${CSS.escape(regionKey)}"]`).forEach((el) => el.remove());
}

function createBadgeGroup(iframeDoc, regionKey, buttons) {
  const group = iframeDoc.createElement('div');
  group.className = 'cms-badge-group';
  group.setAttribute('data-cms-region', regionKey);
  buttons.forEach(({ icon, title, onClick, danger }) => {
    const btn = iframeDoc.createElement('button');
    btn.type = 'button';
    btn.className = 'cms-edit-badge';
    if (danger) btn.style.background = '#96253f';
    btn.title = title || '';
    btn.textContent = icon;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event);
    });
    group.appendChild(btn);
  });
  iframeDoc.body.appendChild(group);
  return group;
}

function positionElementNear(iframeWin, target, el, { corner = 'top-right' } = {}) {
  const rect = target.getBoundingClientRect();
  const scrollX = iframeWin.scrollX;
  const scrollY = iframeWin.scrollY;
  let top;
  let left;

  if (corner === 'top-right') {
    top = rect.top + scrollY - 10;
    left = rect.right + scrollX - 16;
  } else if (corner === 'bottom-right') {
    top = rect.bottom + scrollY - 16;
    left = rect.right + scrollX - 16;
  } else if (corner === 'center') {
    top = rect.top + scrollY + rect.height / 2 - 13;
    left = rect.left + scrollX + rect.width / 2 - 13;
  } else {
    top = rect.top + scrollY - 10;
    left = rect.left + scrollX - 10;
  }

  el.style.top = `${Math.max(0, top)}px`;
  el.style.left = `${Math.max(0, left)}px`;
}

function wireHover(iframeWin, target, badgeEl, reposition) {
  let hideTimer = null;
  const show = () => {
    clearTimeout(hideTimer);
    reposition();
    target.classList.add('cms-hover-outline');
    badgeEl.classList.add('cms-badge-visible');
  };
  const scheduleHide = () => {
    hideTimer = setTimeout(() => {
      target.classList.remove('cms-hover-outline');
      badgeEl.classList.remove('cms-badge-visible');
    }, 220);
  };
  target.addEventListener('mouseenter', show);
  target.addEventListener('mouseleave', scheduleHide);
  badgeEl.addEventListener('mouseenter', show);
  badgeEl.addEventListener('mouseleave', scheduleHide);
}

// ── Popover (rendered in the parent admin document) ──

let activePopover = null;
let outsideClickHandler = null;
let escapeHandler = null;
let activeOnClose = null;

export function closePopover() {
  const onClose = activeOnClose;
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
  if (outsideClickHandler) document.removeEventListener('mousedown', outsideClickHandler, true);
  if (escapeHandler) document.removeEventListener('keydown', escapeHandler, true);
  outsideClickHandler = null;
  escapeHandler = null;
  activeOnClose = null;
  if (onClose) onClose();
}

// `onClose` fires once, when the popover is dismissed (X, outside click, or
// Escape) — used by regions that persist to the server as a single request
// rather than live-per-keystroke (e.g. gallery alt text has no draft step).
export function openPopover({ x, y, title, fields, onInput, onClose }) {
  closePopover();
  activeOnClose = onClose || null;

  const panel = document.createElement('div');
  panel.className = 'cms-popover';
  panel.innerHTML = `
    <div class="cms-popover-head">
      <strong>${escapeHtml(title || 'Edit')}</strong>
      <button type="button" class="cms-popover-close" aria-label="Close">×</button>
    </div>
    <div class="cms-popover-body"></div>
  `;

  const body = panel.querySelector('.cms-popover-body');
  fields.forEach((field) => {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    if (field.type === 'checkbox') {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(field.value);
      input.addEventListener('change', () => onInput(field.key, input.checked));
      label.appendChild(input);
      label.appendChild(document.createTextNode(` ${field.label}`));
      wrap.appendChild(label);
    } else {
      const label = document.createElement('label');
      label.textContent = field.label;
      const input = field.type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
      // Plain text input for URLs too — native `type="url"` validation
      // would block the relative/#-anchor links this site uses.
      if (field.type !== 'textarea') input.type = 'text';
      input.value = field.value || '';
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.placeholder) input.placeholder = field.placeholder;
      input.addEventListener('input', () => onInput(field.key, input.value));
      wrap.appendChild(label);
      wrap.appendChild(input);
    }

    body.appendChild(wrap);
  });

  document.body.appendChild(panel);
  panel.style.top = `${Math.max(8, y)}px`;
  panel.style.left = `${Math.max(8, x)}px`;

  requestAnimationFrame(() => {
    const rect = panel.getBoundingClientRect();
    const overflowRight = rect.right - window.innerWidth;
    const overflowBottom = rect.bottom - window.innerHeight;
    if (overflowRight > 0) panel.style.left = `${Math.max(8, x - overflowRight - 16)}px`;
    if (overflowBottom > 0) panel.style.top = `${Math.max(8, y - overflowBottom - 16)}px`;
  });

  panel.querySelector('.cms-popover-close').addEventListener('click', closePopover);

  outsideClickHandler = (event) => {
    if (activePopover && !activePopover.contains(event.target)) closePopover();
  };
  escapeHandler = (event) => {
    if (event.key === 'Escape') closePopover();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', outsideClickHandler, true);
    document.addEventListener('keydown', escapeHandler, true);
  }, 0);

  activePopover = panel;
  panel.querySelector('input, textarea')?.focus();

  return { close: closePopover };
}

function openFieldPopover(iframeEl, target, { title, fields, onInput, onClose }) {
  const iframeRect = iframeEl.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  openPopover({
    x: iframeRect.left + targetRect.right + 10,
    y: iframeRect.top + targetRect.top,
    title,
    fields,
    onInput,
    onClose,
  });
}

// ── Single editable field (heading, paragraph, button label+link, ...) ──
// `onInput(key, value)` fires live on every keystroke; the caller is
// responsible for updating its own state and re-invoking the page's own
// render function (e.g. window.__cmsApply.applyHero) so the change is
// visible immediately — this engine never renders content itself. `onClose`
// (optional) fires once when the popover is dismissed, for regions that
// persist as a single request instead of live-per-keystroke.
export function mountFieldRegion(iframeEl, { selector, regionKey, title, fields, getValues, onInput, onClose }) {
  const iframeDoc = iframeEl.contentDocument;
  const iframeWin = iframeEl.contentWindow;
  clearRegionBadges(iframeDoc, regionKey);

  const target = iframeDoc.querySelector(selector);
  if (!target) return false;

  const badge = createBadgeGroup(iframeDoc, regionKey, [
    {
      icon: '✎',
      title: title || 'Edit',
      onClick: () => {
        const values = getValues();
        openFieldPopover(iframeEl, target, {
          title,
          fields: fields.map((f) => ({ ...f, value: values[f.key] })),
          onInput,
          onClose,
        });
      },
    },
  ]);

  wireHover(iframeWin, target, badge, () => positionElementNear(iframeWin, target, badge, { corner: 'top-right' }));
  return true;
}

// ── Image with a "Replace" badge ──
export function mountImageRegion(iframeEl, { selector, regionKey, label, onReplace }) {
  const iframeDoc = iframeEl.contentDocument;
  const iframeWin = iframeEl.contentWindow;
  clearRegionBadges(iframeDoc, regionKey);

  const target = iframeDoc.querySelector(selector);
  if (!target) return false;

  const badge = createBadgeGroup(iframeDoc, regionKey, [
    {
      icon: '📷',
      title: label || 'Replace Image',
      onClick: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          document.body.removeChild(input);
          if (file) onReplace(file);
        });
        input.click();
      },
    },
  ]);

  wireHover(iframeWin, target, badge, () => positionElementNear(iframeWin, target, badge, { corner: 'center' }));
  return true;
}

// ── Repeating items (FAQ questions, nav links, hero stats, cards, ...) ──
// `getItems()` must return the live array reference the caller mutates.
// After any mutation this calls the single `onChange()` callback, which the
// caller uses to (a) mark the relevant content key dirty, (b) re-invoke the
// page's own render function with the updated array, and (c) call
// mountListRegion again to reattach badges to the fresh DOM — this function
// always clears its own previous badges first, so that's always safe.
export function mountListRegion(iframeEl, {
  containerSelector,
  itemSelector,
  regionKey,
  getItems,
  onChange,
  itemFields,
  itemTitle,
  newItem,
  addLabel = 'Add item',
  minItems = 0,
  allowReorder = true,
  allowDelete = true,
  allowAdd = true,
}) {
  const iframeDoc = iframeEl.contentDocument;
  const iframeWin = iframeEl.contentWindow;
  clearRegionBadges(iframeDoc, regionKey);

  const container = iframeDoc.querySelector(containerSelector);
  if (!container) return false;

  const items = getItems();
  const itemEls = Array.from(container.querySelectorAll(itemSelector));

  itemEls.forEach((itemEl, index) => {
    const item = items[index];
    if (!item) return;

    const buttons = [];
    if (allowReorder) {
      buttons.push({
        icon: '↑',
        title: 'Move up',
        onClick: () => {
          if (index === 0) return;
          [items[index - 1], items[index]] = [items[index], items[index - 1]];
          onChange();
        },
      });
      buttons.push({
        icon: '↓',
        title: 'Move down',
        onClick: () => {
          if (index === items.length - 1) return;
          [items[index + 1], items[index]] = [items[index], items[index + 1]];
          onChange();
        },
      });
    }
    buttons.push({
      icon: '✎',
      title: 'Edit',
      onClick: () => {
        openFieldPopover(iframeEl, itemEl, {
          title: itemTitle ? itemTitle(item, index) : 'Edit item',
          fields: itemFields(item),
          onInput: (key, value) => {
            item[key] = value;
            onChange();
          },
        });
      },
    });
    if (allowDelete) {
      buttons.push({
        icon: '🗑',
        title: 'Delete',
        danger: true,
        onClick: () => {
          if (items.length <= minItems) return;
          if (!iframeWin.confirm('Remove this item?')) return;
          items.splice(index, 1);
          onChange();
        },
      });
    }

    const badge = createBadgeGroup(iframeDoc, regionKey, buttons);
    wireHover(iframeWin, itemEl, badge, () => positionElementNear(iframeWin, itemEl, badge, { corner: 'top-right' }));
  });

  if (allowAdd) {
    const addBadge = createBadgeGroup(iframeDoc, regionKey, [
      {
        icon: '+',
        title: addLabel,
        onClick: () => {
          items.push(newItem());
          onChange();
        },
      },
    ]);
    wireHover(iframeWin, container, addBadge, () => positionElementNear(iframeWin, container, addBadge, { corner: 'bottom-right' }));
  }

  return true;
}

export function prepareIframeDocument(iframeDoc) {
  injectOverlayStyles(iframeDoc);
}

// Exported for bespoke regions (e.g. the homepage gallery grid) that don't
// fit the field/image/list shapes above but still want the same badge
// look-and-feel and hover/position mechanics.
export { clearRegionBadges, createBadgeGroup, positionElementNear, wireHover, openFieldPopover };
