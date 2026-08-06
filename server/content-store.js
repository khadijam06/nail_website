const CONTENT_FOLDER = 'nailit_content';

// Every editable "page" the admin CMS knows about. Phase 2 keys are pre-declared
// here so the storage/route layer never needs to change again when those editors ship.
const SECTION_KEYS = [
  'homepage',
  'branding',
  'navigation',
  'footer',
  'faq',
  'order-page',
  'category-chrome',
  'category-french-tips',
  'category-cateye',
  'category-3d-art',
];

function isValidSectionKey(key) {
  return SECTION_KEYS.includes(String(key || ''));
}

function buildPublicId(key, status) {
  return `${CONTENT_FOLDER}/${key}.${status}.json`;
}

// Content lives as "authenticated" (not "upload") raw resources, so nothing is
// reachable by a guessed Cloudinary URL — every read goes through a freshly
// signed URL generated with our server credentials, and every write goes
// through the Admin/Upload API. Browsers never talk to Cloudinary directly.
async function readSection(cloudinary, key, status) {
  const publicId = buildPublicId(key, status);
  const signedUrl = cloudinary.url(publicId, {
    resource_type: 'raw',
    type: 'authenticated',
    sign_url: true,
    secure: true,
  });
  // Cloudinary's CDN cache invalidation on overwrite is asynchronous, so a
  // read immediately after a save could otherwise return stale cached JSON.
  // A trailing cache-buster forces every read to skip that cache.
  const url = `${signedUrl}${signedUrl.includes('?') ? '&' : '?'}_cb=${Date.now()}`;

  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to read content section "${key}" (${status}): HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Content section "${key}" (${status}) is corrupted JSON`);
  }
}

async function writeSection(cloudinary, key, status, envelope) {
  const publicId = buildPublicId(key, status);
  const json = JSON.stringify(envelope);
  const dataUri = `data:application/json;base64,${Buffer.from(json, 'utf8').toString('base64')}`;

  await cloudinary.uploader.upload(dataUri, {
    resource_type: 'raw',
    type: 'authenticated',
    public_id: publicId,
    overwrite: true,
    invalidate: true,
  });

  return envelope;
}

async function getSection(cloudinary, key, status = 'draft') {
  const envelope = await readSection(cloudinary, key, status);
  return envelope || { data: {}, updatedAt: null };
}

// Shallow top-level merge: patch.hero replaces data.hero wholesale, but leaves
// data.howItWorks (or any other top-level field group) untouched, so two
// sub-sections of the same page can be edited/saved independently.
async function saveDraftPatch(cloudinary, key, patch) {
  const current = await readSection(cloudinary, key, 'draft');
  const data = { ...(current?.data || {}), ...patch };
  const envelope = { data, updatedAt: new Date().toISOString() };
  await writeSection(cloudinary, key, 'draft', envelope);
  return envelope;
}

async function publishSection(cloudinary, key) {
  const draft = await readSection(cloudinary, key, 'draft');
  if (!draft) {
    const error = new Error(`No draft content exists for "${key}" yet`);
    error.code = 'NOT_FOUND';
    throw error;
  }
  const envelope = { data: draft.data, updatedAt: new Date().toISOString() };
  await writeSection(cloudinary, key, 'published', envelope);
  return envelope;
}

// Used only by the one-time migration script to seed initial content.
async function seedSection(cloudinary, key, data) {
  const envelope = { data, updatedAt: new Date().toISOString() };
  await writeSection(cloudinary, key, 'draft', envelope);
  await writeSection(cloudinary, key, 'published', envelope);
  return envelope;
}

async function listSectionsMeta(cloudinary) {
  const results = await Promise.all(
    SECTION_KEYS.map(async (key) => {
      const [draft, published] = await Promise.all([
        readSection(cloudinary, key, 'draft'),
        readSection(cloudinary, key, 'published'),
      ]);

      return {
        key,
        draftUpdatedAt: draft?.updatedAt || null,
        publishedUpdatedAt: published?.updatedAt || null,
        hasUnpublishedChanges: Boolean(
          draft?.updatedAt && (!published?.updatedAt || new Date(draft.updatedAt) > new Date(published.updatedAt)),
        ),
        isSeeded: Boolean(draft || published),
      };
    }),
  );

  return results;
}

module.exports = {
  SECTION_KEYS,
  isValidSectionKey,
  getSection,
  saveDraftPatch,
  publishSection,
  seedSection,
  listSectionsMeta,
};
