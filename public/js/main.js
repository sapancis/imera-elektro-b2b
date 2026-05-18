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

// ─── Cart Queue — aynı anda sadece 1 sepet isteği gider ──────────────────
let cartBusy = false;
const cartQueue = [];

function processCartQueue() {
  if (cartBusy || cartQueue.length === 0) return;
  cartBusy = true;
  const { productId, qty, csrf, btn, originalText } = cartQueue.shift();
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
      btn.textContent = '✓ Hinzugefügt';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1800);
    } else {
      btn.textContent = originalText;
      btn.disabled = false;
      showToast(data.message || 'Fehler aufgetreten.');
    }
  })
  .catch(() => { btn.textContent = originalText; btn.disabled = false; })
  .finally(() => { cartBusy = false; processCartQueue(); });
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
    cartQueue.push({ productId, qty, csrf, btn: this, originalText });
    processCartQueue();
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

// ─── Merken (Wishlist) ────────────────────────────────────────────────────
document.querySelectorAll('.btn-merken').forEach(btn => {
  btn.addEventListener('click', function() {
    const productId = this.dataset.productId;
    const csrf = this.dataset.csrf;
    fetch('/merkliste/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `product_id=${productId}&_csrf=${encodeURIComponent(csrf)}`
    })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        const isAdded = d.action === 'added';
        this.classList.toggle('active', isAdded);
        this.textContent = isAdded ? '♥ Gemerkt' : '♥ Merken';
        // Update merkliste badge
        document.querySelectorAll('.merkliste-badge').forEach(b => {
          b.textContent = d.count;
          b.style.display = d.count > 0 ? 'flex' : 'none';
        });
        // If no badge exists but count > 0, add it
        if (d.count > 0 && !document.querySelector('.merkliste-badge')) {
          const link = document.querySelector('a[href="/merkliste"]');
          if (link) {
            const span = document.createElement('span');
            span.className = 'cart-badge merkliste-badge';
            span.textContent = d.count;
            link.appendChild(span);
          }
        }
        showToast(d.message || (isAdded ? 'Zur Merkliste hinzugefügt.' : 'Von Merkliste entfernt.'));
      } else {
        showToast(d.message || 'Fehler aufgetreten.');
      }
    });
  });
});

// ─── Sofort kaufen ────────────────────────────────────────────────────────
document.querySelectorAll('.btn-sofort-kaufen').forEach(btn => {
  if (btn.disabled) return;
  btn.addEventListener('click', function() {
    const productId = this.dataset.productId;
    const csrf = this.dataset.csrf;
    const qtyId = this.dataset.qtyId;
    const qty = parseInt(document.getElementById(qtyId)?.value || 1);
    const originalText = this.textContent;
    this.disabled = true;
    this.textContent = 'Weiterleitung...';
    fetch('/warenkorb/hinzufuegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `product_id=${productId}&qty=${qty}&_csrf=${encodeURIComponent(csrf)}`
    })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        window.location.href = '/warenkorb';
      } else {
        showToast(d.message || 'Fehler aufgetreten.');
        this.disabled = false;
        this.textContent = originalText;
      }
    })
    .catch(() => {
      this.disabled = false;
      this.textContent = originalText;
    });
  });
});

// ─── Vergleichen (Comparison) ─────────────────────────────────────────────
const vergleichBar = document.getElementById('vergleichBar');
const vergleichCount = document.getElementById('vergleichCount');

document.querySelectorAll('.btn-vergleichen').forEach(btn => {
  btn.addEventListener('click', function() {
    const productId = this.dataset.productId;
    const csrf = this.dataset.csrf;
    fetch('/vergleich/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `product_id=${productId}&_csrf=${encodeURIComponent(csrf)}`
    })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        const isAdded = d.action === 'added';
        this.classList.toggle('active', isAdded);
        this.textContent = isAdded ? '⚖ Verglichen' : '⚖ Vergleichen';
        if (vergleichBar && vergleichCount) {
          if (d.count > 0) {
            vergleichBar.style.display = 'flex';
            vergleichCount.textContent = d.count + ' Produkt(e) zum Vergleich ausgewählt';
          } else {
            vergleichBar.style.display = 'none';
          }
        }
        showToast(isAdded ? 'Zum Vergleich hinzugefügt.' : 'Aus dem Vergleich entfernt.');
      } else {
        showToast(d.message || 'Fehler aufgetreten.');
      }
    });
  });
});
