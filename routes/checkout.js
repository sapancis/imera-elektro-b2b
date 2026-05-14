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

function applyCoupon(code, subtotal, userId) {
  if (!code) return { discount: 0, coupon: null, error: null };
  const coupon = db.prepare("SELECT * FROM coupons WHERE UPPER(code)=UPPER(?) AND active=1").get(code.trim());
  if (!coupon) return { discount: 0, coupon: null, error: 'Gutscheincode nicht gefunden.' };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return { discount: 0, coupon: null, error: 'Gutschein ist abgelaufen.' };
  if (coupon.used_count >= coupon.max_uses) return { discount: 0, coupon: null, error: 'Gutschein wurde bereits verwendet.' };
  if (coupon.user_id && coupon.user_id !== userId) return { discount: 0, coupon: null, error: 'Dieser Gutschein ist personalisiert.' };
  if (subtotal < coupon.min_order) return { discount: 0, coupon: null, error: `Mindestbestellwert: ${coupon.min_order.toFixed(2)}€` };
  const discount = coupon.type === 'percent' ? parseFloat((subtotal * coupon.value / 100).toFixed(2)) : Math.min(coupon.value, subtotal);
  return { discount, coupon, error: null };
}

router.get('/', (req, res) => {
  const cart = req.session.cart || {};
  if (!Object.keys(cart).length) return res.redirect('/warenkorb');
  const { items, subtotal } = buildOrderItems(cart);
  const freeThreshold = parseFloat(db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get()?.value || 200);
  const shipping = subtotal >= freeThreshold ? 0 : 7.90;
  const total = subtotal + shipping;
  const user = req.session.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId) : null;
  const stripeKey = db.prepare("SELECT value FROM settings WHERE key='stripe_publishable_key'").get()?.value || '';
  res.render('checkout', { title: 'Kasse', items, subtotal, shipping, total, user, stripeKey });
});

// Coupon prüfen (AJAX)
router.post('/coupon-pruefen', (req, res) => {
  const { code, subtotal } = req.body;
  const sub = parseFloat(subtotal) || 0;
  const { discount, coupon, error } = applyCoupon(code, sub, req.session.userId || null);
  if (error) return res.json({ ok: false, message: error });
  res.json({ ok: true, discount, type: coupon.type, value: coupon.value, message: `Gutschein angewendet: -${coupon.type === 'percent' ? coupon.value + '%' : coupon.value.toFixed(2) + '€'}` });
});

router.post('/bestellung', (req, res) => {
  const cart = req.session.cart || {};
  if (!Object.keys(cart).length) return res.redirect('/warenkorb');

  const { name, email, company, phone, address, payment_method, notes, coupon_code } = req.body;
  if (!name || !email || !address) {
    flash(req, 'error', 'Bitte füllen Sie alle Pflichtfelder aus.');
    return res.redirect('/kasse');
  }

  const { items, subtotal } = buildOrderItems(cart);
  if (!items.length) return res.redirect('/warenkorb');

  const freeThreshold = parseFloat(db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get()?.value || 200);
  const shipping = subtotal >= freeThreshold ? 0 : 7.90;
  const { discount, coupon } = applyCoupon(coupon_code, subtotal, req.session.userId || null);
  const total = Math.max(0, subtotal + shipping - discount);
  const orderNumber = 'IE-' + Date.now();
  const userId = req.session.userId || null;

  const createOrder = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO orders (order_number, user_id, guest_email, guest_name, guest_company, payment_method, subtotal, shipping, total, notes, shipping_address)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(orderNumber, userId, userId ? null : email, userId ? null : name, userId ? null : company,
      payment_method || 'transfer', subtotal, shipping, total, notes || null, address);
    for (const item of items) {
      db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?,?)`)
        .run(r.lastInsertRowid, item.product.id, item.product.name, item.product.sku, item.qty, item.unitPrice, item.lineTotal);
    }
    if (coupon) db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=?').run(coupon.id);
    return r.lastInsertRowid;
  });

  createOrder();
  req.session.cart = {};
  req.session.lastOrderNumber = orderNumber;
  res.redirect('/kasse/bestaetigung');
});

// Stripe Checkout Session
router.post('/stripe-session', async (req, res) => {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) return res.json({ ok: false, message: 'Stripe nicht konfiguriert.' });
    const stripe = require('stripe')(stripeSecret);
    const cart = req.session.cart || {};
    if (!Object.keys(cart).length) return res.json({ ok: false, message: 'Warenkorb ist leer.' });
    const { items, subtotal } = buildOrderItems(cart);
    const freeThreshold = parseFloat(db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get()?.value || 200);
    const shipping = subtotal >= freeThreshold ? 0 : 7.90;

    const lineItems = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: { name: item.product.name, description: item.product.sku || undefined },
        unit_amount: Math.round(item.unitPrice * 100),
      },
      quantity: item.qty,
    }));
    if (shipping > 0) {
      lineItems.push({ price_data: { currency: 'eur', product_data: { name: 'Versandkosten' }, unit_amount: Math.round(shipping * 100) }, quantity: 1 });
    }

    const base = `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${base}/kasse/bestaetigung?stripe=1`,
      cancel_url: `${base}/kasse`,
      customer_email: req.session.userEmail || undefined,
    });
    res.json({ ok: true, url: session.url });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

router.get('/bestaetigung', (req, res) => {
  const orderNumber = req.session.lastOrderNumber;
  if (!orderNumber && !req.query.stripe) return res.redirect('/');
  const order = orderNumber ? db.prepare('SELECT * FROM orders WHERE order_number=?').get(orderNumber) : null;
  const items = order ? db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id) : [];
  res.render('confirmation', { title: 'Bestellung bestätigt', order, items });
});

module.exports = router;
