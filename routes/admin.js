const express = require('express');
const router = express.Router();
const db = require('../database/db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAdmin, flash } = require('../middleware/auth');

const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product-${Date.now()}${ext}`);
  },
});
const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
  else cb(new Error('Nur Bilder erlaubt (jpg, png, webp, gif)'));
};
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });
const uploadMulti = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });

router.use(requireAdmin);

// Dashboard
router.get('/', (req, res) => {
  const stats = {
    products: db.prepare('SELECT COUNT(*) as n FROM products WHERE active=1').get().n,
    orders: db.prepare('SELECT COUNT(*) as n FROM orders').get().n,
    customers: db.prepare("SELECT COUNT(*) as n FROM users WHERE role='customer'").get().n,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) as n FROM orders WHERE status!='cancelled'").get().n,
    pendingOrders: db.prepare("SELECT COUNT(*) as n FROM orders WHERE status='pending'").get().n,
    processingOrders: db.prepare("SELECT COUNT(*) as n FROM orders WHERE status='processing'").get().n,
    unreadMessages: db.prepare('SELECT COUNT(*) as n FROM contact_messages WHERE read_at IS NULL').get().n,
    priceRequests: db.prepare('SELECT COUNT(*) as n FROM price_list_requests WHERE sent=0').get().n,
    stock0: db.prepare('SELECT COUNT(*) as n FROM products WHERE stock=0 AND active=1').get().n,
    stockLow: db.prepare('SELECT COUNT(*) as n FROM products WHERE stock>0 AND stock<=10 AND active=1').get().n,
    revenueMonth: db.prepare("SELECT COALESCE(SUM(total),0) as n FROM orders WHERE status!='cancelled' AND created_at>=date('now','start of month')").get().n,
    ordersToday: db.prepare("SELECT COUNT(*) as n FROM orders WHERE created_at>=date('now')").get().n,
    activeCoupons: db.prepare("SELECT COUNT(*) as n FROM coupons WHERE active=1").get().n,
  };
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8').all();
  const recentMessages = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 5').all();
  const lowStockProducts = db.prepare('SELECT id, name, sku, stock FROM products WHERE stock<=10 AND active=1 ORDER BY stock ASC LIMIT 8').all();
  const topProducts = db.prepare(`
    SELECT p.id, p.name, p.sku, COALESCE(SUM(oi.quantity),0) as sold_qty, COALESCE(SUM(oi.total_price),0) as sold_total
    FROM products p LEFT JOIN order_items oi ON oi.product_id=p.id
    GROUP BY p.id ORDER BY sold_qty DESC LIMIT 5
  `).all();
  const recentPriceRequests = db.prepare('SELECT * FROM price_list_requests ORDER BY created_at DESC LIMIT 6').all();
  // Revenue last 7 days
  const revenueDays = db.prepare(`
    SELECT date(created_at) as day, COALESCE(SUM(total),0) as rev, COUNT(*) as cnt
    FROM orders WHERE status!='cancelled' AND created_at>=date('now','-6 days')
    GROUP BY day ORDER BY day
  `).all();
  res.render('admin/dashboard', { title: 'Dashboard', stats, recentOrders, recentMessages, lowStockProducts, topProducts, recentPriceRequests, revenueDays });
});

// ─── PRODUCTS ───────────────────────────────────────────────────────────────
router.get('/produkte', (req, res) => {
  const { q, kat } = req.query;
  let where = ['1=1'];
  let params = [];
  if (q) { where.push('(p.name LIKE ? OR p.sku LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (kat) { where.push('c.slug=?'); params.push(kat); }
  const products = db.prepare(`
    SELECT p.*, c.name as cat_name,
      (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
    FROM products p LEFT JOIN categories c ON p.category_id=c.id
    WHERE ${where.join(' AND ')} ORDER BY p.id DESC
  `).all(...params);
  const categories = db.prepare('SELECT * FROM categories WHERE active=1').all();
  res.render('admin/products', { title: 'Produkte', products, categories, q, kat });
});

router.get('/produkte/neu', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories WHERE active=1').all();
  res.render('admin/product-edit', { title: 'Neues Produkt', product: null, tiers: [], categories });
});

router.post('/produkte/neu', uploadMulti.fields([{name:'image',maxCount:1},{name:'images',maxCount:5}]), (req, res) => {
  const { name, slug, sku, category_id, description, specs_raw, apps_raw, market_price_min, market_price_max, stock, featured, badge, active } = req.body;
  const image = req.files?.image?.[0] ? '/uploads/' + req.files.image[0].filename : null;
  const extraImages = (req.files?.images || []).map(f => '/uploads/' + f.filename);

  const specsArr = parseTableInput(specs_raw);
  const appsArr = parseListInput(apps_raw);

  try {
    const r = db.prepare(`
      INSERT INTO products (name, slug, sku, category_id, description, specs, applications, market_price_min, market_price_max, stock, image, images, featured, badge, active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(name, slug || slugify(name), sku || null, category_id || null, description || null,
      JSON.stringify(specsArr), JSON.stringify(appsArr),
      parseFloat(market_price_min) || null, parseFloat(market_price_max) || null,
      parseInt(stock) || 0, image, JSON.stringify(extraImages), featured ? 1 : 0, badge || null, active ? 1 : 0);

    saveTiers(r.lastInsertRowid, req.body);
    flash(req, 'success', 'Produkt wurde erstellt.');
    res.redirect('/admin/produkte');
  } catch (e) {
    flash(req, 'error', 'Fehler: ' + e.message);
    res.redirect('/admin/produkte/neu');
  }
});

router.get('/produkte/:id/bearbeiten', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!product) return res.redirect('/admin/produkte');
  const tiers = db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(product.id);
  const categories = db.prepare('SELECT * FROM categories WHERE active=1').all();
  product.specsArr = product.specs ? JSON.parse(product.specs) : [];
  product.appsArr = product.applications ? JSON.parse(product.applications) : [];
  res.render('admin/product-edit', { title: 'Produkt bearbeiten', product, tiers, categories });
});

router.post('/produkte/:id/bearbeiten', uploadMulti.fields([{name:'image',maxCount:1},{name:'images',maxCount:5}]), (req, res) => {
  const { name, slug, sku, category_id, description, specs_raw, apps_raw, market_price_min, market_price_max, stock, featured, badge, active } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!product) return res.redirect('/admin/produkte');

  const image = req.files?.image?.[0] ? '/uploads/' + req.files.image[0].filename : product.image;
  const existingImages = product.images ? JSON.parse(product.images) : [];
  const newImages = (req.files?.images || []).map(f => '/uploads/' + f.filename);
  const extraImages = [...existingImages, ...newImages];
  const specsArr = parseTableInput(specs_raw);
  const appsArr = parseListInput(apps_raw);

  db.prepare(`
    UPDATE products SET name=?, slug=?, sku=?, category_id=?, description=?, specs=?, applications=?,
    market_price_min=?, market_price_max=?, stock=?, image=?, images=?, featured=?, badge=?, active=?, updated_at=datetime('now')
    WHERE id=?
  `).run(name, slug || slugify(name), sku || null, category_id || null, description || null,
    JSON.stringify(specsArr), JSON.stringify(appsArr),
    parseFloat(market_price_min) || null, parseFloat(market_price_max) || null,
    parseInt(stock) || 0, image, JSON.stringify(extraImages), featured ? 1 : 0, badge || null, active ? 1 : 0, req.params.id);

  saveTiers(req.params.id, req.body);
  flash(req, 'success', 'Produkt wurde aktualisiert.');
  res.redirect('/admin/produkte');
});

router.post('/produkte/:id/loeschen', (req, res) => {
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
  flash(req, 'success', 'Produkt wurde deaktiviert.');
  res.redirect('/admin/produkte');
});

// ─── CATEGORIES ─────────────────────────────────────────────────────────────
router.get('/kategorien', (req, res) => {
  const categories = db.prepare('SELECT c.*, COUNT(p.id) as product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.active=1 GROUP BY c.id ORDER BY c.sort_order').all();
  res.render('admin/categories', { title: 'Kategorien', categories });
});

router.post('/kategorien/neu', (req, res) => {
  const { name, slug, icon, description, sort_order } = req.body;
  try {
    db.prepare('INSERT INTO categories (name, slug, icon, description, sort_order) VALUES (?,?,?,?,?)').run(name, slug || slugify(name), icon || '📦', description || null, parseInt(sort_order) || 0);
    flash(req, 'success', 'Kategorie wurde erstellt.');
  } catch { flash(req, 'error', 'Fehler beim Erstellen der Kategorie.'); }
  res.redirect('/admin/kategorien');
});

router.post('/kategorien/:id/bearbeiten', (req, res) => {
  const { name, slug, icon, description, sort_order, active } = req.body;
  db.prepare('UPDATE categories SET name=?, slug=?, icon=?, description=?, sort_order=?, active=? WHERE id=?')
    .run(name, slug, icon, description, parseInt(sort_order) || 0, active ? 1 : 0, req.params.id);
  flash(req, 'success', 'Kategorie aktualisiert.');
  res.redirect('/admin/kategorien');
});

// ─── ORDERS ─────────────────────────────────────────────────────────────────
router.get('/bestellungen', (req, res) => {
  const { status } = req.query;
  const orders = status
    ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.render('admin/orders', { title: 'Bestellungen', orders, filterStatus: status });
});

router.get('/bestellungen/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.redirect('/admin/bestellungen');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  const customer = order.user_id ? db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id) : null;
  res.render('admin/order-detail', { title: `Bestellung ${order.order_number}`, order, items, customer });
});

router.post('/bestellungen/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.redirect('/admin/bestellungen');
  db.prepare("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?").run(status, req.params.id);
  flash(req, 'success', 'Bestellstatus aktualisiert.');
  res.redirect('/admin/bestellungen/' + req.params.id);
});

// ─── CUSTOMERS ──────────────────────────────────────────────────────────────
router.get('/kunden', (req, res) => {
  const customers = db.prepare(`
    SELECT u.*, COUNT(o.id) as order_count, COALESCE(SUM(o.total),0) as total_spent
    FROM users u LEFT JOIN orders o ON o.user_id=u.id
    WHERE u.role='customer' GROUP BY u.id ORDER BY u.created_at DESC
  `).all();
  res.render('admin/customers', { title: 'Kunden', customers });
});

router.post('/kunden/:id/sperren', (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=? AND role='customer'").get(req.params.id);
  if (!user) return res.redirect('/admin/kunden');
  db.prepare('UPDATE users SET active=? WHERE id=?').run(user.active ? 0 : 1, req.params.id);
  flash(req, 'success', user.active ? 'Kunde gesperrt.' : 'Kunde freigeschaltet.');
  res.redirect('/admin/kunden');
});

// ─── MESSAGES ───────────────────────────────────────────────────────────────
router.get('/nachrichten', (req, res) => {
  const messages = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC').all();
  const requests = db.prepare('SELECT * FROM price_list_requests ORDER BY created_at DESC LIMIT 50').all();
  res.render('admin/messages', { title: 'Nachrichten', messages, requests });
});

router.post('/nachrichten/:id/gelesen', (req, res) => {
  db.prepare("UPDATE contact_messages SET read_at=datetime('now') WHERE id=?").run(req.params.id);
  res.redirect('/admin/nachrichten');
});

router.post('/nachrichten/:id/loeschen', (req, res) => {
  db.prepare('DELETE FROM contact_messages WHERE id=?').run(req.params.id);
  flash(req, 'success', 'Nachricht gelöscht.');
  res.redirect('/admin/nachrichten');
});

// ─── COUPONS ────────────────────────────────────────────────────────────────
router.get('/kuponlar', (req, res) => {
  const coupons = db.prepare(`
    SELECT c.*, u.email as user_email
    FROM coupons c LEFT JOIN users u ON u.id=c.user_id
    ORDER BY c.created_at DESC
  `).all();
  res.render('admin/coupons', { title: 'Kuponlar', coupons });
});

router.post('/kuponlar/neu', (req, res) => {
  const { code, type, value, min_order, max_uses, expires_at, user_id } = req.body;
  if (!code || !type || !value) {
    flash(req, 'error', 'Code, Typ und Wert sind Pflichtfelder.');
    return res.redirect('/admin/kuponlar');
  }
  try {
    db.prepare(`
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

router.post('/kuponlar/:id/loeschen', (req, res) => {
  db.prepare('DELETE FROM coupons WHERE id=?').run(req.params.id);
  flash(req, 'success', 'Kupon gelöscht.');
  res.redirect('/admin/kuponlar');
});

router.post('/kuponlar/:id/toggle', (req, res) => {
  const c = db.prepare('SELECT active FROM coupons WHERE id=?').get(req.params.id);
  if (!c) return res.redirect('/admin/kuponlar');
  db.prepare('UPDATE coupons SET active=? WHERE id=?').run(c.active ? 0 : 1, req.params.id);
  flash(req, 'success', c.active ? 'Kupon deaktiviert.' : 'Kupon aktiviert.');
  res.redirect('/admin/kuponlar');
});

// ─── STOCK QUICK UPDATE ──────────────────────────────────────────────────────
router.post('/produkte/:id/stok', (req, res) => {
  const { stock } = req.body;
  db.prepare('UPDATE products SET stock=? WHERE id=?').run(parseInt(stock) || 0, req.params.id);
  res.json({ ok: true, stock: parseInt(stock) || 0 });
});

// ─── CUSTOMER DETAIL ─────────────────────────────────────────────────────────
router.get('/kunden/:id', (req, res) => {
  const customer = db.prepare("SELECT * FROM users WHERE id=? AND role='customer'").get(req.params.id);
  if (!customer) return res.redirect('/admin/kunden');
  const orders = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC').all(req.params.id);
  const totalSpent = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);
  const coupons = db.prepare('SELECT * FROM coupons WHERE user_id=? ORDER BY created_at DESC').all(req.params.id);
  res.render('admin/customer-detail', { title: `Kunde: ${customer.name || customer.email}`, customer, orders, totalSpent, coupons });
});

// ─── PRICE LIST REQUESTS ─────────────────────────────────────────────────────
router.post('/preisanfragen/:id/erledigt', (req, res) => {
  db.prepare('UPDATE price_list_requests SET sent=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── SETTINGS ───────────────────────────────────────────────────────────────
router.get('/einstellungen', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.render('admin/settings', { title: 'Einstellungen', settings });
});

router.post('/einstellungen', (req, res) => {
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateAll = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      if (key !== '_csrf') update.run(key, value);
    }
  });
  updateAll(req.body);
  flash(req, 'success', 'Einstellungen gespeichert.');
  res.redirect('/admin/einstellungen');
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

function saveTiers(productId, body) {
  db.prepare('DELETE FROM product_tiers WHERE product_id=?').run(productId);
  const minQtys = [].concat(body.tier_min || []);
  const maxQtys = [].concat(body.tier_max || []);
  const prices = [].concat(body.tier_price || []);
  const labels = [].concat(body.tier_label || []);
  for (let i = 0; i < prices.length; i++) {
    if (!prices[i]) continue;
    const minQ = parseInt(minQtys[i]) || 1;
    const maxQ = maxQtys[i] ? parseInt(maxQtys[i]) : null;
    db.prepare('INSERT INTO product_tiers (product_id, min_qty, max_qty, price, label) VALUES (?,?,?,?,?)')
      .run(productId, minQ, maxQ, parseFloat(prices[i]), labels[i] || null);
  }
}

module.exports = router;
