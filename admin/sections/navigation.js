import { getContentSection, saveContentPatch, publishContentSection } from '../api-client.js';
import { createSectionState, escapeHtml, bindField, renderListEditor } from '../section-kit.js';

const CONTENT_KEY = 'navigation';

function itemFields(item) {
  return `
    <div class="field"><label>Label</label><input type="text" data-field="label" maxlength="60" value="${escapeHtml(item.label || '')}"></div>
    <div class="field"><label>Link</label><input type="text" data-field="href" maxlength="300" placeholder="#section or page.html" value="${escapeHtml(item.href || '')}"></div>
    <div class="field"><label><input type="checkbox" data-field="visible" ${item.visible !== false ? 'checked' : ''}> Visible in menu</label></div>
  `;
}

function bindItemRow(rowEl, item, onChange) {
  rowEl.querySelectorAll('[data-field]').forEach((input) => {
    const field = input.getAttribute('data-field');
    input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
      item[field] = input.type === 'checkbox' ? input.checked : input.value;
      onChange();
    });
  });
}

export async function mount(container) {
  const section = await getContentSection(CONTENT_KEY, 'draft');
  const state = createSectionState({ contentKey: CONTENT_KEY, defaultData: section.data || {} });
  state.offerLocalRestore(section.updatedAt);

  function renderForm() {
    const data = state.data;
    container.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>Navigation</h2></div>
        <p class="muted">Controls the top menu (desktop + mobile) shown on every public page.</p>

        <div class="grid">
          <div class="field"><label>Logo text, line 1</label><input type="text" data-bind="logoLine1" maxlength="40"></div>
          <div class="field"><label>Logo text, line 2</label><input type="text" data-bind="logoLine2" maxlength="40"></div>
        </div>

        <div class="field">
          <label>Menu items</label>
          <div id="navItemsEditor"></div>
        </div>

        <div class="grid">
          <div class="field"><label>Call-to-action button label</label><input type="text" data-bind="cta.label" maxlength="60"></div>
          <div class="field"><label>Call-to-action button link</label><input type="text" data-bind="cta.href" maxlength="300"></div>
        </div>
      </div>
    `;

    bindField(container, '[data-bind="logoLine1"]', { get: () => data.logoLine1, set: (v) => state.set('logoLine1', v) });
    bindField(container, '[data-bind="logoLine2"]', { get: () => data.logoLine2, set: (v) => state.set('logoLine2', v) });
    bindField(container, '[data-bind="cta.label"]', {
      get: () => data.cta?.label,
      set: (v) => state.set('cta', { ...(data.cta || {}), label: v }),
    });
    bindField(container, '[data-bind="cta.href"]', {
      get: () => data.cta?.href,
      set: (v) => state.set('cta', { ...(data.cta || {}), href: v }),
    });

    const items = Array.isArray(data.items) ? data.items : [];
    const onItemsChange = () => state.set('items', items);
    renderListEditor({
      container: container.querySelector('#navItemsEditor'),
      items,
      fieldsHtml: itemFields,
      bindRowFields: (rowEl, item) => bindItemRow(rowEl, item, onItemsChange),
      onChange: onItemsChange,
      newItem: () => ({ id: `nav-${Date.now()}`, label: 'New Link', href: '#', visible: true }),
      addLabel: 'Add menu item',
      emptyLabel: 'No menu items yet.',
      minItems: 1,
    });
  }

  renderForm();

  return {
    isDirty: () => state.isDirty(),
    async saveDraft() {
      const patch = state.getPatch();
      await saveContentPatch(CONTENT_KEY, patch);
      state.markClean();
    },
    async publish() {
      await publishContentSection(CONTENT_KEY);
    },
    async reloadFromServer() {
      const fresh = await getContentSection(CONTENT_KEY, 'draft');
      state.reload(fresh.data || {});
      renderForm();
    },
  };
}
