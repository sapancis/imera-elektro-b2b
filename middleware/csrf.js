const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfMiddleware(req, res, next) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = generateToken();
  }

  req.csrfToken = () => {
    const token = generateToken();
    req.session.csrfTokens = req.session.csrfTokens || [];
    req.session.csrfTokens.push(token);
    if (req.session.csrfTokens.length > 20) req.session.csrfTokens.shift();
    return token;
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    // Multipart formlarda (dosya yükleme) body henüz parse edilmedi — multer route'ta
    // çalışır. CSRF doğrulaması o yüzden route içinde (multer sonrası) yapılır.
    const ct = req.headers['content-type'] || '';
    if (ct.startsWith('multipart/form-data')) return next();

    const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
    const tokens = req.session.csrfTokens || [];
    if (!token || !tokens.includes(token)) {
      req.session.flash = { type: 'error', message: 'Sicherheitstoken abgelaufen. Bitte erneut versuchen.' };
      return res.redirect(req.get('referer') || '/');
    }
    req.session.csrfTokens = tokens.filter(t => t !== token);
  }

  next();
}

module.exports = csrfMiddleware;
