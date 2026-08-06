import { getContentSection, saveContentPatch, publishContentSection } from '../api-client.js';
import { createSectionState, escapeHtml, bindField, renderListEditor } from '../section-kit.js';

const CONTENT_KEY = 'faq';

function itemFields(item) {
  return `
    <div class="field"><label>Question</label><input type="text" data-field="question" maxlength="200" value="${escapeHtml(item.question || '')}"></div>
    <div class="field"><label>Answer</label><textarea data-field="answer" maxlength="1000">${escapeHtml(item.answer || '')}</textarea></div>
    <div class="field"><label><input type="checkbox" data-field="visible" ${item.visible !== false ? 'checked' : ''}> Published (visible on site)</label></div>
  `;
}

function bindItemRow(rowEl, item, onChange) {
  rowEl.querySelectorAll('[data-field]').forEach((input) => {
    const field = input.getAttribute('data-field');
    const eventName = input.type === 'checkbox' ? 'change' : 'input';
    input.addEventListener(eventName, () => {
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
        <div class="section-title"><h2>FAQ</h2></div>
        <p class="muted">Manage the questions shown in the FAQ section of the homepage. Unpublished items are saved but hidden from visitors.</p>

        <div class="grid">
          <div class="field"><label>Section tag</label><input type="text" data-bind="tag" maxlength="60"></div>
          <div class="field"><label>Heading (use a new line for a second line)</label><textarea data-bind="heading" maxlength="200"></textarea></div>
        </div>
        <div class="field"><label>Subheading</label><input type="text" data-bind="sub" maxlength="300"></div>

        <div class="field">
          <label>Questions</label>
          <div id="faqItemsEditor"></div>
        </div>
      </div>
    `;

    bindField(container, '[data-bind="tag"]', { get: () => data.tag, set: (v) => state.set('tag', v) });
    bindField(container, '[data-bind="heading"]', { get: () => data.heading, set: (v) => state.set('heading', v) });
    bindField(container, '[data-bind="sub"]', { get: () => data.sub, set: (v) => state.set('sub', v) });

    const items = Array.isArray(data.items) ? data.items : [];
    const onItemsChange = () => state.set('items', items);
    renderListEditor({
      container: container.querySelector('#faqItemsEditor'),
      items,
      fieldsHtml: itemFields,
      bindRowFields: (rowEl, item) => bindItemRow(rowEl, item, onItemsChange),
      onChange: onItemsChange,
      newItem: () => ({
        id: `faq-${Date.now()}`,
        question: 'New question',
        answer: 'Answer goes here.',
        visible: true,
      }),
      addLabel: 'Add question',
      emptyLabel: 'No FAQ items yet.',
    });
  }

  renderForm();

  return {
    isDirty: () => state.isDirty(),
    async saveDraft() {
      const items = Array.isArray(state.data.items) ? state.data.items : [];
      items.forEach((item, index) => { item.order = index; });
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
