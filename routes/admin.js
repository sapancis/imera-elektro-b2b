const express = require('express');
const router = express.Router();
const db = require('../database/db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAdmin, flash } = require('../middleware/auth');
const { sendStatusUpdate } = require('../utils/mailer');
const { saveUpload } = require('../utils/upload');

// Vercel salt-okunur → diske yazılamaz. Bellek depolama + Cloudinary'ye yükle.
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
  else cb(new Error('Nur Bilder erlaubt (jpg, png, webp, gif)'));
};
const uploadMulti = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter });

// Multipart upload: multer (bellek) + multer sonrası CSRF doğrulaması.
// CSRF global middleware multipart'ı atlar (body henüz parse edilmemiş), burada doğrularız.
function handleUpload(req, res, next) {
  uploadMulti.fields([{ name: 'image', maxCount: 1 }, { name: 'images', maxCount: 5 }])(req, res, (err) => {
    if (err) {
      console.error('Upload (multer) Fehler:', err.code || '', err.message);
      let msg = 'Fehler beim Hochladen des Bildes.';
      if (err.code === 'LIMIT_FILE_SIZE') msg = 'Bild zu groß. Bitte kleineres Bild verwenden (oder Seite neu laden, damit die automatische Verkleinerung greift).';
      else if (err.message) msg = err.message;
      flash(req, 'error', msg);
      return res.redirect(req.get('referer') || '/admin/produkte');
    }
    // CSRF doğrulaması (artık req.body._csrf parse edildi)
    const token = req.body && req.body._csrf;
    const tokens = req.session.csrfTokens || [];
    if (!token || !tokens.includes(token)) {
      flash(req, 'error', 'Sicherheitstoken abgelaufen. Bitte Seite neu laden und erneut versuchen.');
      return res.redirect(req.get('referer') || '/admin/produkte');
    }
    req.session.csrfTokens = tokens.filter(t => t !== token);
    next();
  });
}

router.use(requireAdmin);

// ─── Toplu CSV Import ────────────────────────────────────────────────────────
const csvUpload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });
function handleCsvUpload(req, res, next) {
  csvUpload.single('csv')(req, res, (err) => {
    if (err) { flash(req, 'error', 'CSV-Upload Fehler: ' + (err.message || err.code)); return res.redirect('/admin/import'); }
    const token = req.body && req.body._csrf;
    const tokens = req.session.csrfTokens || [];
    if (!token || !tokens.includes(token)) { flash(req, 'error', 'Sicherheitstoken abgelaufen. Bitte neu laden.'); return res.redirect('/admin/import'); }
    req.session.csrfTokens = tokens.filter(t => t !== token);
    next();
  });
}
function parseCsvBuf(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c === '\r') { /* skip */ } else f += c; }
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function parseSpecsStr(s) {
  if (!s) return [];
  return s.split(';').map(p => { const i = p.indexOf(':'); if (i < 0) return null; return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }).filter(x => x && x[0] && x[1]);
}

router.get('/import', (req, res) => res.render('admin/import', { title: 'Toplu Import' }));

router.post('/import', handleCsvUpload, async (req, res) => {
  try {
    if (!req.file) { flash(req, 'error', 'Keine CSV-Datei hochgeladen.'); return res.redirect('/admin/import'); }
    const { importProducts } = require('../utils/csv-import');
    const r = await importProducts(db, req.file.buffer);
    flash(req, 'success', `Import fertig: ${r.products} Produkte, ${r.categories} Kategorien.`);
    res.redirect('/admin/produkte');
  } catch (e) {
    console.error('Import Fehler:', e);
    flash(req, 'error', 'Import-Fehler: ' + (e.message || 'Serverfehler'));
    res.redirect('/admin/import');
  }
});

// Dashboard
router.get('/', async (req, res) => {
  try {
    const stats = {
      products: (await db.prepare('SELECT COUNT(*) as n FROM products WHERE active=1').get()).n,
      orders: (await db.prepare('SELECT COUNT(*) as n FROM orders').get()).n,
      customers: (await db.prepare("SELECT COUNT(*) as n FROM users WHERE role='customer'").get()).n,
      revenue: (await db.prepare("SELECT COALESCE(SUM(total),0) as n FROM orders WHERE status!='cancelled'").get()).n,
      pendingOrders: (await db.prepare("SELECT COUNT(*) as n FROM orders WHERE status='pending'").get()).n,
      processingOrders: (await db.prepare("SELECT COUNT(*) as n FROM orders WHERE status='processing'").get()).n,
      unreadMessages: (await db.prepare('SELECT COUNT(*) as n FROM contact_messages WHERE read_at IS NULL').get()).n,
      priceRequests: (await db.prepare('SELECT COUNT(*) as n FROM price_list_requests WHERE sent=0').get()).n,
      stock0: (await db.prepare('SELECT COUNT(*) as n FROM products WHERE stock=0 AND active=1').get()).n,
      stockLow: (await db.prepare('SELECT COUNT(*) as n FROM products WHERE stock>0 AND stock<=10 AND active=1').get()).n,
      revenueMonth: (await db.prepare("SELECT COALESCE(SUM(total),0) as n FROM orders WHERE status!='cancelled' AND created_at>=date('now','start of month')").get()).n,
      ordersToday: (await db.prepare("SELECT COUNT(*) as n FROM orders WHERE created_at>=date('now')").get()).n,
      activeCoupons: (await db.prepare("SELECT COUNT(*) as n FROM coupons WHERE active=1").get()).n,
    };
    const recentOrders = await db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8').all();
    const recentMessages = await db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 5').all();
    const lowStockProducts = await db.prepare('SELECT id, name, sku, stock FROM products WHERE stock<=10 AND active=1 ORDER BY stock ASC LIMIT 8').all();
    const topProducts = await db.prepare(`
      SELECT p.id, p.name, p.sku, COALESCE(SUM(oi.quantity),0) as sold_qty, COALESCE(SUM(oi.total_price),0) as sold_total
      FROM products p LEFT JOIN order_items oi ON oi.product_id=p.id
      GROUP BY p.id ORDER BY sold_qty DESC LIMIT 5
    `).all();
    const recentPriceRequests = await db.prepare('SELECT * FROM price_list_requests ORDER BY created_at DESC LIMIT 6').all();
    // Revenue last 7 days
    const revenueDays = await db.prepare(`
      SELECT date(created_at) as day, COALESCE(SUM(total),0) as rev, COUNT(*) as cnt
      FROM orders WHERE status!='cancelled' AND created_at>=date('now','-6 days')
      GROUP BY day ORDER BY day
    `).all();
    res.render('admin/dashboard', { title: 'Dashboard', stats, recentOrders, recentMessages, lowStockProducts, topProducts, recentPriceRequests, revenueDays });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// ─── PRODUCTS ───────────────────────────────────────────────────────────────
router.get('/produkte', async (req, res) => {
  try {
    const { q, kat } = req.query;
    let where = ['1=1'];
    let params = [];
    if (q) { where.push('(p.name LIKE ? OR p.sku LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (kat) { where.push('c.slug=?'); params.push(kat); }
    const products = await db.prepare(`
      SELECT p.*, c.name as cat_name,
        (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
      FROM products p LEFT JOIN categories c ON p.category_id=c.id
      WHERE ${where.join(' AND ')} ORDER BY p.id DESC
    `).all(...params);
    const categories = await db.prepare('SELECT * FROM categories WHERE active=1').all();
    res.render('admin/products', { title: 'Produkte', products, categories, q, kat });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.get('/produkte/neu', async (req, res) => {
  try {
    const categories = await db.prepare('SELECT * FROM categories WHERE active=1').all();
    res.render('admin/product-edit', { title: 'Neues Produkt', product: null, tiers: [], categories });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/produkte/neu', handleUpload, async (req, res) => {
  try {
    const { name, slug, sku, category_id, short_description, description, specs_raw, apps_raw,
            market_price_min, market_price_max, stock, min_order_qty, delivery_time,
            weight, dimensions, size, meta_title, meta_description, featured, badge, active,
            sell_as_pack, pack_size } = req.body;
    const image = await saveUpload(req.files?.image?.[0]);
    const extraImages = (await Promise.all((req.files?.images || []).map(saveUpload))).filter(Boolean);
    const specsArr = parseTableInput(specs_raw);
    const appsArr = parseListInput(apps_raw);

    const r = await db.prepare(`
      INSERT INTO products (name, slug, sku, category_id, short_description, description, specs, applications,
        market_price_min, market_price_max, stock, min_order_qty, delivery_time, weight, dimensions, size,
        meta_title, meta_description, image, images, featured, badge, active, sell_as_pack, pack_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(name, slug || slugify(name), sku || null, category_id || null,
      short_description || null, description || null,
      JSON.stringify(specsArr), JSON.stringify(appsArr),
      parseFloat(market_price_min) || null, parseFloat(market_price_max) || null,
      parseInt(stock) || 0, parseInt(min_order_qty) || 1,
      delivery_time || null, weight || null, dimensions || null, size || null,
      meta_title || null, meta_description || null,
      image, JSON.stringify(extraImages), featured ? 1 : 0, badge || null, active ? 1 : 0,
      sell_as_pack ? 1 : 0, parseInt(pack_size) || 1);

    await saveTiers(r.lastInsertRowid, req.body);
    flash(req, 'success', 'Produkt wurde erstellt.');
    res.redirect('/admin/produkte');
  } catch (e) {
    flash(req, 'error', 'Fehler: ' + e.message);
    res.redirect('/admin/produkte/neu');
  }
});

router.get('/produkte/:id/bearbeiten', async (req, res) => {
  try {
    const product = await db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!product) return res.redirect('/admin/produkte');
    const tiers = await db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(product.id);
    const categories = await db.prepare('SELECT * FROM categories WHERE active=1').all();
    product.specsArr = product.specs ? JSON.parse(product.specs) : [];
    product.appsArr = product.applications ? JSON.parse(product.applications) : [];
    res.render('admin/product-edit', { title: 'Produkt bearbeiten', product, tiers, categories });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/produkte/:id/bearbeiten', handleUpload, async (req, res) => {
  try {
    const { name, slug, sku, category_id, short_description, description, specs_raw, apps_raw,
            market_price_min, market_price_max, stock, min_order_qty, delivery_time,
            weight, dimensions, size, meta_title, meta_description, featured, badge, active,
            sell_as_pack, pack_size, remove_image, remove_gallery_image } = req.body;
    const product = await db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!product) return res.redirect('/admin/produkte');

    // Ana görsel: yeni yüklendi → yeni, remove işaretlendi → null, yoksa mevcut
    let image = product.image;
    if (req.files?.image?.[0]) image = await saveUpload(req.files.image[0]);
    else if (remove_image) image = null;

    // Galeri: mevcut listeden işaretlenenleri çıkar, yenileri ekle
    const toRemove = Array.isArray(remove_gallery_image) ? remove_gallery_image : (remove_gallery_image ? [remove_gallery_image] : []);
    const existingImages = (product.images ? JSON.parse(product.images) : []).filter(img => !toRemove.includes(img));
    const newImages = (await Promise.all((req.files?.images || []).map(saveUpload))).filter(Boolean);
    const extraImages = [...existingImages, ...newImages];

    const specsArr = parseTableInput(specs_raw);
    const appsArr = parseListInput(apps_raw);

    await db.prepare(`
      UPDATE products SET name=?, slug=?, sku=?, category_id=?, short_description=?, description=?,
      specs=?, applications=?, market_price_min=?, market_price_max=?,
      stock=?, min_order_qty=?, delivery_time=?, weight=?, dimensions=?, size=?,
      meta_title=?, meta_description=?, image=?, images=?, featured=?, badge=?, active=?,
      sell_as_pack=?, pack_size=?, updated_at=datetime('now')
      WHERE id=?
    `).run(name, slug || slugify(name), sku || null, category_id || null,
      short_description || null, description || null,
      JSON.stringify(specsArr), JSON.stringify(appsArr),
      parseFloat(market_price_min) || null, parseFloat(market_price_max) || null,
      parseInt(stock) || 0, parseInt(min_order_qty) || 1,
      delivery_time || null, weight || null, dimensions || null, size || null,
      meta_title || null, meta_description || null,
      image, JSON.stringify(extraImages), featured ? 1 : 0, badge || null, active ? 1 : 0,
      sell_as_pack ? 1 : 0, parseInt(pack_size) || 1,
      req.params.id);

    await saveTiers(req.params.id, req.body);
    flash(req, 'success', 'Produkt wurde aktualisiert.');
    res.redirect('/admin/produkte');
  } catch (e) {
    console.error('Produkt bearbeiten Fehler:', e);
    flash(req, 'error', 'Fehler: ' + (e.message || 'Serverfehler'));
    res.redirect('/admin/produkte/' + req.params.id + '/bearbeiten');
  }
});

router.post('/produkte/:id/loeschen', async (req, res) => {
  try {
    await db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
    flash(req, 'success', 'Produkt wurde deaktiviert.');
    res.redirect('/admin/produkte');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// ─── CATEGORIES ─────────────────────────────────────────────────────────────
router.get('/kategorien', async (req, res) => {
  try {
    const categories = await db.prepare('SELECT c.*, COUNT(p.id) as product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.active=1 GROUP BY c.id ORDER BY c.sort_order').all();
    res.render('admin/categories', { title: 'Kategorien', categories });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/kategorien/neu', async (req, res) => {
  try {
    const { name, slug, icon, description, sort_order } = req.body;
    await db.prepare('INSERT INTO categories (name, slug, icon, description, sort_order) VALUES (?,?,?,?,?)').run(name, slug || slugify(name), icon || '📦', description || null, parseInt(sort_order) || 0);
    flash(req, 'success', 'Kategorie wurde erstellt.');
  } catch { flash(req, 'error', 'Fehler beim Erstellen der Kategorie.'); }
  res.redirect('/admin/kategorien');
});

router.post('/kategorien/:id/bearbeiten', async (req, res) => {
  try {
    const { name, slug, icon, description, sort_order, active } = req.body;
    await db.prepare('UPDATE categories SET name=?, slug=?, icon=?, description=?, sort_order=?, active=? WHERE id=?')
      .run(name, slug, icon, description, parseInt(sort_order) || 0, active ? 1 : 0, req.params.id);
    flash(req, 'success', 'Kategorie aktualisiert.');
  } catch { flash(req, 'error', 'Serverfehler.'); }
  res.redirect('/admin/kategorien');
});

// ─── ORDERS ─────────────────────────────────────────────────────────────────
router.get('/bestellungen', async (req, res) => {
  try {
    const { status } = req.query;
    const orders = status
      ? await db.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC').all(status)
      : await db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    res.render('admin/orders', { title: 'Bestellungen', orders, filterStatus: status });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.get('/bestellungen/:id', async (req, res) => {
  try {
    const order = await db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return res.redirect('/admin/bestellungen');
    const items = await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
    const customer = order.user_id ? await db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id) : null;
    res.render('admin/order-detail', { title: `Bestellung ${order.order_number}`, order, items, customer });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/bestellungen/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) return res.redirect('/admin/bestellungen');

    const order = await db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return res.redirect('/admin/bestellungen');

    await db.prepare("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?").run(status, req.params.id);

    // ── Durum değişince müşteriye mail gönder ────────────────────────
    if (['shipped', 'delivered', 'cancelled'].includes(status)) {
      const items = await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
      const customerUser = order.user_id ? await db.prepare('SELECT name, email FROM users WHERE id=?').get(order.user_id) : null;
      const customerEmail = customerUser?.email || order.guest_email || '';
      const customerName  = customerUser?.name  || order.guest_name  || 'Kunde';
      if (customerEmail) {
        const updatedOrder = { ...order, status };
        sendStatusUpdate({ order: updatedOrder, items, customerEmail, customerName })
          .catch(e => console.error('Status-Mail Fehler:', e.message));
      }
    }

    flash(req, 'success', 'Bestellstatus aktualisiert.');
    res.redirect('/admin/bestellungen/' + req.params.id);
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// ─── CUSTOMERS ──────────────────────────────────────────────────────────────
router.get('/kunden', async (req, res) => {
  try {
    const customers = await db.prepare(`
      SELECT u.*, COUNT(o.id) as order_count, COALESCE(SUM(o.total),0) as total_spent
      FROM users u LEFT JOIN orders o ON o.user_id=u.id
      WHERE u.role='customer' GROUP BY u.id ORDER BY u.created_at DESC
    `).all();
    res.render('admin/customers', { title: 'Kunden', customers });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/kunden/:id/sperren', async (req, res) => {
  try {
    const user = await db.prepare("SELECT * FROM users WHERE id=? AND role='customer'").get(req.params.id);
    if (!user) return res.redirect('/admin/kunden');
    await db.prepare('UPDATE users SET active=? WHERE id=?').run(user.active ? 0 : 1, req.params.id);
    flash(req, 'success', user.active ? 'Kunde gesperrt.' : 'Kunde freigeschaltet.');
    const ref = req.get('Referer') || '/admin/kunden';
    res.redirect(ref.includes('/admin/kunden/') ? ref : '/admin/kunden');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/kunden/:id/stammkunde', async (req, res) => {
  try {
    const user = await db.prepare("SELECT * FROM users WHERE id=? AND role='customer'").get(req.params.id);
    if (!user) return res.redirect('/admin/kunden');
    const newVal = user.stammkunde ? 0 : 1;
    await db.prepare('UPDATE users SET stammkunde=? WHERE id=?').run(newVal, req.params.id);
    flash(req, 'success', newVal ? '✅ Stammkunde freigeschaltet – Rechnungskauf aktiviert.' : 'Stammkunde-Status entfernt.');
    const ref = req.get('Referer') || '/admin/kunden';
    res.redirect(ref);
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// ─── MESSAGES ───────────────────────────────────────────────────────────────
router.get('/nachrichten', async (req, res) => {
  try {
    const messages = await db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC').all();
    const requests = await db.prepare('SELECT * FROM price_list_requests ORDER BY created_at DESC LIMIT 50').all();
    res.render('admin/messages', { title: 'Nachrichten', messages, requests });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/nachrichten/:id/gelesen', async (req, res) => {
  try {
    await db.prepare("UPDATE contact_messages SET read_at=datetime('now') WHERE id=?").run(req.params.id);
    res.redirect('/admin/nachrichten');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/nachrichten/:id/loeschen', async (req, res) => {
  try {
    await db.prepare('DELETE FROM contact_messages WHERE id=?').run(req.params.id);
    flash(req, 'success', 'Nachricht gelöscht.');
    res.redirect('/admin/nachrichten');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// ─── COUPONS ────────────────────────────────────────────────────────────────
router.get('/kuponlar', async (req, res) => {
  try {
    const coupons = await db.prepare(`
      SELECT c.*, u.email as user_email
      FROM coupons c LEFT JOIN users u ON u.id=c.user_id
      ORDER BY c.created_at DESC
    `).all();
    res.render('admin/coupons', { title: 'Kuponlar', coupons });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/kuponlar/neu', async (req, res) => {
  try {
    const { code, type, value, min_order, max_uses, expires_at, user_id } = req.body;
    if (!code || !type || !value) {
      flash(req, 'error', 'Code, Typ und Wert sind Pflichtfelder.');
      return res.redirect('/admin/kuponlar');
    }
    await db.prepare(`
      INSERT INTO coupons (code, type, value, min_order, max_uses, user_id, expires_at)
      VALUES (UPPER(?),?,?,?,?,?,?)
    `).run(
      code.trim(),
      type,
      parseFloat(value),
      parseFloat(min_order) || 0,
      parseInt(max_uses) || 1,
      user_id ? parseInt(user_id) : null,
      expires_at || null
    );
    flash(req, 'success', `Kupon "${code.toUpperCase()}" erstellt.`);
  } catch (e) {
    flash(req, 'error', 'Fehler: Code existiert bereits.');
  }
  res.redirect('/admin/kuponlar');
});

router.post('/kuponlar/:id/loeschen', async (req, res) => {
  try {
    await db.prepare('DELETE FROM coupons WHERE id=?').run(req.params.id);
    flash(req, 'success', 'Kupon gelöscht.');
    res.redirect('/admin/kuponlar');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/kuponlar/:id/toggle', async (req, res) => {
  try {
    const c = await db.prepare('SELECT active FROM coupons WHERE id=?').get(req.params.id);
    if (!c) return res.redirect('/admin/kuponlar');
    await db.prepare('UPDATE coupons SET active=? WHERE id=?').run(c.active ? 0 : 1, req.params.id);
    flash(req, 'success', c.active ? 'Kupon deaktiviert.' : 'Kupon aktiviert.');
    res.redirect('/admin/kuponlar');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// ─── REVIEWS ────────────────────────────────────────────────────────────────
router.get('/bewertungen', async (req, res) => {
  try {
    const reviews = await db.prepare(`
      SELECT r.*, p.name as product_name, p.slug as product_slug
      FROM reviews r LEFT JOIN products p ON p.id=r.product_id
      ORDER BY r.approved ASC, r.created_at DESC
    `).all();
    const pending = reviews.filter(r => !r.approved).length;
    res.render('admin/reviews', { title: 'Bewertungen', reviews, pending });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/bewertungen/:id/freigeben', async (req, res) => {
  try {
    await db.prepare('UPDATE reviews SET approved=1 WHERE id=?').run(req.params.id);
    flash(req, 'success', 'Bewertung freigegeben.');
    res.redirect('/admin/bewertungen');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/bewertungen/:id/loeschen', async (req, res) => {
  try {
    await db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id);
    flash(req, 'success', 'Bewertung gelöscht.');
    res.redirect('/admin/bewertungen');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// ─── STOCK QUICK UPDATE ──────────────────────────────────────────────────────
router.post('/produkte/:id/stok', async (req, res) => {
  try {
    const { stock } = req.body;
    await db.prepare('UPDATE products SET stock=? WHERE id=?').run(parseInt(stock) || 0, req.params.id);
    res.json({ ok: true, stock: parseInt(stock) || 0 });
  } catch { res.status(500).json({ ok: false }); }
});

// ─── CUSTOMER DETAIL ─────────────────────────────────────────────────────────
router.get('/kunden/:id', async (req, res) => {
  try {
    const customer = await db.prepare("SELECT * FROM users WHERE id=? AND role='customer'").get(req.params.id);
    if (!customer) return res.redirect('/admin/kunden');
    const orders = await db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC').all(req.params.id);
    const totalSpent = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);
    const coupons = await db.prepare('SELECT * FROM coupons WHERE user_id=? ORDER BY created_at DESC').all(req.params.id);
    res.render('admin/customer-detail', { title: `Kunde: ${customer.name || customer.email}`, customer, orders, totalSpent, coupons });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// ─── PRICE LIST REQUESTS ─────────────────────────────────────────────────────
router.post('/preisanfragen/:id/erledigt', async (req, res) => {
  try {
    await db.prepare('UPDATE price_list_requests SET sent=1 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
});

// ─── SETTINGS ───────────────────────────────────────────────────────────────
router.get('/einstellungen', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT key, value FROM settings').all();
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.render('admin/settings', { title: 'Einstellungen', settings });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/einstellungen', async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (key !== '_csrf') {
        await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
      }
    }
    try { require('../utils/cache').del('settings_map'); } catch {}
    flash(req, 'success', 'Einstellungen gespeichert.');
    res.redirect('/admin/einstellungen');
  } catch (e) {
    console.error('Einstellungen Fehler:', e);
    res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 });
  }
});

// ─── HELPERS ────────────────────────────────────────────────────────────────
function slugify(text) {
  return text.toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseTableInput(raw) {
  if (!raw) return [];
  return raw.split('\n').map(l => l.split('|').map(s => s.trim())).filter(r => r.length >= 2 && r[0]);
}

function parseListInput(raw) {
  if (!raw) return [];
  return raw.split('\n').map(l => l.trim()).filter(Boolean);
}

async function saveTiers(productId, body) {
  await db.prepare('DELETE FROM product_tiers WHERE product_id=?').run(productId);
  const minQtys = [].concat(body.tier_min || []);
  const maxQtys = [].concat(body.tier_max || []);
  const prices = [].concat(body.tier_price || []);
  const labels = [].concat(body.tier_label || []);
  for (let i = 0; i < prices.length; i++) {
    if (!prices[i]) continue;
    const minQ = parseInt(minQtys[i]) || 1;
    const maxQ = maxQtys[i] ? parseInt(maxQtys[i]) : null;
    await db.prepare('INSERT INTO product_tiers (product_id, min_qty, max_qty, price, label) VALUES (?,?,?,?,?)')
      .run(productId, minQ, maxQ, parseFloat(prices[i]), labels[i] || null);
  }
}

module.exports = router;
