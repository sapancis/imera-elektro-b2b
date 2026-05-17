const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { flash } = require('../middleware/auth');
const { sendOrderConfirmation, sendAdminOrderNotification } = require('../utils/mailer');

async function calcItemPrice(productId, qty) {
  const tier = await db.prepare(`
    SELECT price FROM product_tiers
    WHERE product_id=? AND min_qty<=? AND (max_qty IS NULL OR max_qty>=?)
    ORDER BY min_qty DESC LIMIT 1
  `).get(productId, qty, qty);
  return tier ? tier.price : null;
}

async function buildOrderItems(cart) {
  const items = [];
  let subtotal = 0;
  for (const [productId, qty] of Object.entries(cart)) {
    const product = await db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
    if (!product) continue;
    const unitPrice = await calcItemPrice(parseInt(productId), qty);
    if (!unitPrice) continue;
    subtotal += unitPrice * qty;
    items.push({ product, qty, unitPrice, lineTotal: unitPrice * qty });
  }
  return { items, subtotal };
}

async function applyCoupon(code, subtotal, userId) {
  if (!code) return { discount: 0, coupon: null, error: null };
  const coupon = await db.prepare("SELECT * FROM coupons WHERE UPPER(code)=UPPER(?) AND active=1").get(code.trim());
  if (!coupon) return { discount: 0, coupon: null, error: 'Gutscheincode nicht gefunden.' };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return { discount: 0, coupon: null, error: 'Gutschein ist abgelaufen.' };
  if (coupon.used_count >= coupon.max_uses) return { discount: 0, coupon: null, error: 'Gutschein wurde bereits verwendet.' };
  if (coupon.user_id && coupon.user_id !== userId) return { discount: 0, coupon: null, error: 'Dieser Gutschein ist personalisiert.' };
  if (subtotal < coupon.min_order) return { discount: 0, coupon: null, error: `Mindestbestellwert: ${coupon.min_order.toFixed(2)}€` };
  const discount = coupon.type === 'percent' ? parseFloat((subtotal * coupon.value / 100).toFixed(2)) : Math.min(coupon.value, subtotal);
  return { discount, coupon, error: null };
}

router.get('/', async (req, res) => {
  try {
    const cart = req.session.cart || {};
    if (!Object.keys(cart).length) return res.redirect('/warenkorb');
    const { items, subtotal } = await buildOrderItems(cart);
    const freeThresholdRow = await db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get();
    const freeThreshold = parseFloat(freeThresholdRow?.value || 200);
    const shipping = subtotal >= freeThreshold ? 0 : 7.90;
    const total = subtotal + shipping;
    const user = req.session.userId ? await db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId) : null;
    const isStammkunde = user?.stammkunde === 1;
    const stripeKeyRow = await db.prepare("SELECT value FROM settings WHERE key='stripe_publishable_key'").get();
    const stripeKey = stripeKeyRow?.value || '';
    res.render('checkout', { title: 'Kasse', items, subtotal, shipping, total, user, stripeKey, isStammkunde });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// Coupon prüfen (AJAX)
router.post('/coupon-pruefen', async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    const sub = parseFloat(subtotal) || 0;
    const { discount, coupon, error } = await applyCoupon(code, sub, req.session.userId || null);
    if (error) return res.json({ ok: false, message: error });
    res.json({ ok: true, discount, type: coupon.type, value: coupon.value, message: `Gutschein angewendet: -${coupon.type === 'percent' ? coupon.value + '%' : coupon.value.toFixed(2) + '€'}` });
  } catch { res.status(500).json({ ok: false, message: 'Serverfehler.' }); }
});

router.post('/bestellung', async (req, res) => {
  try {
    const cart = req.session.cart || {};
    if (!Object.keys(cart).length) return res.redirect('/warenkorb');

    const { name, email, company, phone, address, payment_method, notes, coupon_code } = req.body;
    if (!name || !email || !address) {
      flash(req, 'error', 'Bitte füllen Sie alle Pflichtfelder aus.');
      return res.redirect('/kasse');
    }

    // Rechnungskauf nur für freigeschaltete Stammkunden
    if (payment_method === 'invoice') {
      const userId = req.session.userId || null;
      const user = userId ? await db.prepare('SELECT stammkunde FROM users WHERE id=?').get(userId) : null;
      if (!user || !user.stammkunde) {
        flash(req, 'error', 'Rechnungskauf ist nur für freigeschaltete Stammkunden verfügbar. Bitte wählen Sie Überweisung oder kontaktieren Sie uns.');
        return res.redirect('/kasse');
      }
    }

    const { items, subtotal } = await buildOrderItems(cart);
    if (!items.length) return res.redirect('/warenkorb');

    // ── Checkout stok kontrolü ───────────────────────────────────────
    const stockErrors = [];
    for (const item of items) {
      const current = await db.prepare('SELECT stock, name FROM products WHERE id=?').get(item.product.id);
      if (!current || current.stock < item.qty) {
        stockErrors.push(`"${item.product.name}": Nur noch ${current?.stock || 0} Stk. auf Lager (Sie möchten ${item.qty})`);
      }
    }
    if (stockErrors.length) {
      flash(req, 'error', 'Lagerproblem: ' + stockErrors.join(' | '));
      return res.redirect('/warenkorb');
    }

    const freeThresholdRow = await db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get();
    const freeThreshold = parseFloat(freeThresholdRow?.value || 200);
    const shipping = subtotal >= freeThreshold ? 0 : 7.90;
    const { discount, coupon } = await applyCoupon(coupon_code, subtotal, req.session.userId || null);
    const total = Math.max(0, subtotal + shipping - discount);
    const orderNumber = 'IE-' + Date.now();
    const userId = req.session.userId || null;

    const createOrder = db.transaction(async () => {
      const r = await db.prepare(`
        INSERT INTO orders (order_number, user_id, guest_email, guest_name, guest_company, payment_method, subtotal, shipping, total, notes, shipping_address)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(orderNumber, userId, userId ? null : email, userId ? null : name, userId ? null : company,
        payment_method || 'transfer', subtotal, shipping, total, notes || null, address);

      for (const item of items) {
        await db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?,?)`)
          .run(r.lastInsertRowid, item.product.id, item.product.name, item.product.sku, item.qty, item.unitPrice, item.lineTotal);
        // ── A) Stok düşür ─────────────────────────────────────────────
        await db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id=?')
          .run(item.qty, item.product.id);
      }

      if (coupon) await db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=?').run(coupon.id);
      return r.lastInsertRowid;
    });

    const orderId = await createOrder();
    req.session.cart = {};
    req.session.lastOrderNumber = orderNumber;

    // ── B) E-posta bildirimleri (asenkron, hata siparişi engellemez) ──
    const savedOrder = await db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    const savedItems = await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
    // Üye için email users tablosundan, misafir için formdan al
    const customerUser  = userId ? await db.prepare('SELECT name, email FROM users WHERE id=?').get(userId) : null;
    const customerName  = customerUser?.name  || name  || req.session.userName  || 'Kunde';
    const customerEmail = customerUser?.email || email || req.session.userEmail || '';

    if (customerEmail) {
      sendOrderConfirmation({ order: savedOrder, items: savedItems, customerEmail, customerName })
        .catch(e => console.error('Bestätigungsmail Fehler:', e.message));
    }
    sendAdminOrderNotification({ order: savedOrder, items: savedItems, customerName, customerEmail })
      .catch(e => console.error('Admin-Mail Fehler:', e.message));

    res.redirect('/kasse/bestaetigung');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// Stripe Checkout Session
router.post('/stripe-session', async (req, res) => {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) return res.json({ ok: false, message: 'Stripe nicht konfiguriert.' });
    const stripe = require('stripe')(stripeSecret);
    const cart = req.session.cart || {};
    if (!Object.keys(cart).length) return res.json({ ok: false, message: 'Warenkorb ist leer.' });
    const { items, subtotal } = await buildOrderItems(cart);
    const freeThresholdRow = await db.prepare("SELECT value FROM settings WHERE key='free_shipping_threshold'").get();
    const freeThreshold = parseFloat(freeThresholdRow?.value || 200);
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

router.get('/bestaetigung', async (req, res) => {
  try {
    const orderNumber = req.session.lastOrderNumber;
    if (!orderNumber && !req.query.stripe) return res.redirect('/');
    const order = orderNumber ? await db.prepare('SELECT * FROM orders WHERE order_number=?').get(orderNumber) : null;
    const items = order ? await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id) : [];
    res.render('confirmation', { title: 'Bestellung bestätigt', order, items, bankIban: process.env.BANK_IBAN || '' });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

module.exports = router;
