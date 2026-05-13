const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { flash } = require('../middleware/auth');

function calcItemPrice(productId, qty) {
  const tier = db.prepare(`
    SELECT price FROM product_tiers
    WHERE product_id=? AND min_qty<=? AND (max_qty IS NULL OR max_qty>=?)
    ORDER BY min_qty DESC LIMIT 1
  `).get(productId, qty, qty);
  return tier ? tier.price : null;
}

function buildOrderItems(cart) {
  const items = [];
  let subtotal = 0;
  for (const [productId, qty] of Object.entries(cart)) {
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
    if (!product) continue;
    const unitPrice = calcItemPrice(parseInt(productId), qty);
    if (!unitPrice) continue;
    subtotal += unitPrice * qty;
    items.push({ product, qty, unitPrice, lineTotal: unitPrice * qty });
  }
  return { items, subtotal };
}

router.get('/', (req, res) => {
  const cart = req.session.cart || {};
  if (!Object.keys(cart).length) return res.redirect('/warenkorb');
  const { items, subtotal } = buildOrderItems(cart);
  const freeThreshold = parseFloat(db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get()?.value || 200);
  const shipping = subtotal >= freeThreshold ? 0 : 7.90;
  const total = subtotal + shipping;
  const user = req.session.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId) : null;
  res.render('checkout', { title: 'Kasse', items, subtotal, shipping, total, user });
});

router.post('/bestellung', (req, res) => {
  const cart = req.session.cart || {};
  if (!Object.keys(cart).length) return res.redirect('/warenkorb');

  const { name, email, company, phone, address, payment_method, notes } = req.body;
  if (!name || !email || !address) {
    flash(req, 'error', 'Bitte füllen Sie alle Pflichtfelder aus.');
    return res.redirect('/kasse');
  }

  const { items, subtotal } = buildOrderItems(cart);
  if (!items.length) return res.redirect('/warenkorb');

  const freeThreshold = parseFloat(db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get()?.value || 200);
  const shipping = subtotal >= freeThreshold ? 0 : 7.90;
  const total = subtotal + shipping;

  const orderNumber = 'IE-' + Date.now();
  const userId = req.session.userId || null;

  const createOrder = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO orders (order_number, user_id, guest_email, guest_name, guest_company, payment_method, subtotal, shipping, total, notes, shipping_address)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(orderNumber, userId, userId ? null : email, userId ? null : name, userId ? null : company, payment_method || 'transfer', subtotal, shipping, total, notes || null, address);

    for (const item of items) {
      db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, total_price)
        VALUES (?,?,?,?,?,?,?)
      `).run(r.lastInsertRowid, item.product.id, item.product.name, item.product.sku, item.qty, item.unitPrice, item.lineTotal);
    }
    return r.lastInsertRowid;
  });

  const orderId = createOrder();
  req.session.cart = {};
  req.session.lastOrderNumber = orderNumber;
  res.redirect('/kasse/bestaetigung');
});

router.get('/bestaetigung', (req, res) => {
  const orderNumber = req.session.lastOrderNumber;
  if (!orderNumber) return res.redirect('/');
  const order = db.prepare('SELECT * FROM orders WHERE order_number=?').get(orderNumber);
  const items = order ? db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id) : [];
  res.render('confirmation', { title: 'Bestellung bestätigt', order, items });
});

module.exports = router;
