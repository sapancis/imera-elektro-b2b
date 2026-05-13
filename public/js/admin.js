// Auto-dismiss flash messages
setTimeout(() => { document.querySelector('.admin-flash')?.remove(); }, 5000);

// Confirm delete dialogs
document.querySelectorAll('[data-confirm]').forEach(el => {
  el.addEventListener('click', e => {
    if (!confirm(el.dataset.confirm)) e.preventDefault();
  });
});
