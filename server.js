require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Trust Proxy (Hostinger / reverse proxy arkasında çalışmak için) ──────
app.set('trust proxy', 1);

// ─── Security Headers ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
    },
  },
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────
app.use('/konto', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// ─── Body Parsers ─────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// ─── Session ─────────────────────────────────────────────────────────────
const sessionStore = new FileStore({ path: path.join(__dirname, 'database/sessions'), ttl: 604800, retries: 0, logFn: () => {} });

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  name: 'ie_session',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// ─── Static Files ─────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use(express.static(path.join(__dirname, 'public')));

// ─── View Engine ──────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── CSRF & Locals ────────────────────────────────────────────────────────
const csrfMiddleware = require('./middleware/csrf');
const { setLocals } = require('./middleware/auth');
app.use(csrfMiddleware);
app.use(setLocals);

// ─── Template Helpers ─────────────────────────────────────────────────────
app.locals.formatPrice = (n) => typeof n === 'number' ? n.toFixed(3).replace('.', ',') + '€' : n;
app.locals.formatEuro = (n) => typeof n === 'number' ? n.toFixed(2).replace('.', ',') + '€' : n;
app.locals.formatDate = (d) => d ? new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
app.locals.orderStatusLabel = (s) => ({ pending: 'Offen', processing: 'In Bearbeitung', shipped: 'Versandt', delivered: 'Geliefert', cancelled: 'Storniert' }[s] || s);
app.locals.orderStatusClass = (s) => ({ pending: 'warning', processing: 'info', shipped: 'primary', delivered: 'success', cancelled: 'danger' }[s] || 'secondary');
app.locals.savings = (our, mktMax) => mktMax > our ? Math.round((1 - our / mktMax) * 100) : 0;

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/', require('./routes/index'));
app.use('/shop', require('./routes/shop'));
app.use('/warenkorb', require('./routes/cart'));
app.use('/kasse', require('./routes/checkout'));
app.use('/konto', require('./routes/auth'));
app.use('/konto', require('./routes/account'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/pages'));

// ─── 404 Handler ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.locals.currentPath = res.locals.currentPath || req.path;
  res.status(404).render('error', { title: 'Seite nicht gefunden', message: 'Die gesuchte Seite wurde nicht gefunden.', code: 404 });
});

// ─── Error Handler ────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.locals.currentPath = res.locals.currentPath || req.path;
  res.locals.cartCount   = res.locals.cartCount   || 0;
  res.locals.csrfToken   = res.locals.csrfToken   || '';
  const status = err.status || err.statusCode || 500;
  res.status(status).render('error', { title: 'Fehler', message: 'Ein interner Fehler ist aufgetreten.', code: status });
});

app.listen(PORT, () => {
  console.log(`\n✓ Imera Elektro läuft auf http://localhost:${PORT}`);
  console.log(`  Admin: http://localhost:${PORT}/admin`);
  console.log(`  Shop:  http://localhost:${PORT}/shop\n`);
});
