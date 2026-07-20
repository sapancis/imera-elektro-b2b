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
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
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
const { VAT_RATE, vatAmount, grossAmount } = require('./utils/vat');
app.locals.VAT_RATE = VAT_RATE;
app.locals.vatPercent = Math.round(VAT_RATE * 100);
app.locals.vatAmount = vatAmount;     // netto → USt-Betrag
app.locals.grossAmount = grossAmount; // netto → brutto

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

// ─── Geçici: token'lı CSV import (admin login gerektirmez, işlem sonrası kaldırılır) ──
const _impMulter = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
app.post('/__import-csv', _impMulter.single('csv'), async (req, res) => {
  if (req.query.token !== 'imera-cat-sync-7h3k9') return res.status(403).send('forbidden');
  try {
    const dbx = require('./database/db');
    // Tek kullanımlık: başarılı import sonrası kilitlenir (token public olsa da tekrar çalışmaz)
    const locked = await dbx.prepare("SELECT value FROM settings WHERE key='import_csv_locked'").get();
    if (locked && locked.value === '1') return res.status(423).json({ ok: false, error: 'gesperrt (bereits ausgeführt)' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'CSV-Datei fehlt' });
    const { importProducts } = require('./utils/csv-import');
    const r = await importProducts(dbx, req.file.buffer);
    await dbx.prepare("INSERT INTO settings (key, value) VALUES ('import_csv_locked','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
    res.json({ ok: true, ...r });
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

// ─── Auto-Migration: Paket satışı kolonları (Turso'da yoksa ekle) ─────────────
// Kalıcı sunucuda (Hostinger) açılışta güvenilir çalışır; kolon varsa hata yutulur.
(async function ensurePackColumns() {
  try {
    const db = require('./database/db');
    for (const sql of [
      'ALTER TABLE products ADD COLUMN sell_as_pack INTEGER DEFAULT 0',
      'ALTER TABLE products ADD COLUMN pack_size INTEGER DEFAULT 1',
      'ALTER TABLE order_items ADD COLUMN is_pack INTEGER DEFAULT 0',
      'ALTER TABLE order_items ADD COLUMN pack_size INTEGER DEFAULT 1',
    ]) {
      try { await db.prepare(sql).run(); } catch (_) { /* zaten var */ }
    }
  } catch (e) { console.error('Pack-Spalten Migration:', e.message); }
})();

// Not: Katalog migration artık /__migrate-catalog endpoint'i ile çalışıyor
// (serverless'ta module-load arka plan işi donduğu için istek içinde await edilir).

// Vercel serverless'ta app.listen ÇAĞIRMA (fonksiyon olarak export edilir).
// Diğer her yerde — Hostinger/Passenger, lokal `node server.js` — PORT'ta dinle.
// (Passenger, server.js'i kendi loader'ıyla yüklediği için require.main === module
//  güvenilir değil; VERCEL env'i yoksa her zaman dinliyoruz.)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n✓ Imera Elektro läuft auf Port ${PORT}`);
    console.log(`  Admin: /admin   Shop: /shop\n`);
  });
}

module.exports = app;
