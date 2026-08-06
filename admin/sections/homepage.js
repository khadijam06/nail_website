import { getContentSection, saveContentPatch, publishContentSection } from '../api-client.js';
import { createSectionState, escapeHtml, bindField, renderListEditor } from '../section-kit.js';

const CONTENT_KEY = 'homepage';

function statFields(item) {
  return `
    <div class="field"><label>Value</label><input type="text" data-field="value" maxlength="40" value="${escapeHtml(item.value || '')}"></div>
    <div class="field"><label>Label</label><input type="text" data-field="label" maxlength="60" value="${escapeHtml(item.label || '')}"></div>
  `;
}

function stepFields(item) {
  return `
    <div class="field"><label>Icon (emoji)</label><input type="text" data-field="icon" maxlength="8" value="${escapeHtml(item.icon || '')}"></div>
    <div class="field"><label>Title</label><input type="text" data-field="title" maxlength="80" value="${escapeHtml(item.title || '')}"></div>
    <div class="field"><label>Text</label><textarea data-field="text" maxlength="400">${escapeHtml(item.text || '')}</textarea></div>
  `;
}

function cardFields(item) {
  return `
    <div class="field"><label>Category</label><input type="text" value="${escapeHtml(item.category || '')}" disabled></div>
    <div class="field"><label>Title</label><input type="text" data-field="title" maxlength="60" value="${escapeHtml(item.title || '')}"></div>
    <div class="field"><label>Subtitle</label><input type="text" data-field="subtitle" maxlength="120" value="${escapeHtml(item.subtitle || '')}"></div>
    <div class="field"><label>Link</label><input type="text" data-field="href" maxlength="200" value="${escapeHtml(item.href || '')}"></div>
  `;
}

function marqueeItemFields(item) {
  return `<div class="field"><label>Ticker word</label><input type="text" data-field="value" maxlength="40" value="${escapeHtml(item.value || '')}"></div>`;
}

function bindGenericRow(rowEl, item, onChange) {
  rowEl.querySelectorAll('[data-field]').forEach((input) => {
    const field = input.getAttribute('data-field');
    input.addEventListener('input', () => {
      item[field] = input.value;
      onChange();
    });
  });
}

const TABS = [
  { key: 'hero', label: 'Hero' },
  { key: 'howItWorks', label: 'How It Works' },
  { key: 'stylesSection', label: 'Styles Section' },
  { key: 'whyUs', label: 'Why Us' },
  { key: 'gallerySection', label: 'Gallery Text' },
  { key: 'orderCta', label: 'Order CTA' },
  { key: 'marquee', label: 'Scrolling Ticker' },
];

export async function mount(container, ctx) {
  const section = await getContentSection(CONTENT_KEY, 'draft');
  const state = createSectionState({ contentKey: CONTENT_KEY, defaultData: section.data || {} });
  state.offerLocalRestore(section.updatedAt);

  let activeTab = TABS[0].key;

  function ensureGroup(key) {
    if (!state.data[key] || typeof state.data[key] !== 'object') state.data[key] = {};
    return state.data[key];
  }

  function renderHero(pane) {
    const hero = ensureGroup('hero');
    pane.innerHTML = `
      <div class="grid">
        <div class="field"><label>Announcement pill text</label><input type="text" data-bind="hero.pillText" maxlength="80"></div>
        <div class="field"><label>Pill location text</label><input type="text" data-bind="hero.pillLocation" maxlength="60"></div>
      </div>
      <div class="grid">
        <div class="field"><label>Hero heading</label><input type="text" data-bind="hero.headingLine1" maxlength="100"></div>
        <div class="field"><label>Highlighted heading text</label><input type="text" data-bind="hero.headingEmphasis" maxlength="100"></div>
      </div>
      <div class="field"><label>Hero description</label><textarea data-bind="hero.description" maxlength="500"></textarea></div>
      <div class="grid">
        <div class="field"><label>Primary button label</label><input type="text" data-bind="hero.primaryButton.label" maxlength="60"></div>
        <div class="field"><label>Primary button link</label><input type="text" data-bind="hero.primaryButton.href" maxlength="300"></div>
        <div class="field"><label>Secondary button label</label><input type="text" data-bind="hero.secondaryButton.label" maxlength="60"></div>
        <div class="field"><label>Secondary button link</label><input type="text" data-bind="hero.secondaryButton.href" maxlength="300"></div>
      </div>
      <div class="field"><label>Hero statistics</label><div id="heroStatsEditor"></div></div>
    `;

    ['hero.pillText', 'hero.pillLocation', 'hero.headingLine1', 'hero.headingEmphasis', 'hero.description',
      'hero.primaryButton.label', 'hero.primaryButton.href', 'hero.secondaryButton.label', 'hero.secondaryButton.href']
      .forEach((path) => {
        bindField(pane, `[data-bind="${path}"]`, { get: () => state.get(path), set: (v) => state.set(path, v) });
      });

    const stats = Array.isArray(hero.stats) ? hero.stats : (hero.stats = []);
    const onStatsChange = () => state.set('hero', hero);
    renderListEditor({
      container: pane.querySelector('#heroStatsEditor'),
      items: stats,
      fieldsHtml: statFields,
      bindRowFields: (rowEl, item) => bindGenericRow(rowEl, item, onStatsChange),
      onChange: onStatsChange,
      newItem: () => ({ value: '100%', label: 'New stat' }),
      addLabel: 'Add statistic',
      emptyLabel: 'No statistics yet.',
    });
  }

  function renderHowItWorks(pane) {
    const section = ensureGroup('howItWorks');
    pane.innerHTML = `
      <div class="grid">
        <div class="field"><label>Section tag</label><input type="text" data-bind="howItWorks.tag" maxlength="60"></div>
        <div class="field"><label>Heading</label><input type="text" data-bind="howItWorks.heading" maxlength="120"></div>
      </div>
      <div class="field"><label>Subheading</label><input type="text" data-bind="howItWorks.sub" maxlength="300"></div>
      <div class="field"><label>Steps</label><div id="stepsEditor"></div></div>
    `;
    ['howItWorks.tag', 'howItWorks.heading', 'howItWorks.sub'].forEach((path) => {
      bindField(pane, `[data-bind="${path}"]`, { get: () => state.get(path), set: (v) => state.set(path, v) });
    });

    const steps = Array.isArray(section.steps) ? section.steps : (section.steps = []);
    const onStepsChange = () => state.set('howItWorks', section);
    renderListEditor({
      container: pane.querySelector('#stepsEditor'),
      items: steps,
      fieldsHtml: stepFields,
      bindRowFields: (rowEl, item) => bindGenericRow(rowEl, item, onStepsChange),
      onChange: onStepsChange,
      newItem: () => ({ icon: '✨', title: 'New step', text: 'Describe this step.' }),
      addLabel: 'Add step',
      emptyLabel: 'No steps yet.',
    });
  }

  function renderStyles(pane) {
    const section = ensureGroup('stylesSection');
    pane.innerHTML = `
      <div class="grid">
        <div class="field"><label>Section tag</label><input type="text" data-bind="stylesSection.tag" maxlength="60"></div>
        <div class="field"><label>Heading</label><input type="text" data-bind="stylesSection.heading" maxlength="120"></div>
      </div>
      <div class="field"><label>Subheading</label><input type="text" data-bind="stylesSection.sub" maxlength="300"></div>
      <p class="muted">Card cover images automatically use each category's published nail set cover — manage those from Nail Sets. Title, subtitle and link are edited here.</p>
      <div class="field"><label>Style cards</label><div id="cardsEditor"></div></div>
    `;
    ['stylesSection.tag', 'stylesSection.heading', 'stylesSection.sub'].forEach((path) => {
      bindField(pane, `[data-bind="${path}"]`, { get: () => state.get(path), set: (v) => state.set(path, v) });
    });

    const cards = Array.isArray(section.cards) ? section.cards : (section.cards = []);
    const onCardsChange = () => state.set('stylesSection', section);
    renderListEditor({
      container: pane.querySelector('#cardsEditor'),
      items: cards,
      fieldsHtml: cardFields,
      bindRowFields: (rowEl, item) => bindGenericRow(rowEl, item, onCardsChange),
      onChange: onCardsChange,
      newItem: () => ({ category: '', title: 'New style', subtitle: '', href: '#' }),
      addLabel: 'Add style card',
      emptyLabel: 'No style cards yet.',
      minItems: 1,
    });
  }

  function renderWhyUs(pane) {
    const section = ensureGroup('whyUs');
    pane.innerHTML = `
      <div class="grid">
        <div class="field"><label>Section tag</label><input type="text" data-bind="whyUs.tag" maxlength="60"></div>
        <div class="field"><label>Heading</label><input type="text" data-bind="whyUs.heading" maxlength="120"></div>
      </div>
      <div class="field"><label>Subheading</label><input type="text" data-bind="whyUs.sub" maxlength="300"></div>
      <div class="field"><label>Feature cards</label><div id="whyUsEditor"></div></div>
    `;
    ['whyUs.tag', 'whyUs.heading', 'whyUs.sub'].forEach((path) => {
      bindField(pane, `[data-bind="${path}"]`, { get: () => state.get(path), set: (v) => state.set(path, v) });
    });

    const cards = Array.isArray(section.cards) ? section.cards : (section.cards = []);
    const onWhyUsCardsChange = () => state.set('whyUs', section);
    renderListEditor({
      container: pane.querySelector('#whyUsEditor'),
      items: cards,
      fieldsHtml: stepFields,
      bindRowFields: (rowEl, item) => bindGenericRow(rowEl, item, onWhyUsCardsChange),
      onChange: onWhyUsCardsChange,
      newItem: () => ({ icon: '✨', title: 'New reason', text: 'Describe this.' }),
      addLabel: 'Add feature card',
      emptyLabel: 'No feature cards yet.',
    });
  }

  function renderGalleryText(pane) {
    pane.innerHTML = `
      <div class="grid">
        <div class="field"><label>Section tag</label><input type="text" data-bind="gallerySection.tag" maxlength="60"></div>
        <div class="field"><label>Heading</label><input type="text" data-bind="gallerySection.heading" maxlength="120"></div>
      </div>
      <div class="field"><label>Subheading</label><input type="text" data-bind="gallerySection.sub" maxlength="300"></div>
      <p class="muted">Gallery photos, order and alt text are managed from <strong>Homepage Gallery</strong> in the sidebar.</p>
    `;
    ['gallerySection.tag', 'gallerySection.heading', 'gallerySection.sub'].forEach((path) => {
      bindField(pane, `[data-bind="${path}"]`, { get: () => state.get(path), set: (v) => state.set(path, v) });
    });
  }

  function renderOrderCta(pane) {
    pane.innerHTML = `
      <div class="grid">
        <div class="field"><label>Section tag</label><input type="text" data-bind="orderCta.tag" maxlength="80"></div>
        <div class="field"><label>Heading</label><input type="text" data-bind="orderCta.heading" maxlength="120"></div>
      </div>
      <div class="field"><label>Description</label><textarea data-bind="orderCta.description" maxlength="500"></textarea></div>
      <div class="field"><label>Pill text</label><input type="text" data-bind="orderCta.pillText" maxlength="100"></div>
      <div class="grid">
        <div class="field"><label>Primary button label</label><input type="text" data-bind="orderCta.primaryButton.label" maxlength="60"></div>
        <div class="field"><label>Primary button link</label><input type="text" data-bind="orderCta.primaryButton.href" maxlength="300"></div>
        <div class="field"><label>Secondary link label</label><input type="text" data-bind="orderCta.secondaryLink.label" maxlength="60"></div>
        <div class="field"><label>Secondary link URL</label><input type="text" data-bind="orderCta.secondaryLink.href" maxlength="300"></div>
      </div>
    `;
    ['orderCta.tag', 'orderCta.heading', 'orderCta.description', 'orderCta.pillText',
      'orderCta.primaryButton.label', 'orderCta.primaryButton.href', 'orderCta.secondaryLink.label', 'orderCta.secondaryLink.href']
      .forEach((path) => {
        bindField(pane, `[data-bind="${path}"]`, { get: () => state.get(path), set: (v) => state.set(path, v) });
      });
  }

  function renderMarquee(pane) {
    const marquee = ensureGroup('marquee');
    pane.innerHTML = `
      <p class="muted">Words that scroll across the homepage ticker bar.</p>
      <div id="marqueeEditor"></div>
    `;
    const rawItems = Array.isArray(marquee.items) ? marquee.items : (marquee.items = []);
    // renderListEditor works on objects, so temporarily wrap plain strings
    const wrapped = rawItems.map((value) => ({ value }));
    const onMarqueeChange = () => {
      marquee.items = wrapped.map((w) => w.value);
      state.set('marquee', marquee);
    };
    renderListEditor({
      container: pane.querySelector('#marqueeEditor'),
      items: wrapped,
      fieldsHtml: marqueeItemFields,
      bindRowFields: (rowEl, item) => bindGenericRow(rowEl, item, onMarqueeChange),
      onChange: onMarqueeChange,
      newItem: () => ({ value: 'New Word' }),
      addLabel: 'Add ticker word',
      emptyLabel: 'No ticker words yet.',
      minItems: 1,
    });
  }

  const TAB_RENDERERS = {
    hero: renderHero,
    howItWorks: renderHowItWorks,
    stylesSection: renderStyles,
    whyUs: renderWhyUs,
    gallerySection: renderGalleryText,
    orderCta: renderOrderCta,
    marquee: renderMarquee,
  };

  function renderForm() {
    container.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>Homepage</h2></div>
        <p class="muted">Edit each part of the homepage below. Switching tabs keeps your unsaved edits — nothing goes live until you Publish.</p>
        <div class="tab-bar" id="homepageTabs"></div>
        <div id="homepageTabPane"></div>
      </div>
    `;

    const tabBar = container.querySelector('#homepageTabs');
    tabBar.innerHTML = TABS.map((tab) => `<button type="button" class="tab-btn${tab.key === activeTab ? ' active' : ''}" data-tab="${tab.key}">${escapeHtml(tab.label)}</button>`).join('');
    tabBar.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        renderForm();
      });
    });

    TAB_RENDERERS[activeTab](container.querySelector('#homepageTabPane'));
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
