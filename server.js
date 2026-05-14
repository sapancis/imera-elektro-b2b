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
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.googletagmanager.com', 'https://www.google-analytics.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://www.google-analytics.com', 'https://www.googletagmanager.com'],
      connectSrc: ["'self'", 'https://www.google-analytics.com', 'https://region1.google-analytics.com'],
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
app.use('/merkliste', require('./routes/merkliste'));
app.use('/vergleich', require('./routes/vergleich'));
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

// ─── Auto-Setup: Admin kullanıcısı yoksa oluştur ──────────────────────────
(function autoSetup() {
  try {
    const db = require('./database/db');
    const bcrypt = require('bcryptjs');
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@imeraelektro.at';
    const adminPass  = process.env.ADMIN_PASSWORD || 'admin123';
    const existing   = db.prepare('SELECT id FROM users WHERE role=?').get('admin');
    if (!existing) {
      const hash = bcrypt.hashSync(adminPass, 12);
      db.prepare('INSERT INTO users (email, password_hash, name, company, role) VALUES (?,?,?,?,?)')
        .run(adminEmail, hash, 'Administrator', 'Imera Elektro', 'admin');
      console.log(`✓ Admin kullanıcısı oluşturuldu: ${adminEmail}`);
    }
  } catch (e) {
    console.error('Auto-setup hatası:', e.message);
  }
})();

// ─── Auto-Seed: Ürün yoksa örnek ürünleri yükle ──────────────────────────────
(async function autoSeed() {
  try {
    const db = require('./database/db');
    const count = db.prepare('SELECT COUNT(*) as n FROM products WHERE active=1').get().n;
    if (count === 0) {
      console.log('⏳ Keine Produkte gefunden — starte automatisches Seeding...');
      try {
        await require('./scripts/seed-products');
      } catch (e) {
        console.error('Auto-seed Fehler:', e.message);
      }
    }
  } catch (e) {
    console.error('Auto-seed check Fehler:', e.message);
  }
})();

app.listen(PORT, () => {
  console.log(`\n✓ Imera Elektro läuft auf http://localhost:${PORT}`);
  console.log(`  Admin: http://localhost:${PORT}/admin`);
  console.log(`  Shop:  http://localhost:${PORT}/shop\n`);
});
