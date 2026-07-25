let currentModalProduct = null;
let currentGallery = [];
let currentGalleryIndex = 0;

function getBasketItems() {
  return JSON.parse(localStorage.getItem('nailBasketItems') || '[]');
}

function setBasketItems(items) {
  localStorage.setItem('nailBasketItems', JSON.stringify(items));
  updateBasketCount();
}

function updateBasketCount() {
  const el = document.getElementById('basketCount');
  if (el) el.textContent = String(getBasketItems().length);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 1800);
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateModalImage(product) {
  const imageEl = document.getElementById('modalImage');
  const counterEl = document.getElementById('modalImageCount');
  const titleEl = document.getElementById('modalTitle');
  const descriptionEl = document.getElementById('modalDescription');
  const priceValueEl = document.getElementById('modalPriceValue');

  if (product) {
    titleEl.textContent = product.title || 'Untitled';
    descriptionEl.textContent = product.fullDescription || product.shortDescription || 'No description available.';
    priceValueEl.textContent = product.price || '-';
  }

  if (!imageEl || !counterEl || !currentGallery.length) return;
  imageEl.src = currentGallery[currentGalleryIndex] || '';
  imageEl.alt = product ? `${product.title} preview ${currentGalleryIndex + 1}` : 'Nail design preview';
  counterEl.textContent = `${currentGalleryIndex + 1} / ${currentGallery.length}`;
}

function openModalFromPayload(payload) {
  const modal = document.getElementById('productModal');
  if (!modal) return;
  currentModalProduct = payload;
  currentGallery = (payload.images || []).map((img) => img.url).filter(Boolean);
  if (!currentGallery.length && payload.mainImageUrl) {
    currentGallery = [payload.mainImageUrl];
  }
  currentGalleryIndex = 0;
  updateModalImage(payload);
  modal.classList.add('open');
}

function closeModal() {
  const modal = document.getElementById('productModal');
  if (modal) modal.classList.remove('open');
}

function nextGalleryImage() {
  if (!currentGallery.length) return;
  currentGalleryIndex = (currentGalleryIndex + 1) % currentGallery.length;
  updateModalImage(currentModalProduct);
}

function prevGalleryImage() {
  if (!currentGallery.length) return;
  currentGalleryIndex = (currentGalleryIndex - 1 + currentGallery.length) % currentGallery.length;
  updateModalImage(currentModalProduct);
}

function addToBasket() {
  if (!currentModalProduct) return;
  const items = getBasketItems();
  items.push({
    title: currentModalProduct.title || 'Untitled',
    price: currentModalProduct.price || '-',
    image: currentModalProduct.mainImageUrl || currentModalProduct.images?.[0]?.url || '',
  });
  setBasketItems(items);
  showToast('Added to basket');
  closeModal();
}

function openBasketModal() {
  const modal = document.getElementById('basketModal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  renderBasketList();
}

function closeBasketModal() {
  const modal = document.getElementById('basketModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function clearBasket() {
  setBasketItems([]);
  renderBasketList();
}

function renderBasketList() {
  const items = getBasketItems();
  const listEl = document.getElementById('basketList');
  const totalEl = document.getElementById('basketTotal');
  const emptyEl = document.getElementById('basketEmpty');
  if (!listEl || !totalEl || !emptyEl) return;

  listEl.innerHTML = '';
  if (items.length === 0) {
    emptyEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'none';
    items.forEach((item) => {
      const listItem = document.createElement('li');
      listItem.className = 'basket-item';
      listItem.innerHTML = `
        <img class="basket-thumb" src="${escapeHtml(item.image || 'brand_assets/nail logo.jpg')}" alt="${escapeHtml(item.title)}">
        <div class="basket-item-info">
          <div class="basket-item-title">${escapeHtml(item.title)}</div>
          <div class="basket-item-price">${escapeHtml(item.price)}</div>
        </div>
      `;
      listEl.appendChild(listItem);
    });
  }

  totalEl.textContent = String(items.length);
}

function productCardTemplate(product) {
  const payload = escapeHtml(JSON.stringify(product));
  const image = product.mainImageUrl || product.images?.[0]?.url || 'brand_assets/nail logo.jpg';
  return `
    <article class="product-card" data-product='${payload}'>
      <img class="product-image" src="${escapeHtml(image)}" alt="${escapeHtml(product.title || 'Nail set')}">
      <div class="product-info">
        <h3 class="product-title">${escapeHtml(product.title || 'Untitled Nail Set')}</h3>
        <p class="product-tag">${escapeHtml(product.shortDescription || product.category || '')}</p>
        <div class="product-meta">
          <span class="product-price">${escapeHtml(product.price || '-')}</span>
          <span style="color: var(--mauve); font-size: 13px;">Tap to view</span>
        </div>
      </div>
    </article>
  `;
}

function bindProductCards() {
  document.querySelectorAll('.product-card').forEach((card) => {
    card.addEventListener('click', () => {
      const raw = card.getAttribute('data-product');
      if (!raw) return;
      try {
        const product = JSON.parse(raw);
        openModalFromPayload(product);
      } catch (error) {
        console.error('Failed to parse product payload', error);
      }
    });
  });
}

async function loadCategoryProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  const category = document.body.getAttribute('data-category') || '';
  const url = category
    ? `/api/products?category=${encodeURIComponent(category)}&sort=newest`
    : '/api/products?sort=newest';

  grid.innerHTML = '<p style="color:var(--mauve);">Loading products...</p>';

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to load products');

    const products = data.products || [];
    if (!products.length) {
      grid.innerHTML = '<p style="color:var(--mauve);">No published products in this category yet.</p>';
      return;
    }

    grid.innerHTML = products.map(productCardTemplate).join('');
    bindProductCards();
  } catch (error) {
    console.error(error);
    grid.innerHTML = '<p style="color:var(--mauve);">Unable to load this category right now.</p>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateBasketCount();
  loadCategoryProducts();

  const basketButtons = document.querySelectorAll('.basket-pill');
  basketButtons.forEach((button) => button.addEventListener('click', openBasketModal));

  let touchStartX = 0;
  const modalImage = document.getElementById('modalImage');
  const modal = document.getElementById('productModal');

  if (modalImage && modal) {
    modalImage.addEventListener('touchstart', (event) => {
      touchStartX = event.changedTouches[0].screenX;
    });

    modalImage.addEventListener('touchend', (event) => {
      const touchEndX = event.changedTouches[0].screenX;
      const delta = touchEndX - touchStartX;
      if (Math.abs(delta) > 40) {
        if (delta < 0) nextGalleryImage(); else prevGalleryImage();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!modal.classList.contains('open')) return;
      if (event.key === 'ArrowRight') nextGalleryImage();
      if (event.key === 'ArrowLeft') prevGalleryImage();
    });
  }
});

window.closeModal = closeModal;
window.nextGalleryImage = nextGalleryImage;
window.prevGalleryImage = prevGalleryImage;
window.addToBasket = addToBasket;
window.closeBasketModal = closeBasketModal;
window.clearBasket = clearBasket;
