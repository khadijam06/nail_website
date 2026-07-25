let basketCount = Number(localStorage.getItem('nailBasketCount') || '0');

function updateBasketCount() {
  const basketEl = document.getElementById('basketCount');
  if (basketEl) basketEl.textContent = basketCount;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 1800);
}

let currentGallery = [];
let currentGalleryIndex = 0;

function updateModalImage(product) {
  const modal = document.getElementById('productModal');
  if (!modal) return;
  const imageEl = document.getElementById('modalImage');
  const counterEl = document.getElementById('modalImageCount');
  const titleEl = document.getElementById('modalTitle');
  const descriptionEl = document.getElementById('modalDescription');
  const priceValueEl = document.getElementById('modalPriceValue');

  if (product) {
    titleEl.textContent = product.title;
    descriptionEl.textContent = product.description;
    priceValueEl.textContent = product.price;
  }

  if (!imageEl || !counterEl) return;
  imageEl.src = currentGallery[currentGalleryIndex] || '';
  imageEl.alt = product ? `${product.title} preview ${currentGalleryIndex + 1}` : 'Nail design preview';
  counterEl.textContent = `${currentGalleryIndex + 1} / ${currentGallery.length}`;
}

function openModal(product) {
  const modal = document.getElementById('productModal');
  if (!modal) return;
  currentGallery = Array.isArray(product.gallery) && product.gallery.length > 0 ? product.gallery : [product.image];
  currentGalleryIndex = 0;
  updateModalImage(product);
  modal.classList.add('open');
}

function closeModal() {
  const modal = document.getElementById('productModal');
  if (modal) modal.classList.remove('open');
}

function nextGalleryImage() {
  if (!currentGallery.length) return;
  currentGalleryIndex = (currentGalleryIndex + 1) % currentGallery.length;
  updateModalImage();
}

function prevGalleryImage() {
  if (!currentGallery.length) return;
  currentGalleryIndex = (currentGalleryIndex - 1 + currentGallery.length) % currentGallery.length;
  updateModalImage();
}

function addToBasket() {
  basketCount += 1;
  localStorage.setItem('nailBasketCount', String(basketCount));
  updateBasketCount();
  showToast('Added to basket');
  closeModal();
}

function renderProducts(products) {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  grid.innerHTML = products.map(product => `
    <article class="product-card" onclick="openModal(${JSON.stringify(product).replace(/"/g, '&quot;')})">
      <img class="product-image" src="${product.image}" alt="${product.title}">
      <div class="product-info">
        <h3 class="product-title">${product.title}</h3>
        <p class="product-tag">${product.tag}</p>
        <div class="product-meta">
          <span class="product-price">${product.price}</span>
          <span style="color: var(--mauve); font-size: 13px;">Tap to view</span>
        </div>
      </div>
    </article>
  `).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  updateBasketCount();
  if (window.categoryProducts) {
    renderProducts(window.categoryProducts);
  }

  let touchStartX = 0;
  const modalImage = document.getElementById('modalImage');
  const modal = document.getElementById('productModal');

  if (modalImage && modal) {
    modalImage.addEventListener('touchstart', event => {
      touchStartX = event.changedTouches[0].screenX;
    });

    modalImage.addEventListener('touchend', event => {
      const touchEndX = event.changedTouches[0].screenX;
      const delta = touchEndX - touchStartX;
      if (Math.abs(delta) > 40) {
        if (delta < 0) {
          nextGalleryImage();
        } else {
          prevGalleryImage();
        }
      }
    });

    document.addEventListener('keydown', event => {
      if (!modal.classList.contains('open')) return;
      if (event.key === 'ArrowRight') nextGalleryImage();
      if (event.key === 'ArrowLeft') prevGalleryImage();
    });
  }
});
