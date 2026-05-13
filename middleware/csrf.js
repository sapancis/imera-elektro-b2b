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
    const token = req.body._csrf || req.headers['x-csrf-token'];
    const tokens = req.session.csrfTokens || [];
    if (!token || !tokens.includes(token)) {
      return res.status(403).render('error', {
        title: 'Sicherheitsfehler',
        message: 'Ungültiges Sicherheitstoken. Bitte laden Sie die Seite neu.',
        code: 403
      });
    }
    req.session.csrfTokens = tokens.filter(t => t !== token);
  }

  next();
}

module.exports = csrfMiddleware;
