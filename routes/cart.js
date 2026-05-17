const express = require('express');
const router = express.Router();
const db = require('../database/db');
const crypto = require('crypto');
const multer = require('multer');
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

function getCart(req) { return req.session.cart || {}; }

async function calcItemPrice(productId, qty) {
  const tier = await db.prepare(`
    SELECT price FROM product_tiers
    WHERE product_id=? AND min_qty<=? AND (max_qty IS NULL OR max_qty>=?)
    ORDER BY min_qty DESC LIMIT 1
  `).get(productId, qty, qty);
  return tier ? tier.price : null;
}

router.get('/', async (req, res) => {
  try {
    const cart = getCart(req);
    const items = [];
    let subtotal = 0;

    for (const [productId, qty] of Object.entries(cart)) {
      const product = await db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
      if (!product) continue;
      const unitPrice = await calcItemPrice(parseInt(productId), qty);
      if (!unitPrice) continue;
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;
      const tiers = await db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(productId);
      const nextTier = await db.prepare('SELECT * FROM product_tiers WHERE product_id=? AND min_qty>? ORDER BY min_qty ASC LIMIT 1').get(productId, qty);
      items.push({ product, qty, unitPrice, lineTotal, tiers, nextTier });
    }

    const freeShippingThresholdRow = await db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get();
    const freeShippingThreshold = parseFloat(freeShippingThresholdRow?.value || 200);
    const shipping = subtotal >= freeShippingThreshold ? 0 : 7.90;
    const total = subtotal + shipping;

    res.render('cart', { title: 'Warenkorb', items, subtotal, shipping, total, freeShippingThreshold });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/hinzufuegen', async (req, res) => {
  try {
    const productId = parseInt(req.body.product_id);
    const qty = Math.max(1, parseInt(req.body.qty) || 1);

    const product = await db.prepare('SELECT id, name, stock FROM products WHERE id=? AND active=1').get(productId);
    if (!product) return res.json({ ok: false, message: 'Produkt nicht gefunden.' });

    // ── Stok kontrolü ────────────────────────────────────────────────
    if (product.stock <= 0) {
      return res.json({ ok: false, message: `"${product.name}" ist leider ausverkauft.` });
    }
    if (!req.session.cart) req.session.cart = {};
    const alreadyInCart = req.session.cart[productId] || 0;
    const totalRequested = alreadyInCart + qty;
    if (totalRequested > product.stock) {
      const available = product.stock - alreadyInCart;
      if (available <= 0) {
        return res.json({ ok: false, message: `Sie haben bereits die maximale Menge (${product.stock} Stk.) im Warenkorb.` });
      }
      req.session.cart[productId] = product.stock;
      const cartCount = Object.values(req.session.cart).reduce((s, q) => s + q, 0);
      return res.json({ ok: true, cartCount, message: `Nur noch ${product.stock} Stk. auf Lager – Menge auf ${product.stock} angepasst.` });
    }

    req.session.cart[productId] = totalRequested;
    const cartCount = Object.values(req.session.cart).reduce((s, q) => s + q, 0);
    req.session.save(() => {
      res.json({ ok: true, cartCount, message: 'Produkt wurde in den Warenkorb gelegt.' });
    });
  } catch { res.status(500).json({ ok: false, message: 'Serverfehler.' }); }
});

router.post('/aktualisieren', (req, res) => {
  const { product_id, qty } = req.body;
  const newQty = parseInt(qty);
  if (!req.session.cart) req.session.cart = {};

  if (newQty <= 0) {
    delete req.session.cart[product_id];
  } else {
    req.session.cart[product_id] = newQty;
  }
  res.redirect('/warenkorb');
});

router.post('/entfernen', (req, res) => {
  const { product_id } = req.body;
  if (req.session.cart) delete req.session.cart[product_id];
  res.redirect('/warenkorb');
});

router.post('/speichern', async (req, res) => {
  try {
    const cart = getCart(req);
    if (!Object.keys(cart).length) return res.json({ ok: false, message: 'Warenkorb ist leer.' });
    const token = crypto.randomBytes(16).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare('INSERT INTO saved_carts (token, user_id, items, expires_at) VALUES (?,?,?,?)')
      .run(token, req.session.userId || null, JSON.stringify(cart), expires);
    const link = `${req.protocol}://${req.get('host')}/warenkorb/laden/${token}`;
    res.json({ ok: true, link });
  } catch { res.status(500).json({ ok: false, message: 'Serverfehler.' }); }
});

router.get('/laden/:token', async (req, res) => {
  try {
    const saved = await db.prepare("SELECT * FROM saved_carts WHERE token=? AND expires_at>datetime('now')").get(req.params.token);
    if (!saved) return res.redirect('/warenkorb');
    req.session.cart = JSON.parse(saved.items);
    res.redirect('/warenkorb');
  } catch { res.redirect('/warenkorb'); }
});

// Schnell-Bestellformular: SKU/Name suche
router.get('/schnellsuche', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const results = await db.prepare(`
      SELECT id, name, sku,
        (SELECT MIN(price) FROM product_tiers WHERE product_id=products.id) as price_min,
        stock
      FROM products
      WHERE active=1 AND (sku LIKE ? OR name LIKE ?)
      LIMIT 8
    `).all(`%${q}%`, `%${q}%`);
    res.json(results);
  } catch { res.status(500).json([]); }
});

// Schnell-Bestellung: Mehrere Positionen auf einmal in den Warenkorb
router.post('/schnellbestellung', async (req, res) => {
  try {
    let lines = req.body.lines; // [{sku, qty}]
    if (typeof lines === 'string') {
      try { lines = JSON.parse(lines); } catch { lines = []; }
    }
    if (!Array.isArray(lines)) lines = [];

    if (!req.session.cart) req.session.cart = {};
    let added = 0;
    const errors = [];

    for (const line of lines) {
      const sku = (line.sku || '').trim().toUpperCase();
      const qty = Math.max(1, parseInt(line.qty) || 1);
      if (!sku) continue;

      const product = await db.prepare('SELECT id, stock FROM products WHERE active=1 AND UPPER(sku)=?').get(sku);
      if (!product) { errors.push(`Art.-Nr. "${sku}" nicht gefunden`); continue; }

      const current = req.session.cart[product.id] || 0;
      req.session.cart[product.id] = current + qty;
      added++;
    }

    const cartCount = Object.values(req.session.cart).reduce((s, q) => s + q, 0);
    res.json({ ok: added > 0, added, errors, cartCount,
      message: added > 0 ? `${added} Produkt(e) zum Warenkorb hinzugefügt.` : 'Keine Produkte gefunden.' });
  } catch { res.status(500).json({ ok: false, message: 'Serverfehler.' }); }
});

// CSV Upload: SKU;Menge oder SKU,Menge
router.post('/csv-upload', csvUpload.single('csv'), async (req, res) => {
  try {
    if (!req.file) return res.json({ ok: false, message: 'Keine Datei hochgeladen.' });
    const text = req.file.buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('SKU') && !l.startsWith('Artikelnummer'));
    if (!req.session.cart) req.session.cart = {};
    let added = 0; const errors = [];
    for (const line of lines) {
      const parts = line.split(/[;,\t]/);
      const sku = (parts[0] || '').trim().toUpperCase();
      const qty = Math.max(1, parseInt(parts[1]) || 1);
      if (!sku) continue;
      const product = await db.prepare('SELECT id FROM products WHERE active=1 AND UPPER(sku)=?').get(sku);
      if (!product) { errors.push(`"${sku}" nicht gefunden`); continue; }
      req.session.cart[product.id] = (req.session.cart[product.id] || 0) + qty;
      added++;
    }
    const cartCount = Object.values(req.session.cart).reduce((s, q) => s + q, 0);
    res.json({ ok: added > 0, added, errors, cartCount, message: added > 0 ? `${added} Produkt(e) importiert.` : 'Keine Produkte importiert.' });
  } catch { res.status(500).json({ ok: false, message: 'Serverfehler.' }); }
});

module.exports = router;
