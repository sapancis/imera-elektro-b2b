require('dotenv').config();

// ─── Global error handlers — prevent crash on unhandled exceptions ────────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', new Date().toISOString(), err.stack || err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', new Date().toISOString(), reason);
});
const express = require('express');
const session = require('express-session');
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
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://embed.tawk.to', 'https://*.tawk.to'],
      // Inline event handler'lara (onchange/onclick — filtreler, galeri, sort) izin ver.
      // Helmet varsayılanı script-src-attr 'none' bunları bloklar.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'https://*.tawk.to'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'https://*.tawk.to'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://www.google-analytics.com', 'https://www.googletagmanager.com', 'https://*.tawk.to', 'https://res.cloudinary.com'],
      connectSrc: ["'self'", 'https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://*.tawk.to', 'wss://*.tawk.to', 'https://api.cloudinary.com'],
      frameSrc: ["'self'", 'https://*.tawk.to'],
    },
  },
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────
app.use('/konto', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// ─── Body Parsers ─────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// ─── Session Store (Turso DB veya lokal FileStore) ───────────────────────
let sessionStore;
if (process.env.TURSO_DATABASE_URL) {
  const TursoSessionStore = require('./database/session-store');
  const db = require('./database/db');
  sessionStore = new TursoSessionStore(db);
} else {
  const FileStore = require('session-file-store')(session);
  sessionStore = new FileStore({ path: path.join(__dirname, 'database/sessions'), ttl: 604800, retries: 0, logFn: () => {} });
}

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
if (!process.env.VERCEL) {
  const uploadsDir = path.join(__dirname, 'public/uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}
// Görseller stabil → uzun cache (CDN + tarayıcı). CSS/JS → kısa cache (deploy'da hızlı yansır).
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '10m' }));

// ─── View Engine ──────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('view cache', true); // EJS şablonlarını derlenmiş halde önbellekle (her render'da disk okuma yok)

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

// ─── Geçici: tek seferlik ürün açıklaması düzeltmesi (EDL-300-46 → Edelstahl 316/W4) ──
// Turso'da sadece bu ürünün description'ını günceller (stok vb. dokunmaz). İşlem sonrası kaldırılır.
app.get('/__fix-edl-desc', async (req, res) => {
  if (req.query.token !== 'imera-cat-sync-7h3k9') return res.status(403).send('forbidden');
  try {
    const dbx = require('./database/db');
    const desc = 'Edelstahl-Kabelbinder 300x4,6mm aus Edelstahl 316 (W4) für anspruchsvolle Umgebungen. Erhöhte Zugfestigkeit und Korrosionsbeständigkeit. Geeignet für Außenanlagen, Industrie und den maritimen Bereich.';
    const r = await dbx.prepare('UPDATE products SET description=? WHERE sku=?').run(desc, 'EDL-300-46');
    const row = await dbx.prepare('SELECT sku, description FROM products WHERE sku=?').get('EDL-300-46');
    res.json({ ok: true, changes: r.changes, row });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

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
(async function autoSetup() {
  try {
    const db = require('./database/db');
    const bcrypt = require('bcryptjs');
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@imeraelektro.at';
    const adminPass  = process.env.ADMIN_PASSWORD || 'admin123';
    const existing   = await db.prepare('SELECT id FROM users WHERE role=?').get('admin');
    if (!existing) {
      const hash = bcrypt.hashSync(adminPass, 12);
      await db.prepare('INSERT INTO users (email, password_hash, name, company, role) VALUES (?,?,?,?,?)')
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
    const countRow = await db.prepare('SELECT COUNT(*) as n FROM products WHERE active=1').get();
    if (countRow.n === 0) {
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

// Not: Katalog migration artık /__migrate-catalog endpoint'i ile çalışıyor
// (serverless'ta module-load arka plan işi donduğu için istek içinde await edilir).

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n✓ Imera Elektro läuft auf http://localhost:${PORT}`);
    console.log(`  Admin: http://localhost:${PORT}/admin`);
    console.log(`  Shop:  http://localhost:${PORT}/shop\n`);
  });
}

module.exports = app;
