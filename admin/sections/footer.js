import { getContentSection, saveContentPatch, publishContentSection } from '../api-client.js';
import { createSectionState, escapeHtml, bindField, renderListEditor } from '../section-kit.js';

const CONTENT_KEY = 'footer';

function linkListFields(item) {
  return `
    <div class="field"><label>Label</label><input type="text" data-field="label" maxlength="80" value="${escapeHtml(item.label || '')}"></div>
    <div class="field"><label>Link</label><input type="text" data-field="href" maxlength="300" placeholder="#section, https://..., or page.html" value="${escapeHtml(item.href || '')}"></div>
  `;
}

function bindLinkRow(rowEl, item, onChange) {
  rowEl.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      item[input.getAttribute('data-field')] = input.value;
      onChange();
    });
  });
}

export async function mount(container, ctx) {
  const section = await getContentSection(CONTENT_KEY, 'draft');
  const state = createSectionState({ contentKey: CONTENT_KEY, defaultData: section.data || {} });
  state.offerLocalRestore(section.updatedAt);

  function renderForm() {
    const data = state.data;
    container.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>Footer</h2></div>
        <p class="muted">Text and links shown in the site footer on every page.</p>

        <div class="field">
          <label>Tagline</label>
          <textarea data-bind="tagline" maxlength="400"></textarea>
        </div>
        <div class="field">
          <label>Instagram URL</label>
          <input type="text" data-bind="instagramUrl" maxlength="300">
        </div>

        <div class="field">
          <label>Navigate links</label>
          <div id="navigateLinksEditor"></div>
        </div>

        <div class="field">
          <label>Get in Touch links</label>
          <div id="contactLinksEditor"></div>
        </div>

        <div class="grid">
          <div class="field"><label>Copyright text</label><input type="text" data-bind="copyrightText" maxlength="200"></div>
          <div class="field"><label>"Made with" text</label><input type="text" data-bind="madeWithText" maxlength="120"></div>
        </div>
      </div>
    `;

    bindField(container, '[data-bind="tagline"]', { get: () => data.tagline, set: (v) => state.set('tagline', v) });
    bindField(container, '[data-bind="instagramUrl"]', { get: () => data.instagramUrl, set: (v) => state.set('instagramUrl', v) });
    bindField(container, '[data-bind="copyrightText"]', { get: () => data.copyrightText, set: (v) => state.set('copyrightText', v) });
    bindField(container, '[data-bind="madeWithText"]', { get: () => data.madeWithText, set: (v) => state.set('madeWithText', v) });

    const navigateLinks = Array.isArray(data.navigateLinks) ? data.navigateLinks : [];
    const onNavigateLinksChange = () => state.set('navigateLinks', navigateLinks);
    renderListEditor({
      container: container.querySelector('#navigateLinksEditor'),
      items: navigateLinks,
      fieldsHtml: linkListFields,
      bindRowFields: (rowEl, item) => bindLinkRow(rowEl, item, onNavigateLinksChange),
      onChange: onNavigateLinksChange,
      newItem: () => ({ label: 'New Link', href: '#' }),
      addLabel: 'Add navigate link',
      emptyLabel: 'No navigate links yet.',
    });

    const contactLinks = Array.isArray(data.contactLinks) ? data.contactLinks : [];
    const onContactLinksChange = () => state.set('contactLinks', contactLinks);
    renderListEditor({
      container: container.querySelector('#contactLinksEditor'),
      items: contactLinks,
      fieldsHtml: linkListFields,
      bindRowFields: (rowEl, item) => bindLinkRow(rowEl, item, onContactLinksChange),
      onChange: onContactLinksChange,
      newItem: () => ({ label: 'New Link', href: '#' }),
      addLabel: 'Add contact link',
      emptyLabel: 'No contact links yet.',
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
