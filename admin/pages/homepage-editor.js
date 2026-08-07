import {
  mountFieldRegion, mountImageRegion, mountListRegion, prepareIframeDocument,
  createBadgeGroup, positionElementNear, wireHover, openFieldPopover, clearRegionBadges,
} from '../live-editor.js';
import { createSectionState, bindField } from '../section-kit.js';
import { saveContentPatch, publishContentSection, uploadFiles, getToken } from '../api-client.js';
import * as galleryApi from '../sections/gallery.js';

const CONTENT_KEYS = ['homepage', 'navigation', 'footer', 'faq', 'branding'];
const PAGE_PATH = '/index.html';

let iframeEl = null;
let pageState = null;
let showToast = () => {};
let brandingPanelEl = null;

function iframeDoc() { return iframeEl.contentDocument; }
function iframeWin() { return iframeEl.contentWindow; }

function waitForEvent(target, event) {
  return new Promise((resolve) => target.addEventListener(event, resolve, { once: true }));
}

function waitForContentReady() {
  const win = iframeWin();
  if (win.__cmsApply) return Promise.resolve();
  return waitForEvent(win, 'cms:contentready');
}

function seedPageState() {
  const sections = iframeWin().__cmsSections || {};
  const map = {};
  CONTENT_KEYS.forEach((key) => {
    map[key] = createSectionState({ contentKey: key, defaultData: sections[key]?.data || {} });
    map[key].offerLocalRestore(sections[key]?.updatedAt || null);
  });
  return map;
}

function applyAndRefresh(key, groupKey) {
  const apply = iframeWin().__cmsApply;
  if (!apply) return;
  const data = pageState[key].data;
  if (key === 'navigation') apply.applyNavigation(data);
  else if (key === 'footer') apply.applyFooter(data);
  else if (key === 'faq') apply.applyFaq(data);
  else if (key === 'branding') apply.applyBranding(data);
  else if (key === 'homepage' && groupKey) {
    const fnMap = {
      hero: apply.applyHero,
      howItWorks: apply.applyHowItWorks,
      stylesSection: apply.applyStylesSection,
      whyUs: apply.applyWhyUs,
      gallerySection: apply.applyGallerySectionText,
      orderCta: apply.applyOrderCta,
    };
    const fn = fnMap[groupKey];
    if (fn) fn(data[groupKey]);
  }
}

// Every apply*() call above re-renders its WHOLE section from scratch — so
// if a heading field and an items list share the same apply function (e.g.
// both live inside applyFaq), editing the heading destroys and recreates
// the list's DOM too, orphaning its badges. Every mutation therefore goes
// through refreshScope(), which re-renders once and then reattaches every
// list region registered under that same (key, groupKey) scope.
let scopeListRemounters = {};

function scopeKeyFor(key, groupKey) {
  return `${key}::${groupKey || ''}`;
}

function registerListRemount(key, groupKey, regionKey, remountFn) {
  const scopeKey = scopeKeyFor(key, groupKey);
  if (!scopeListRemounters[scopeKey]) scopeListRemounters[scopeKey] = {};
  scopeListRemounters[scopeKey][regionKey] = remountFn;
}

function refreshScope(key, groupKey) {
  applyAndRefresh(key, groupKey);
  const remounters = scopeListRemounters[scopeKeyFor(key, groupKey)] || {};
  Object.values(remounters).forEach((fn) => fn());
}

// Reads (and lazily creates) an array at `path` directly on the state's raw
// data, bypassing .set() so merely discovering an empty list doesn't mark
// the section dirty — only real edits should do that.
function ensureArray(key, path) {
  const parts = path.split('.');
  let cursor = pageState[key].data;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      if (!Array.isArray(cursor[part])) cursor[part] = [];
    } else {
      if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
      cursor = cursor[part];
    }
  });
  return parts.reduce((acc, part) => acc[part], pageState[key].data);
}

function mountText(regionKey, selector, title, fieldsSpec, key) {
  mountFieldRegion(iframeEl, {
    selector,
    regionKey,
    title,
    fields: fieldsSpec.map((f) => ({ key: f.path, label: f.label, type: f.type, maxLength: f.maxLength })),
    getValues: () => {
      const values = {};
      fieldsSpec.forEach((f) => { values[f.path] = pageState[key].get(f.path); });
      return values;
    },
    onInput: (path, value) => {
      pageState[key].set(path, value);
      refreshScope(key, key === 'homepage' ? path.split('.')[0] : null);
    },
  });
}

function mountList(regionKey, containerSelector, itemSelector, arrayPath, itemFieldsSpec, key, opts = {}) {
  const topGroup = arrayPath.split('.')[0];
  const groupKey = key === 'homepage' ? topGroup : null;
  const items = ensureArray(key, arrayPath);

  registerListRemount(key, groupKey, regionKey, () => mountList(regionKey, containerSelector, itemSelector, arrayPath, itemFieldsSpec, key, opts));

  mountListRegion(iframeEl, {
    containerSelector,
    itemSelector,
    regionKey,
    getItems: () => items,
    onChange: () => {
      pageState[key].set(topGroup, pageState[key].data[topGroup]);
      refreshScope(key, groupKey);
    },
    itemFields: (item) => itemFieldsSpec.map((f) => ({ key: f.path, label: f.label, type: f.type, value: item[f.path], maxLength: f.maxLength })),
    itemTitle: opts.itemTitle,
    newItem: opts.newItem,
    addLabel: opts.addLabel,
    minItems: opts.minItems ?? 0,
    allowReorder: opts.allowReorder !== false,
    allowDelete: opts.allowDelete !== false,
    allowAdd: opts.allowAdd !== false,
  });
}

function mountLogoImage(regionKey, selector, label, logoSlot) {
  mountImageRegion(iframeEl, {
    selector,
    regionKey,
    label,
    onReplace: async (file) => {
      try {
        showToast('Uploading image...', 'info');
        const [uploaded] = await uploadFiles([file], { folder: 'nailit_branding' });
        const logos = { ...(pageState.branding.data.logos || {}), [logoSlot]: uploaded };
        pageState.branding.set('logos', logos);
        applyAndRefresh('branding', null);
        showToast('Logo updated. Save Draft, then Publish to make it live.', 'success');
      } catch (error) {
        showToast(error.message || 'Upload failed', 'error');
      }
    },
  });
}

// ── Gallery: bespoke region (fixed 6 slots, immediate server persistence —
// same "no draft step" model Products already use, unlike the content-store
// sections above). Reuses the exact public rendering via __cmsApply.renderGalleryFromSaved.
async function refreshGalleryRegion() {
  const doc = iframeDoc();
  const win = iframeWin();
  clearRegionBadges(doc, 'gallery-images');

  let images;
  try {
    images = await galleryApi.loadGalleryImages();
  } catch (error) {
    showToast(error.message || 'Failed to load gallery', 'error');
    return;
  }
  win.__cmsApply?.renderGalleryFromSaved(images);

  const grid = doc.querySelector('#galleryGrid');
  if (!grid) return;
  // renderGalleryFromSaved renders exactly images.length filled tiles first,
  // in the same order, followed by empty placeholders — see index.html.
  const itemEls = Array.from(grid.querySelectorAll('.gal-item.has-image'));

  itemEls.forEach((itemEl, index) => {
    const image = images[index];
    if (!image) return;

    const buttons = [
      {
        icon: '📷',
        title: 'Replace',
        onClick: () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.style.display = 'none';
          document.body.appendChild(input);
          input.addEventListener('change', async () => {
            const file = input.files?.[0];
            document.body.removeChild(input);
            if (!file) return;
            try {
              showToast('Replacing image...', 'info');
              await galleryApi.replaceImage(image.slot, file, image.alt);
              showToast('Image replaced.', 'success');
              await refreshGalleryRegion();
            } catch (error) {
              showToast(error.message || 'Replace failed', 'error');
            }
          });
          input.click();
        },
      },
      {
        icon: '←',
        title: 'Move left',
        onClick: async () => {
          if (index === 0) return;
          const items = images.map((img, i) => ({ publicId: img.publicId, slot: i, alt: img.alt }));
          [items[index - 1], items[index]] = [
            { ...items[index], slot: index - 1 },
            { ...items[index - 1], slot: index },
          ];
          try {
            await galleryApi.saveOrder(items);
            await refreshGalleryRegion();
          } catch (error) {
            showToast(error.message || 'Reorder failed', 'error');
          }
        },
      },
      {
        icon: '→',
        title: 'Move right',
        onClick: async () => {
          if (index === images.length - 1) return;
          const items = images.map((img, i) => ({ publicId: img.publicId, slot: i, alt: img.alt }));
          [items[index + 1], items[index]] = [
            { ...items[index], slot: index + 1 },
            { ...items[index + 1], slot: index },
          ];
          try {
            await galleryApi.saveOrder(items);
            await refreshGalleryRegion();
          } catch (error) {
            showToast(error.message || 'Reorder failed', 'error');
          }
        },
      },
      {
        icon: '🏷',
        title: 'Edit Alt Text',
        onClick: () => {
          let nextAlt = image.alt || '';
          openFieldPopover(iframeEl, itemEl, {
            title: 'Alt text',
            fields: [{ key: 'alt', label: 'Alt text', type: 'text', value: image.alt || '', maxLength: 160 }],
            onInput: (_key, value) => { nextAlt = value; },
            onClose: async () => {
              if (nextAlt === image.alt) return;
              try {
                const items = images.map((img, i) => ({ publicId: img.publicId, slot: i, alt: i === index ? nextAlt : img.alt }));
                await galleryApi.saveOrder(items);
                await refreshGalleryRegion();
              } catch (error) {
                showToast(error.message || 'Failed to save alt text', 'error');
              }
            },
          });
        },
      },
      {
        icon: '🗑',
        title: 'Delete',
        danger: true,
        onClick: async () => {
          if (!win.confirm('Delete this gallery image?')) return;
          try {
            await galleryApi.deleteImage(image.publicId);
            showToast('Image deleted.', 'success');
            await refreshGalleryRegion();
          } catch (error) {
            showToast(error.message || 'Delete failed', 'error');
          }
        },
      },
    ];

    const badge = createBadgeGroup(doc, 'gallery-images', buttons);
    wireHover(win, itemEl, badge, () => positionElementNear(win, itemEl, badge, { corner: 'center' }));
  });

  if (images.length < 6) {
    const placeholders = Array.from(grid.querySelectorAll('.gal-item.placeholder'));
    const firstEmpty = placeholders[0];
    if (firstEmpty) {
      const uploadBadge = createBadgeGroup(doc, 'gallery-images', [
        {
          icon: '+',
          title: 'Upload image',
          onClick: () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.style.display = 'none';
            document.body.appendChild(input);
            input.addEventListener('change', async () => {
              const file = input.files?.[0];
              document.body.removeChild(input);
              if (!file) return;
              try {
                showToast('Uploading image...', 'info');
                await galleryApi.uploadNewImages([file]);
                showToast('Image uploaded.', 'success');
                await refreshGalleryRegion();
              } catch (error) {
                showToast(error.message || 'Upload failed', 'error');
              }
            });
            input.click();
          },
        },
      ]);
      wireHover(win, firstEmpty, uploadBadge, () => positionElementNear(win, firstEmpty, uploadBadge, { corner: 'center' }));
    }
  }
}

// ── Branding supplementary panel (favicon, name, instagram, colors — fields
// with no direct on-page click target) ──
function renderBrandingPanel(container) {
  const data = pageState.branding.data;
  const colors = data.colors || {};
  const panel = document.createElement('div');
  panel.className = 'cms-side-panel';
  panel.innerHTML = `
    <div class="section-title"><h2>Branding details</h2></div>
    <div class="field"><label>Business name</label><input type="text" data-bind="businessName" maxlength="120"></div>
    <div class="field"><label>Website title</label><input type="text" data-bind="siteTitle" maxlength="120"></div>
    <div class="field"><label>Instagram handle</label><input type="text" data-bind="instagramHandle" maxlength="60"></div>
    <div class="field"><label>Instagram URL</label><input type="text" data-bind="instagramUrl" maxlength="300"></div>
    <div class="field"><label>Favicon</label><input type="file" accept="image/*" id="faviconUploadInput"></div>
    <div class="grid">
      <div class="field"><label>Primary color</label><input type="color" data-bind="colors.primary"></div>
      <div class="field"><label>Secondary color</label><input type="color" data-bind="colors.secondary"></div>
      <div class="field"><label>Accent color</label><input type="color" data-bind="colors.accent"></div>
    </div>
  `;

  bindField(panel, '[data-bind="businessName"]', { get: () => data.businessName, set: (v) => { pageState.branding.set('businessName', v); applyAndRefresh('branding', null); } });
  bindField(panel, '[data-bind="siteTitle"]', { get: () => data.siteTitle, set: (v) => { pageState.branding.set('siteTitle', v); applyAndRefresh('branding', null); } });
  bindField(panel, '[data-bind="instagramHandle"]', { get: () => data.instagramHandle, set: (v) => { pageState.branding.set('instagramHandle', v); applyAndRefresh('branding', null); } });
  bindField(panel, '[data-bind="instagramUrl"]', { get: () => data.instagramUrl, set: (v) => { pageState.branding.set('instagramUrl', v); applyAndRefresh('branding', null); } });

  ['primary', 'secondary', 'accent'].forEach((k) => {
    bindField(panel, `[data-bind="colors.${k}"]`, {
      get: () => colors[k] || '#F5279A',
      set: (v) => { pageState.branding.set('colors', { ...(pageState.branding.data.colors || {}), [k]: v }); },
      event: 'change',
    });
  });

  panel.querySelector('#faviconUploadInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      showToast('Uploading favicon...', 'info');
      const [uploaded] = await uploadFiles([file], { folder: 'nailit_branding' });
      pageState.branding.set('logos', { ...(pageState.branding.data.logos || {}), favicon: uploaded });
      applyAndRefresh('branding', null);
      showToast('Favicon updated.', 'success');
    } catch (error) {
      showToast(error.message || 'Upload failed', 'error');
    }
  });

  container.appendChild(panel);
  return panel;
}

function mountAllRegions() {
  scopeListRemounters = {};

  // Hero
  mountText('hero-heading', '.hero h1', 'Hero heading', [
    { path: 'hero.headingLine1', label: 'Heading', type: 'text', maxLength: 100 },
    { path: 'hero.headingEmphasis', label: 'Highlighted text', type: 'text', maxLength: 100 },
  ], 'homepage');
  mountText('hero-pill', '.hero-pill', 'Announcement badge', [
    { path: 'hero.pillText', label: 'Badge text', type: 'text', maxLength: 80 },
    { path: 'hero.pillLocation', label: 'Location text', type: 'text', maxLength: 60 },
  ], 'homepage');
  mountText('hero-sub', '.hero-sub', 'Hero paragraph', [
    { path: 'hero.description', label: 'Description', type: 'textarea', maxLength: 500 },
  ], 'homepage');
  mountText('hero-btns', '.hero-btns', 'Hero buttons', [
    { path: 'hero.primaryButton.label', label: 'Primary button label', type: 'text', maxLength: 60 },
    { path: 'hero.primaryButton.href', label: 'Primary button link', type: 'url', maxLength: 300 },
    { path: 'hero.secondaryButton.label', label: 'Secondary button label', type: 'text', maxLength: 60 },
    { path: 'hero.secondaryButton.href', label: 'Secondary button link', type: 'url', maxLength: 300 },
  ], 'homepage');
  mountList('hero-stats', '.hero-stats', ':scope > div', 'hero.stats', [
    { path: 'value', label: 'Value', type: 'text', maxLength: 40 },
    { path: 'label', label: 'Label', type: 'text', maxLength: 60 },
  ], 'homepage', { itemTitle: () => 'Edit statistic', newItem: () => ({ value: '100%', label: 'New stat' }), addLabel: 'Add statistic' });

  // How It Works
  mountText('how-heading', '#how .s-head', 'How It Works heading', [
    { path: 'howItWorks.tag', label: 'Section tag', type: 'text', maxLength: 60 },
    { path: 'howItWorks.heading', label: 'Heading', type: 'text', maxLength: 120 },
    { path: 'howItWorks.sub', label: 'Subheading', type: 'text', maxLength: 300 },
  ], 'homepage');
  mountList('how-steps', '#howSteps', '.step', 'howItWorks.steps', [
    { path: 'icon', label: 'Icon (emoji)', type: 'text', maxLength: 8 },
    { path: 'title', label: 'Title', type: 'text', maxLength: 80 },
    { path: 'text', label: 'Text', type: 'textarea', maxLength: 400 },
  ], 'homepage', { itemTitle: (item) => item.title || 'Edit step', newItem: () => ({ icon: '✨', title: 'New step', text: 'Describe this step.' }), addLabel: 'Add step' });

  // Styles section
  mountText('styles-heading', '#styles .s-head', 'Styles section heading', [
    { path: 'stylesSection.tag', label: 'Section tag', type: 'text', maxLength: 60 },
    { path: 'stylesSection.heading', label: 'Heading', type: 'text', maxLength: 120 },
    { path: 'stylesSection.sub', label: 'Subheading', type: 'text', maxLength: 300 },
  ], 'homepage');
  mountList('styles-cards', '#stylesGrid', '.style-card', 'stylesSection.cards', [
    { path: 'title', label: 'Title', type: 'text', maxLength: 60 },
    { path: 'subtitle', label: 'Subtitle', type: 'text', maxLength: 120 },
    { path: 'href', label: 'Link', type: 'url', maxLength: 200 },
  ], 'homepage', {
    itemTitle: (item) => item.title || 'Edit style card',
    allowReorder: false, allowDelete: false, allowAdd: false,
  });

  // Why Us
  mountText('whyus-heading', '#about .s-head', 'Why Nail It By K heading', [
    { path: 'whyUs.tag', label: 'Section tag', type: 'text', maxLength: 60 },
    { path: 'whyUs.heading', label: 'Heading', type: 'text', maxLength: 120 },
    { path: 'whyUs.sub', label: 'Subheading', type: 'text', maxLength: 300 },
  ], 'homepage');
  mountList('whyus-cards', '#whyUsGrid', '.why-card', 'whyUs.cards', [
    { path: 'icon', label: 'Icon (emoji)', type: 'text', maxLength: 8 },
    { path: 'title', label: 'Title', type: 'text', maxLength: 80 },
    { path: 'text', label: 'Text', type: 'textarea', maxLength: 400 },
  ], 'homepage', { itemTitle: (item) => item.title || 'Edit card', newItem: () => ({ icon: '✨', title: 'New reason', text: 'Describe this.' }), addLabel: 'Add feature card' });

  // Gallery heading (images handled by refreshGalleryRegion)
  mountText('gallery-heading', '#gallery .s-head', 'Gallery heading', [
    { path: 'gallerySection.tag', label: 'Section tag', type: 'text', maxLength: 60 },
    { path: 'gallerySection.heading', label: 'Heading', type: 'text', maxLength: 120 },
    { path: 'gallerySection.sub', label: 'Subheading', type: 'text', maxLength: 300 },
  ], 'homepage');

  // Order CTA
  mountText('order-cta-text', '.co-left', 'Order CTA text', [
    { path: 'orderCta.tag', label: 'Section tag', type: 'text', maxLength: 80 },
    { path: 'orderCta.heading', label: 'Heading', type: 'text', maxLength: 120 },
    { path: 'orderCta.description', label: 'Description', type: 'textarea', maxLength: 500 },
  ], 'homepage');
  mountText('order-cta-buttons', '.co-right', 'Order CTA buttons', [
    { path: 'orderCta.pillText', label: 'Pill text', type: 'text', maxLength: 100 },
    { path: 'orderCta.primaryButton.label', label: 'Primary button label', type: 'text', maxLength: 60 },
    { path: 'orderCta.primaryButton.href', label: 'Primary button link', type: 'url', maxLength: 300 },
    { path: 'orderCta.secondaryLink.label', label: 'Secondary link label', type: 'text', maxLength: 60 },
    { path: 'orderCta.secondaryLink.href', label: 'Secondary link URL', type: 'url', maxLength: 300 },
  ], 'homepage');

  // FAQ
  mountText('faq-heading', '#faq .s-head', 'FAQ heading', [
    { path: 'tag', label: 'Section tag', type: 'text', maxLength: 60 },
    { path: 'heading', label: 'Heading', type: 'text', maxLength: 200 },
    { path: 'sub', label: 'Subheading', type: 'text', maxLength: 300 },
  ], 'faq');
  mountList('faq-items', '#faqGrid', '.faq-item', 'items', [
    { path: 'question', label: 'Question', type: 'text', maxLength: 200 },
    { path: 'answer', label: 'Answer', type: 'textarea', maxLength: 1000 },
    { path: 'visible', label: 'Published (visible on site)', type: 'checkbox' },
  ], 'faq', {
    itemTitle: (item) => item.question || 'Edit question',
    newItem: () => ({ id: `faq-${Date.now()}`, question: 'New question', answer: 'Answer goes here.', visible: true }),
    addLabel: 'Add question',
  });

  // Footer
  mountText('footer-brand', '.foot-brand', 'Footer tagline', [
    { path: 'tagline', label: 'Tagline', type: 'textarea', maxLength: 400 },
    { path: 'instagramUrl', label: 'Instagram URL', type: 'url', maxLength: 300 },
  ], 'footer');
  mountList('footer-navigate-links', '#footNavigateLinks', 'li', 'navigateLinks', [
    { path: 'label', label: 'Label', type: 'text', maxLength: 80 },
    { path: 'href', label: 'Link', type: 'url', maxLength: 300 },
  ], 'footer', { itemTitle: (item) => item.label || 'Edit link', newItem: () => ({ label: 'New Link', href: '#' }), addLabel: 'Add navigate link' });
  mountList('footer-contact-links', '#footContactLinks', 'li', 'contactLinks', [
    { path: 'label', label: 'Label', type: 'text', maxLength: 80 },
    { path: 'href', label: 'Link', type: 'url', maxLength: 300 },
  ], 'footer', { itemTitle: (item) => item.label || 'Edit link', newItem: () => ({ label: 'New Link', href: '#' }), addLabel: 'Add contact link' });
  mountText('footer-bottom', '.foot-bot', 'Footer bottom text', [
    { path: 'copyrightText', label: 'Copyright text', type: 'text', maxLength: 200 },
    { path: 'madeWithText', label: '"Made with" text', type: 'text', maxLength: 120 },
  ], 'footer');

  // Navigation
  mountText('nav-logo-text', '#navLogoText', 'Logo text', [
    { path: 'logoLine1', label: 'Logo text, line 1', type: 'text', maxLength: 40 },
    { path: 'logoLine2', label: 'Logo text, line 2', type: 'text', maxLength: 40 },
  ], 'navigation');
  mountList('nav-items', '#navLinksList', 'li', 'items', [
    { path: 'label', label: 'Label', type: 'text', maxLength: 60 },
    { path: 'href', label: 'Destination', type: 'url', maxLength: 300 },
    { path: 'visible', label: 'Visible in menu', type: 'checkbox' },
  ], 'navigation', {
    itemTitle: (item) => item.label || 'Edit menu item',
    newItem: () => ({ id: `nav-${Date.now()}`, label: 'New Link', href: '#', visible: true }),
    addLabel: 'Add menu item',
    minItems: 1,
  });
  mountText('nav-cta', '#navCta', 'Menu call-to-action button', [
    { path: 'cta.label', label: 'Button label', type: 'text', maxLength: 60 },
    { path: 'cta.href', label: 'Button link', type: 'url', maxLength: 300 },
  ], 'navigation');

  // Branding — logo images live on the page; other brand fields live in the side panel.
  mountLogoImage('branding-logo-nav', '#navLogoImg', 'Replace Logo', 'main');
  mountLogoImage('branding-logo-card', '#heroLogoCardImg', 'Replace Logo', 'main');
  mountLogoImage('branding-logo-mobile', '#heroLogoMobImg', 'Replace Mobile Logo', 'mobile');
  mountLogoImage('branding-logo-footer', '#footLogoImg', 'Replace Footer Logo', 'footer');
}

export async function mount(container, ctx) {
  showToast = ctx?.showToast || (() => {});

  iframeEl = document.createElement('iframe');
  iframeEl.className = 'cms-frame';
  iframeEl.title = 'Homepage live editor';

  const wrap = document.createElement('div');
  wrap.className = 'cms-frame-wrap';
  wrap.appendChild(iframeEl);
  container.appendChild(wrap);

  const token = getToken();
  iframeEl.src = `${PAGE_PATH}?preview=1&token=${encodeURIComponent(token)}`;

  await waitForEvent(iframeEl, 'load');
  prepareIframeDocument(iframeDoc());
  await waitForContentReady();

  pageState = seedPageState();
  mountAllRegions();
  await refreshGalleryRegion();

  return {
    isDirty: () => CONTENT_KEYS.some((key) => pageState[key].isDirty()),
    async saveDraft() {
      for (const key of CONTENT_KEYS) {
        if (pageState[key].isDirty()) {
          await saveContentPatch(key, pageState[key].getPatch());
          pageState[key].markClean();
        }
      }
    },
    async publish() {
      // "Publish" means "make my saved draft live" for this page, so it
      // always pushes every section's current draft — not just ones dirty
      // in this exact session (a prior Save Draft already cleared that
      // flag). Sections that have never been drafted are skipped, not errored.
      for (const key of CONTENT_KEYS) {
        try {
          await publishContentSection(key);
        } catch (error) {
          if (!/no draft content exists/i.test(error?.message || '')) throw error;
        }
      }
    },
    async reloadFromServer() {
      const token2 = getToken();
      iframeEl.src = `${PAGE_PATH}?preview=1&token=${encodeURIComponent(token2)}`;
      await waitForEvent(iframeEl, 'load');
      prepareIframeDocument(iframeDoc());
      await waitForContentReady();
      pageState = seedPageState();
      mountAllRegions();
      await refreshGalleryRegion();
      if (brandingPanelEl) {
        const panelParent = brandingPanelEl.parentElement;
        brandingPanelEl.remove();
        brandingPanelEl = panelParent ? renderBrandingPanel(panelParent) : null;
      }
    },
  };
}

export function scrollTo(anchor) {
  if (!iframeEl) return;
  const win = iframeWin();
  if (!anchor || anchor === 'top') {
    win.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const el = iframeDoc().querySelector(anchor);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function setBrandingPanelVisible(visible, container) {
  if (visible && !brandingPanelEl && container) {
    brandingPanelEl = renderBrandingPanel(container);
  } else if (!visible && brandingPanelEl) {
    brandingPanelEl.remove();
    brandingPanelEl = null;
  }
}

export function isMounted() {
  return Boolean(iframeEl);
}
