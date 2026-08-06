import { getContentSection, saveContentPatch, publishContentSection, uploadFiles } from '../api-client.js';
import { createSectionState, escapeHtml, bindField } from '../section-kit.js';

const CONTENT_KEY = 'branding';

const LOGO_SLOTS = [
  { key: 'main', label: 'Main logo', fallback: 'brand_assets/nail logo.jpg' },
  { key: 'mobile', label: 'Mobile logo', fallback: 'brand_assets/nail logo.jpg' },
  { key: 'footer', label: 'Footer logo', fallback: 'brand_assets/nail logo.jpg' },
  { key: 'favicon', label: 'Favicon', fallback: 'brand_assets/nail logo.jpg' },
];

export async function mount(container, ctx) {
  const section = await getContentSection(CONTENT_KEY, 'draft');
  const state = createSectionState({ contentKey: CONTENT_KEY, defaultData: section.data || {} });
  state.offerLocalRestore(section.updatedAt);

  function renderLogoSlot(slot) {
    const logos = state.data.logos || {};
    const current = logos[slot.key];
    const previewUrl = current?.url || slot.fallback;
    return `
      <div class="img-row" data-logo-slot="${slot.key}">
        <img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(slot.label)}">
        <div>
          <div style="font-weight:700;">${escapeHtml(slot.label)}</div>
          <div class="small">${current ? 'Custom image set' : 'Using default fallback image'}</div>
          <input type="file" accept="image/*" data-logo-input="${slot.key}">
        </div>
        <div class="img-controls">
          ${current ? `<button type="button" class="btn btn-danger" data-logo-clear="${slot.key}">Remove</button>` : ''}
        </div>
      </div>
    `;
  }

  function renderForm() {
    const data = state.data;
    const colors = data.colors || {};

    container.innerHTML = `
      <div class="card">
        <div class="section-title"><h2>Branding</h2></div>
        <p class="muted">Logos, favicon, brand name and colors used across the whole site. Upload a custom image any time — until you do, the site keeps using its current default image.</p>

        <div class="grid">
          <div class="field"><label>Business name</label><input type="text" data-bind="businessName" maxlength="120"></div>
          <div class="field"><label>Website title</label><input type="text" data-bind="siteTitle" maxlength="120"></div>
          <div class="field"><label>Instagram handle</label><input type="text" data-bind="instagramHandle" maxlength="60"></div>
          <div class="field"><label>Instagram URL</label><input type="text" data-bind="instagramUrl" maxlength="300"></div>
        </div>

        <div class="field">
          <label>Logos &amp; favicon</label>
          <div class="img-list" id="logoSlots">${LOGO_SLOTS.map(renderLogoSlot).join('')}</div>
        </div>

        <div class="field">
          <label>Brand colors (best-effort — used where the design supports it)</label>
          <div class="grid">
            <div class="field"><label>Primary</label><input type="color" data-bind="colors.primary" value="${escapeHtml(colors.primary || '#F5279A')}"></div>
            <div class="field"><label>Secondary</label><input type="color" data-bind="colors.secondary" value="${escapeHtml(colors.secondary || '#CBA6D9')}"></div>
            <div class="field"><label>Accent</label><input type="color" data-bind="colors.accent" value="${escapeHtml(colors.accent || '#FF5AA6')}"></div>
          </div>
        </div>
      </div>
    `;

    bindField(container, '[data-bind="businessName"]', { get: () => data.businessName, set: (v) => state.set('businessName', v) });
    bindField(container, '[data-bind="siteTitle"]', { get: () => data.siteTitle, set: (v) => state.set('siteTitle', v) });
    bindField(container, '[data-bind="instagramHandle"]', { get: () => data.instagramHandle, set: (v) => state.set('instagramHandle', v) });
    bindField(container, '[data-bind="instagramUrl"]', { get: () => data.instagramUrl, set: (v) => state.set('instagramUrl', v) });

    ['primary', 'secondary', 'accent'].forEach((key) => {
      bindField(container, `[data-bind="colors.${key}"]`, {
        get: () => colors[key],
        set: (v) => state.set('colors', { ...(data.colors || {}), [key]: v }),
        event: 'change',
      });
    });

    container.querySelectorAll('[data-logo-input]').forEach((input) => {
      input.addEventListener('change', async () => {
        const slotKey = input.getAttribute('data-logo-input');
        const file = input.files?.[0];
        if (!file) return;
        try {
          ctx.showToast?.('Uploading image...', 'info');
          const [uploaded] = await uploadFiles([file], { folder: 'nailit_branding' });
          state.set('logos', { ...(state.data.logos || {}), [slotKey]: uploaded });
          renderForm();
          ctx.showToast?.('Image uploaded. Save Draft, then Publish to make it live.', 'success');
        } catch (error) {
          ctx.showToast?.(error.message || 'Upload failed', 'error');
        }
      });
    });

    container.querySelectorAll('[data-logo-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slotKey = btn.getAttribute('data-logo-clear');
        const logos = { ...(state.data.logos || {}) };
        delete logos[slotKey];
        state.set('logos', logos);
        renderForm();
      });
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
