let basketCount = Number(localStorage.getItem('nailBasketCount') || '0');
let currentModalProduct = null;

function getBasketItems() {
  return JSON.parse(localStorage.getItem('nailBasketItems') || '[]');
}

function setBasketItems(items) {
  localStorage.setItem('nailBasketItems', JSON.stringify(items));
  basketCount = items.length;
  updateBasketCount();
}

function updateBasketCount() {
  const basketEl = document.getElementById('basketCount');
  if (basketEl) basketEl.textContent = String(getBasketItems().length);
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
  currentModalProduct = product;
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
    title: currentModalProduct.title,
    price: currentModalProduct.price,
    image: currentModalProduct.gallery?.[0] || currentModalProduct.image,
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
    items.forEach(item => {
      const listItem = document.createElement('li');
      listItem.className = 'basket-item';
      listItem.innerHTML = `
        <img class="basket-thumb" src="${item.image}" alt="${item.title}">
        <div class="basket-item-info">
          <div class="basket-item-title">${item.title}</div>
          <div class="basket-item-price">${item.price}</div>
        </div>
      `;
      listEl.appendChild(listItem);
    });
  }
  totalEl.textContent = String(items.length);
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

  const basketButtons = document.querySelectorAll('.basket-pill');
  basketButtons.forEach(button => button.addEventListener('click', openBasketModal));

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
