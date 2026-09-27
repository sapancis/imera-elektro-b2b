const crypto = require('crypto');

// Oturumsuz CSRF (signed double-submit cookie): tarayıcıya rastgele bir değer
// cookie olarak verilir, forma bu değerin HMAC'i konur. Doğrulama cookie + token
// ile yapılır → anonim ziyaretçiler (botlar dahil) için DB'de session açılmaz.
const COOKIE = 'ie_csrf';
const SECRET = process.env.SESSION_SECRET || 'fallback-secret';

const sign = (nonce) => crypto.createHmac('sha256', SECRET).update(nonce).digest('hex');

function readCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function csrfMiddleware(req, res, next) {
  let nonce = readCookie(req, COOKIE);
  if (!nonce || !/^[a-f0-9]{64}$/.test(nonce)) {
    nonce = crypto.randomBytes(32).toString('hex');
    res.cookie(COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
  const expected = sign(nonce);

  req.csrfToken = () => expected;
  req.verifyCsrf = (token) =>
    typeof token === 'string' && token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    // Multipart formlarda (dosya yükleme) body henüz parse edilmedi — multer route'ta
    // çalışır. CSRF doğrulaması o yüzden route içinde (multer sonrası) yapılır.
    const ct = req.headers['content-type'] || '';
    if (ct.startsWith('multipart/form-data')) return next();

    const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
    if (!req.verifyCsrf(token)) {
      req.session.flash = { type: 'error', message: 'Sicherheitstoken abgelaufen. Bitte erneut versuchen.' };
      return res.redirect(req.get('referer') || '/');
    }
  }

  next();
}

module.exports = csrfMiddleware;
