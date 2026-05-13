// Hamburger menu
const hamburger = document.getElementById('hamburger');
const nav = document.getElementById('mainNav');
hamburger?.addEventListener('click', () => {
  nav.classList.toggle('open');
  hamburger.setAttribute('aria-expanded', nav.classList.contains('open'));
});
// Close nav on outside click
document.addEventListener('click', (e) => {
  if (nav && nav.classList.contains('open') && !nav.contains(e.target) && !hamburger.contains(e.target)) {
    nav.classList.remove('open');
  }
});

// Shop filter toggle (mobile)
const filterToggle = document.getElementById('filterToggle');
const filterBody   = document.getElementById('filterBody');
if (filterToggle && filterBody) {
  // On desktop always visible
  function checkFilterState() {
    if (window.innerWidth > 768) {
      filterBody.classList.remove('open');
      filterBody.style.display = '';
      filterToggle.classList.remove('open');
    }
  }
  checkFilterState();
  window.addEventListener('resize', checkFilterState);
  filterToggle.addEventListener('click', () => {
    const isOpen = filterBody.classList.toggle('open');
    filterToggle.classList.toggle('open', isOpen);
  });
}

// Add to cart (shop page)
document.querySelectorAll('.btn-add-cart').forEach(btn => {
  if (btn.disabled) return;
  btn.addEventListener('click', function() {
    const productId = this.dataset.productId;
    const qtyId = this.dataset.qtyId;
    const csrf = this.dataset.csrf;
    const qty = parseInt(document.getElementById(qtyId)?.value || 1);
    const originalText = this.textContent;
    this.disabled = true;
    this.textContent = 'Wird hinzugefügt...';

    fetch('/warenkorb/hinzufuegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `product_id=${productId}&qty=${qty}&_csrf=${encodeURIComponent(csrf)}`
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        document.querySelectorAll('.cart-badge').forEach(b => { b.textContent = data.cartCount; b.style.display = 'flex'; });
        showToast(data.message);
        this.textContent = '✓ Hinzugefügt';
        setTimeout(() => { this.textContent = originalText; this.disabled = false; }, 2000);
      } else {
        this.textContent = originalText;
        this.disabled = false;
        showToast(data.message || 'Fehler aufgetreten.');
      }
    })
    .catch(() => { this.textContent = originalText; this.disabled = false; });
  });
});

function showToast(msg) {
  const toast = document.getElementById('cartToast');
  const msgEl = document.getElementById('cartToastMsg');
  if (!toast || !msgEl) return;
  msgEl.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// Price list form
document.getElementById('priceListForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  const email = document.getElementById('priceEmail').value;
  const csrf = this.querySelector('[name="_csrf"]')?.value;
  const btn = this.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Senden...';

  fetch('/preisliste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&_csrf=${encodeURIComponent(csrf)}`
  })
  .then(r => r.json())
  .then(d => {
    btn.textContent = d.ok ? '✓ Gesendet!' : 'Fehler';
    if (d.ok) document.getElementById('priceEmail').value = '';
    setTimeout(() => { btn.textContent = 'Senden'; btn.disabled = false; }, 3000);
  });
});

// Flash auto-dismiss
setTimeout(() => { document.querySelector('.flash')?.remove(); }, 5000);
