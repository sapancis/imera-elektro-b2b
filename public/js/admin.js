// Auto-dismiss flash messages
setTimeout(() => { document.querySelector('.admin-flash')?.remove(); }, 5000);

// Confirm delete dialogs
document.querySelectorAll('[data-confirm]').forEach(el => {
  el.addEventListener('click', e => {
    if (!confirm(el.dataset.confirm)) e.preventDefault();
  });
});

// Mobile sidebar toggle – inject hamburger button into every admin topbar
(function() {
  const sidebar = document.querySelector('.admin-sidebar');
  const topbar  = document.querySelector('.admin-topbar');
  if (!sidebar || !topbar) return;

  // Create hamburger button
  const btn = document.createElement('button');
  btn.id = 'adminMenuToggle';
  btn.setAttribute('aria-label', 'Menü');
  btn.setAttribute('aria-expanded', 'false');
  btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;display:none;flex-direction:column;gap:4px;flex-shrink:0';
  for (let i = 0; i < 3; i++) {
    const bar = document.createElement('span');
    bar.style.cssText = 'width:20px;height:2px;background:var(--text,#1D1D1F);display:block;border-radius:2px';
    btn.appendChild(bar);
  }

  // Wrap first child (title div) with a flex container and prepend button
  const firstChild = topbar.firstElementChild;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:0.75rem';
  topbar.insertBefore(wrap, firstChild);
  wrap.appendChild(btn);
  wrap.appendChild(firstChild);

  // Show/hide on resize
  function checkWidth() {
    const show = window.innerWidth <= 768;
    btn.style.display = show ? 'flex' : 'none';
    if (!show) sidebar.classList.remove('open');
  }
  checkWidth();
  window.addEventListener('resize', checkWidth);

  // Toggle
  btn.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    btn.setAttribute('aria-expanded', open);
  });

  // Overlay click closes sidebar
  const overlay = document.getElementById('sidebarOverlay');
  if (overlay) {
    btn.addEventListener('click', () => overlay.classList.toggle('open'));
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  // Close on outside click
  document.addEventListener('click', e => {
    if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !btn.contains(e.target)) {
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
})();
