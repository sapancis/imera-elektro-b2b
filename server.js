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
// Preis: min. 2 Dezimalstellen, überflüssige Nullen entfernt (76,500→76,50; 0,990→0,99; 0,025 bleibt).
app.locals.formatPrice = (n) => {
  if (typeof n !== 'number') return n;
  let s = n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  let [int, dec = ''] = s.split('.');
  dec = dec.padEnd(2, '0').slice(0, 3);
  return int + ',' + dec + '€';
};
app.locals.formatEuro = (n) => typeof n === 'number' ? n.toFixed(2).replace('.', ',') + '€' : n;
app.locals.formatDate = (d) => d ? new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
app.locals.orderStatusLabel = (s) => ({ pending: 'Offen', processing: 'In Bearbeitung', shipped: 'Versandt', delivered: 'Geliefert', cancelled: 'Storniert' }[s] || s);
app.locals.orderStatusClass = (s) => ({ pending: 'warning', processing: 'info', shipped: 'primary', delivered: 'success', cancelled: 'danger' }[s] || 'secondary');
// main.js INLINE gömülür — Hostinger CDN'i ara sıra HTTP/3 (QUIC) ile bu dosyayı
// düşürüyordu; o durumda tüm butonlar (Merken/Vergleichen/Warenkorb) ölüyordu.
// Inline gömünce ayrı istek olmaz → HTML ile hep gelir, güvenilir çalışır.
try { app.locals.mainInlineJs = require('fs').readFileSync(path.join(__dirname, 'public/js/main.js'), 'utf8'); }
catch (_) { app.locals.mainInlineJs = ''; }
app.locals.savings = (our, mktMax) => mktMax > our ? Math.round((1 - our / mktMax) * 100) : 0;
// Farb-Swatch: deutscher Farbname -> Hex (Fallback grau)
const COLOR_HEX = {
  'Weiß':'#F5F5F0','Mattweiß':'#EDEDE8','Beige':'#D8C7A8','Creme':'#EFE6CE',
  'Graphit':'#3A3A3C','Mattgraphit':'#37373A','Grau':'#9AA0A6','Mattgrau':'#8B9096',
  'Mattschwarz':'#1C1C1E','Schwarz':'#0B0B0C','Silber Metallic':'#C7CBD1','Silber':'#C7CBD1',
  'Gold':'#D9B45B','Gold Metallic':'#C9A24B','Braun Metallic':'#6E4B2A','Braun':'#6E4B2A',
  'Taupe':'#8A7C6B','Salbeigrün':'#9CA788','Lachs':'#E5A186','Terrakotta':'#B5623F',
  'Anthrazit':'#383E42','Kupfer':'#B87333','Bronze':'#8C7853','Champagner':'#E6D2A8',
  'Ecru':'#EFE6D6','Petrol':'#22636B','Marineblau':'#243B5E','Weinrot':'#6E1F2E',
};
app.locals.colorHex = (c) => COLOR_HEX[c] || '#B9BEC6';
const { VAT_RATE, vatAmount, grossAmount } = require('./utils/vat');
app.locals.VAT_RATE = VAT_RATE;
app.locals.vatPercent = Math.round(VAT_RATE * 100);
app.locals.vatAmount = vatAmount;     // netto → USt-Betrag
app.locals.grossAmount = grossAmount; // netto → brutto

// ─── GEÇİCİ TEŞHİS: DB bağlantısı ───────────────────────────────────────────
app.get('/__dbcheck', async (req, res) => {
  if (!process.env.IMPORT_TOKEN || req.query.token !== process.env.IMPORT_TOKEN) return res.status(403).send('forbidden');
  const out = { env_turso_url: !!process.env.TURSO_DATABASE_URL, env_turso_token: !!process.env.TURSO_AUTH_TOKEN };
  try {
    const db = require('./database/db');
    const r = await db.prepare('SELECT COUNT(*) as n FROM products').get();
    out.ok = true; out.products = r.n;
  } catch (e) {
    out.ok = false; out.error = e.message; out.code = e.code; out.stack = (e.stack || '').split('\n').slice(0, 4);
  }
  res.json(out);
});

// ─── GEÇİCİ: Pawbol import (wellenweise, pasif, görselsiz) ──────────────────
// /__pawbol?token=<IMPORT_TOKEN>            → import (aktif margin ile fiyat)
// /__pawbol?token=...&activate=1           → tüm Pawbol ürünlerini aktive/pasife
// /__pawbol?token=...&recompute=1          → margin değişince fiyatları yeniden hesapla
app.get('/__pawbol', async (req, res) => {
  if (!process.env.IMPORT_TOKEN || req.query.token !== process.env.IMPORT_TOKEN) return res.status(403).send('forbidden');
  try {
    const db = require('./database/db');
    const brandRow = await db.prepare("SELECT id FROM brands WHERE slug='pawbol'").get()
      || (await db.prepare("INSERT INTO brands (name, slug, sort_order) VALUES ('Pawbol','pawbol',7)").run(), await db.prepare("SELECT id FROM brands WHERE slug='pawbol'").get());
    const marginRow = await db.prepare("SELECT value FROM settings WHERE key='pawbol_margin'").get();
    const margin = parseFloat(marginRow?.value || '40') / 100;
    const sell = (lp) => Math.round(lp * (1 + margin) * 100) / 100;

    // activate/deactivate
    if (req.query.activate === '1' || req.query.deactivate === '1') {
      const a = req.query.activate === '1' ? 1 : 0;
      const r = await db.prepare('UPDATE products SET active=? WHERE brand_id=?').run(a, brandRow.id);
      return res.json({ ok: true, action: a ? 'activated' : 'deactivated', changed: r.changes || 0 });
    }
    // pawbol.eu-Bilder (kaputtes SSL) herunterladen → Cloudinary → image setzen + aktiv
    // Batchweise: /__pawbol?fetchimages=1&limit=40  (mehrfach aufrufen bis remaining=0)
    if (req.query.fetchimages === '1') {
      const https = require('https');
      const { saveUpload } = require('./utils/upload');
      const map = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'scripts/pawbol-import.json'), 'utf8'));
      const bySku = {}; for (const p of map.products) if (p.image_src) bySku[p.sku] = p.image_src;
      const http = require('http');
      const limit = Math.min(parseInt(req.query.limit) || 40, 80);
      const rows = await db.prepare("SELECT id, sku FROM products WHERE brand_id=? AND (image IS NULL OR image='')").all(brandRow.id);
      const targets = rows.filter(r => bySku[r.sku]).slice(0, limit);
      // Download mit Redirect-Folge (http→https) + SSL-Bypass
      const download = (url, depth = 0) => new Promise((resolve, reject) => {
        if (depth > 4) return reject(new Error('too many redirects'));
        const mod = url.startsWith('https') ? https : http;
        const rq = mod.get(url, { rejectUnauthorized: false, timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } }, r2 => {
          if ([301, 302, 303, 307, 308].includes(r2.statusCode) && r2.headers.location) {
            r2.resume(); const next = r2.headers.location.startsWith('http') ? r2.headers.location : new URL(r2.headers.location, url).href;
            return resolve(download(next, depth + 1));
          }
          if (r2.statusCode >= 400) { r2.resume(); return reject(new Error('http ' + r2.statusCode)); }
          const ch = []; r2.on('data', c => ch.push(c)); r2.on('end', () => resolve(Buffer.concat(ch)));
        });
        rq.on('error', reject); rq.on('timeout', () => rq.destroy(new Error('timeout')));
      });
      let done = 0, failed = 0, lastErr = '';
      for (const t of targets) {
        try {
          const buf = await download(bySku[t.sku]);
          if (!buf || buf.length < 500) throw new Error('empty/too small');
          const cloudUrl = await saveUpload({ buffer: buf, originalname: t.sku + '.jpg' }, { folder: 'imera-pawbol', prefix: 'pawbol' });
          await db.prepare('UPDATE products SET image=?, active=1 WHERE id=?').run(cloudUrl, t.id);
          done++;
        } catch (e) { failed++; lastErr = e.message; }
      }
      const remaining = rows.filter(r => bySku[r.sku]).length - done;
      return res.json({ ok: true, done, failed, remaining, lastErr });
    }
    // Nur Produkte MIT Bild aktivieren, bildlose deaktivieren (Bilder-Policy)
    if (req.query.imageonly === '1') {
      const r1 = await db.prepare("UPDATE products SET active=1 WHERE brand_id=? AND image IS NOT NULL AND image!=''").run(brandRow.id);
      const r0 = await db.prepare("UPDATE products SET active=0 WHERE brand_id=? AND (image IS NULL OR image='')").run(brandRow.id);
      return res.json({ ok: true, activated: r1.changes || 0, deactivated: r0.changes || 0 });
    }
    // Marge setzen (global) + sofort neu berechnen
    if (req.query.setmargin !== undefined) {
      const mp = String(parseFloat(req.query.setmargin) || 0);
      await db.prepare("INSERT INTO settings (key, value) VALUES ('pawbol_margin', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(mp);
      try { require('./utils/cache').del('settings_map'); } catch (_) {}
      const m2 = parseFloat(mp) / 100;
      const ps = await db.prepare('SELECT id, list_price FROM products WHERE brand_id=? AND list_price IS NOT NULL').all(brandRow.id);
      for (const p of ps) await db.prepare('UPDATE product_tiers SET price=? WHERE product_id=?').run(Math.round(p.list_price * (1 + m2) * 100) / 100, p.id);
      return res.json({ ok: true, marginPercent: parseFloat(mp), recomputed: ps.length });
    }
    // recompute prices from list_price × current margin
    if (req.query.recompute === '1') {
      const ps = await db.prepare('SELECT id, list_price FROM products WHERE brand_id=? AND list_price IS NOT NULL').all(brandRow.id);
      let n = 0;
      for (const p of ps) {
        await db.prepare('UPDATE product_tiers SET price=? WHERE product_id=?').run(sell(p.list_price), p.id);
        n++;
      }
      return res.json({ ok: true, recomputed: n, margin: margin });
    }

    const fs = require('fs'), path2 = require('path');
    const cfg = JSON.parse(fs.readFileSync(path2.join(__dirname, 'scripts/pawbol-import.json'), 'utf8'));
    const chunk = async (stmts) => { for (let i=0;i<stmts.length;i+=400){ const c=stmts.slice(i,i+400); if(db.batch) await db.batch(c); else for(const s of c) await db.prepare(s.sql).run(...s.args); } };

    for (const c of cfg.categories) { try { await db.prepare('INSERT INTO categories (name, slug) VALUES (?,?)').run(c.name, c.slug); } catch(_){} }
    const catRows = await db.prepare('SELECT id, slug FROM categories').all();
    const catId = Object.fromEntries(catRows.map(c => [c.slug, c.id]));

    const pStmts = cfg.products.map(p => ({
      sql: `INSERT INTO products (name, slug, sku, category_id, brand_id, short_description, description, specs, list_price, unit_label, units_per_pack, min_order_qty, image, stock, active, has_variants)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)
            ON CONFLICT(sku) DO UPDATE SET name=excluded.name, category_id=excluded.category_id, brand_id=excluded.brand_id,
              short_description=excluded.short_description, description=excluded.description, specs=excluded.specs, list_price=excluded.list_price,
              unit_label=excluded.unit_label, units_per_pack=excluded.units_per_pack, min_order_qty=excluded.min_order_qty, image=excluded.image`,
      args: [p.name, p.slug, p.sku, catId[p.category_slug] || null, brandRow.id, p.short_description, p.description || null,
             JSON.stringify(p.specs || []), p.list_price, p.unit_label, p.units_per_pack, p.moq, p.image || null, 999],
    }));
    await chunk(pStmts);

    const prodRows = await db.prepare('SELECT id, sku, list_price FROM products WHERE brand_id=?').all(brandRow.id);
    const byId = {};
    prodRows.forEach(r => { byId[r.sku] = r; });
    const ids = prodRows.map(r => r.id);
    for (let i=0;i<ids.length;i+=300){ const part=ids.slice(i,i+300); await db.prepare(`DELETE FROM product_tiers WHERE product_id IN (${part.map(()=>'?').join(',')})`).run(...part); }
    const tStmts = prodRows.filter(r => r.list_price != null).map(r => ({
      sql: 'INSERT INTO product_tiers (product_id, min_qty, max_qty, price) VALUES (?,1,NULL,?)',
      args: [r.id, sell(r.list_price)],
    }));
    await chunk(tStmts);

    res.json({ ok: true, brand: brandRow.id, marginPercent: margin * 100, categories: cfg.categories.length, products: pStmts.length, tiers: tStmts.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message, stack: (e.stack||'').split('\n').slice(0,3) }); }
});

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

// ─── GEÇİCİ: Karlik varyant importu (pasif/taslak) ──────────────────────────
// /__karlik?token=<IMPORT_TOKEN>  → işi bitince bu blok silinecek.
app.get('/__karlik', async (req, res) => {
  if (!process.env.IMPORT_TOKEN || req.query.token !== process.env.IMPORT_TOKEN) return res.status(403).send('forbidden');
  try {
    const db = require('./database/db');
    const fs = require('fs'), path2 = require('path');
    // Aktivierung/Deaktivierung aller Karlik-Produkte (ohne Re-Import)
    if (req.query.activate === '1' || req.query.deactivate === '1') {
      const b = await db.prepare("SELECT id FROM brands WHERE slug='karlik'").get();
      const a = req.query.activate === '1' ? 1 : 0;
      const r = await db.prepare('UPDATE products SET active=? WHERE brand_id=?').run(a, b.id);
      return res.json({ ok: true, action: a ? 'activated' : 'deactivated', changed: r.changes || 0 });
    }
    const cfg = JSON.parse(fs.readFileSync(path2.join(__dirname, 'scripts/karlik-import.json'), 'utf8'));
    const slugify = (s) => String(s || '').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const chunk = async (stmts) => { for (let i=0;i<stmts.length;i+=400){ const c=stmts.slice(i,i+400); if(db.batch) await db.batch(c); else for(const s of c) await db.prepare(s.sql).run(...s.args); } };

    // 1) Marke
    try { await db.prepare('INSERT INTO brands (name, slug, sort_order) VALUES (?,?,4)').run(cfg.brand.name, cfg.brand.slug); } catch(_){}
    const brand = await db.prepare('SELECT id FROM brands WHERE slug=?').get(cfg.brand.slug);

    // 2) Kategorien (mit Icon + Beschreibung; bestehende nur füllen wenn leer/Standard)
    for (const c of cfg.categories) {
      try { await db.prepare('INSERT INTO categories (name, slug, icon, description) VALUES (?,?,?,?)').run(c.name, c.slug, c.icon || null, c.description || null); } catch(_){}
      try { await db.prepare("UPDATE categories SET icon=?, description=? WHERE slug=? AND (icon IS NULL OR icon='' OR icon='📦') AND (description IS NULL OR description='')").run(c.icon || null, c.description || null, c.slug); } catch(_){}
    }
    const catRows = await db.prepare('SELECT id, slug FROM categories').all();
    const catId = Object.fromEntries(catRows.map(c => [c.slug, c.id]));

    // 3) Produkte (upsert by sku, INAKTIV/staged, has_variants=1)
    const pStmts = cfg.products.map(p => ({
      sql: `INSERT INTO products (name, slug, sku, category_id, brand_id, short_description, image, specs, stock, active, has_variants, series)
            VALUES (?,?,?,?,?,?,?,?,?,0,1,?)
            ON CONFLICT(sku) DO UPDATE SET name=excluded.name, category_id=excluded.category_id,
              brand_id=excluded.brand_id, short_description=excluded.short_description, image=excluded.image,
              specs=excluded.specs, has_variants=1, series=excluded.series`,
      args: [p.name, p.slug, p.sku, catId[p.category_slug] || null, brand.id, p.short_description, p.image, JSON.stringify(p.specs || []), 999, p.series],
    }));
    await chunk(pStmts);

    // 4) sku -> product_id
    const prodRows = await db.prepare('SELECT id, sku FROM products WHERE brand_id=?').all(brand.id);
    const pid = Object.fromEntries(prodRows.map(r => [r.sku, r.id]));

    // 5) Tiers (price_min) + Varianten — idempotent: erst löschen, dann neu
    const ids = Object.values(pid);
    for (let i=0;i<ids.length;i+=300){
      const part = ids.slice(i,i+300);
      const ph = part.map(()=>'?').join(',');
      await db.prepare(`DELETE FROM product_tiers WHERE product_id IN (${ph})`).run(...part);
      await db.prepare(`DELETE FROM product_variants WHERE product_id IN (${ph})`).run(...part);
    }
    const tStmts = [], vStmts = [];
    for (const p of cfg.products) {
      const id = pid[p.sku]; if (!id) continue;
      tStmts.push({ sql: 'INSERT INTO product_tiers (product_id, min_qty, max_qty, price) VALUES (?,1,NULL,?)', args: [id, p.price_min] });
      p.variants.forEach((v, i) => vStmts.push({
        sql: 'INSERT INTO product_variants (product_id, sku, color, ean, price, image, sort_order, active) VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(sku) DO UPDATE SET product_id=excluded.product_id, color=excluded.color, ean=excluded.ean, price=excluded.price, image=excluded.image, sort_order=excluded.sort_order',
        args: [id, v.sku, v.color, v.ean, v.price, v.image, i],
      }));
    }
    await chunk(tStmts);
    await chunk(vStmts);

    res.json({ ok: true, brand: brand.id, categories: cfg.categories.length, products: pStmts.length, tiers: tStmts.length, variants: vStmts.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message, stack: (e.stack||'').split('\n').slice(0,3) }); }
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

// ─── Auto-Migration: yeni tablo/kolonlar (Turso'da yoksa ekle) ───────────────
// Kalıcı sunucuda (Hostinger) açılışta güvenilir çalışır; zaten varsa hata yutulur.
(async function ensureSchema() {
  try {
    const db = require('./database/db');
    for (const sql of [
      'ALTER TABLE products ADD COLUMN sell_as_pack INTEGER DEFAULT 0',
      'ALTER TABLE products ADD COLUMN pack_size INTEGER DEFAULT 1',
      'ALTER TABLE order_items ADD COLUMN is_pack INTEGER DEFAULT 0',
      'ALTER TABLE order_items ADD COLUMN pack_size INTEGER DEFAULT 1',
      // Marka mimarisi
      `CREATE TABLE IF NOT EXISTS brands (
         id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
         logo TEXT, description TEXT, sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
         created_at TEXT DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS brand_catalogs (
         id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
         title TEXT NOT NULL, file_url TEXT NOT NULL, sort_order INTEGER DEFAULT 0,
         created_at TEXT DEFAULT (datetime('now')))`,
      'ALTER TABLE products ADD COLUMN brand_id INTEGER REFERENCES brands(id)',
      // Farbvarianten (Karlik)
      'ALTER TABLE products ADD COLUMN has_variants INTEGER DEFAULT 0',
      'ALTER TABLE products ADD COLUMN series TEXT',
      // Pawbol: Basis-Listenpreis (für globale Marge) + Verkaufseinheit
      'ALTER TABLE products ADD COLUMN list_price REAL',
      'ALTER TABLE products ADD COLUMN unit_label TEXT',
      'ALTER TABLE products ADD COLUMN units_per_pack INTEGER DEFAULT 1',
      `CREATE TABLE IF NOT EXISTS product_variants (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
         sku TEXT UNIQUE, color TEXT, ean TEXT, price REAL NOT NULL,
         image TEXT, sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1)`,
      // ── INDEXE: ohne diese scannen die korrelierten Subqueries (MIN(price),
      // COUNT variants) je Zeile die ganze Tabelle → Millionen gelesener Zeilen
      // pro Seitenaufruf → Turso "rows read"-Quota gesprengt. Diese Indexe sind kritisch.
      'CREATE INDEX IF NOT EXISTS idx_tiers_product ON product_tiers(product_id)',
      'CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id)',
      'CREATE INDEX IF NOT EXISTS idx_variants_active ON product_variants(product_id, active)',
      'CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)',
      'CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id)',
      'CREATE INDEX IF NOT EXISTS idx_products_active ON products(active)',
      'CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug)',
      'CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id)',
    ]) {
      try { await db.prepare(sql).run(); } catch (_) { /* zaten var */ }
    }
    // Bilinen markaları oluştur (idempotent) — logo/açıklama sonradan admin'den
    const seed = [['Onka', 'onka', 1], ['Tork', 'tork', 2], ['Tracon', 'tracon', 3],
                  ['Karlik', 'karlik', 4], ['Pawbol', 'pawbol', 5]];
    // Kopos & ETI sind aktuell keine Partner → aus der Markenliste entfernen (nur wenn keine Produkte)
    for (const slug of ['kopos', 'eti']) {
      try { await db.prepare("DELETE FROM brands WHERE slug=? AND NOT EXISTS (SELECT 1 FROM products WHERE products.brand_id=brands.id)").run(slug); } catch (_) {}
    }
    for (const [name, slug, ord] of seed) {
      try { await db.prepare('INSERT INTO brands (name, slug, sort_order) VALUES (?,?,?)').run(name, slug, ord); } catch (_) { /* var */ }
    }
    // Mevcut ürünlere marka ata (yalnızca markası olmayanlara — idempotent)
    for (const sql of [
      `UPDATE products SET brand_id=(SELECT id FROM brands WHERE slug='tracon')
         WHERE brand_id IS NULL AND sku LIKE 'TR-%'`,
      `UPDATE products SET brand_id=(SELECT id FROM brands WHERE slug='tork')
         WHERE brand_id IS NULL AND category_id IN (SELECT id FROM categories WHERE name LIKE 'Kabelbinder%')`,
      `UPDATE products SET brand_id=(SELECT id FROM brands WHERE slug='onka')
         WHERE brand_id IS NULL AND category_id IN (SELECT id FROM categories WHERE name IN ('Reihenklemmen','Kabelverschraubungen'))`,
    ]) {
      try { await db.prepare(sql).run(); } catch (_) {}
    }
    // Markasız ürünleri BİR KEZ pasife al (admin'de "Ohne Marke" olarak görünür,
    // marka atanınca tekrar aktif edilebilir — tekrar tekrar pasife almaz)
    try {
      const flag = await db.prepare("SELECT value FROM settings WHERE key='unbranded_deactivated'").get();
      if (!flag || flag.value !== '1') {
        await db.prepare('UPDATE products SET active=0 WHERE brand_id IS NULL').run();
        await db.prepare("INSERT INTO settings (key, value) VALUES ('unbranded_deactivated','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
      }
    } catch (_) {}
    // Pawbol-Marge-Einstellung (falls noch nicht vorhanden)
    try { await db.prepare("INSERT INTO settings (key, value) VALUES ('pawbol_margin','40') ON CONFLICT(key) DO NOTHING").run(); } catch (_) {}
    // CSV-Import-Kategorien: Icon + Beschreibung setzen (nur wenn noch leer → Admin-Edits bleiben erhalten)
    const catMeta = [
      ['netzwerkinstallation', '🛡️', 'Leitungsschutzschalter, FI-Schalter & Sicherungen'],
      ['verteilerkaesten', '🗄️', 'Verteilerschränke, Zählerverteiler & Gehäuse'],
      ['energieverteilung', '🔋', 'Sammelschienen, Überspannungsschutz & Verteilung'],
      ['stecker-und-steckdosen', '🔌', 'CEE-Industrie, Schuko & Aufputz-Steckdosen'],
      ['leuchten', '💡', 'LED-Fluter, Strahler & Außenleuchten'],
      ['lichtquellen', '🔆', 'LED-Leuchtmittel & Spots'],
      ['relais', '⏱️', 'Zeit- & Multifunktionsrelais'],
      ['hilfsmaterial', '🧰', 'Montagezubehör & Kleinmaterial'],
    ];
    for (const [slug, icon, desc] of catMeta) {
      try {
        await db.prepare(
          "UPDATE categories SET icon=?, description=? WHERE slug=? AND (description IS NULL OR description='' OR icon IS NULL OR icon='📦')"
        ).run(icon, desc, slug);
      } catch (_) {}
    }
    // Falscher "Kleinunternehmer"-Steuerhinweis (Regelbesteuerung ist korrekt) — einmalig überschreiben
    try {
      await db.prepare(
        "UPDATE settings SET value='Imera Elektro unterliegt der Regelbesteuerung · UID: ATU82785639 · Alle Preise netto zzgl. 20% MwSt.' " +
        "WHERE key='company_legal' AND value LIKE '%Kleinunternehmer%'"
      ).run();
    } catch (_) {}
  } catch (e) { console.error('Schema Migration:', e.message); }
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
