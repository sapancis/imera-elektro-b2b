const express = require('express');
const router = express.Router();
const db = require('../database/db');
const crypto = require('crypto');

function getCart(req) { return req.session.cart || {}; }

function calcItemPrice(productId, qty) {
  const tier = db.prepare(`
    SELECT price FROM product_tiers
    WHERE product_id=? AND min_qty<=? AND (max_qty IS NULL OR max_qty>=?)
    ORDER BY min_qty DESC LIMIT 1
  `).get(productId, qty, qty);
  return tier ? tier.price : null;
}

router.get('/', (req, res) => {
  const cart = getCart(req);
  const items = [];
  let subtotal = 0;

  for (const [productId, qty] of Object.entries(cart)) {
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
    if (!product) continue;
    const unitPrice = calcItemPrice(parseInt(productId), qty);
    if (!unitPrice) continue;
    const lineTotal = unitPrice * qty;
    subtotal += lineTotal;
    const tiers = db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(productId);
    items.push({ product, qty, unitPrice, lineTotal, tiers });
  }

  const freeShippingThreshold = parseFloat(db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get()?.value || 200);
  const shipping = subtotal >= freeShippingThreshold ? 0 : 7.90;
  const total = subtotal + shipping;

  res.render('cart', { title: 'Warenkorb', items, subtotal, shipping, total, freeShippingThreshold });
});

router.post('/hinzufuegen', (req, res) => {
  const productId = parseInt(req.body.product_id);
  const qty = Math.max(1, parseInt(req.body.qty) || 1);

  const product = db.prepare('SELECT id, stock FROM products WHERE id=? AND active=1').get(productId);
  if (!product) return res.json({ ok: false, message: 'Produkt nicht gefunden.' });

  if (!req.session.cart) req.session.cart = {};
  const current = req.session.cart[productId] || 0;
  req.session.cart[productId] = current + qty;

  const cartCount = Object.values(req.session.cart).reduce((s, q) => s + q, 0);
  res.json({ ok: true, cartCount, message: 'Produkt wurde in den Warenkorb gelegt.' });
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

router.post('/speichern', (req, res) => {
  const cart = getCart(req);
  if (!Object.keys(cart).length) return res.json({ ok: false, message: 'Warenkorb ist leer.' });
  const token = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO saved_carts (token, user_id, items, expires_at) VALUES (?,?,?,?)')
    .run(token, req.session.userId || null, JSON.stringify(cart), expires);
  const link = `${req.protocol}://${req.get('host')}/warenkorb/laden/${token}`;
  res.json({ ok: true, link });
});

router.get('/laden/:token', (req, res) => {
  const saved = db.prepare('SELECT * FROM saved_carts WHERE token=? AND expires_at>datetime("now")').get(req.params.token);
  if (!saved) return res.redirect('/warenkorb');
  req.session.cart = JSON.parse(saved.items);
  res.redirect('/warenkorb');
});

module.exports = router;
