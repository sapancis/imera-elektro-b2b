function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/konto/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.userRole !== 'admin') {
    return res.status(403).redirect('/konto/login');
  }
  next();
}

function setLocals(req, res, next) {
  res.locals.user = req.session.userId
    ? { id: req.session.userId, name: req.session.userName, email: req.session.userEmail, role: req.session.userRole }
    : null;

  const cart = req.session.cart || {};
  res.locals.cartCount = Object.values(cart).reduce((sum, q) => sum + q, 0);
  res.locals.currentPath = req.path;
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  next();
}

function flash(req, type, message) {
  req.session.flash = { type, message };
}

module.exports = { requireAuth, requireAdmin, setLocals, flash };
