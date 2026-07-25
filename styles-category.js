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

function openModal(product) {
  const modal = document.getElementById('productModal');
  if (!modal) return;
  document.getElementById('modalImage').src = product.image;
  document.getElementById('modalTitle').textContent = product.title;
  document.getElementById('modalDescription').textContent = product.description;
  document.getElementById('modalPrice').textContent = product.price;
  document.getElementById('modalPriceValue').textContent = product.price;
  modal.classList.add('open');
}

function closeModal() {
  const modal = document.getElementById('productModal');
  if (modal) modal.classList.remove('open');
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
});
