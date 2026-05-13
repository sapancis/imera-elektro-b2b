const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { requireAuth, flash } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  const orders = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 5').all(req.session.userId);
  res.render('account/dashboard', { title: 'Mein Konto', user, orders });
});

router.get('/bestellungen', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC').all(req.session.userId);
  for (const o of orders) {
    o.items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
  }
  res.render('account/orders', { title: 'Meine Bestellungen', orders });
});

router.get('/bestellungen/:number', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_number=? AND user_id=?').get(req.params.number, req.session.userId);
  if (!order) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Bestellung nicht gefunden.', code: 404 });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  res.render('account/order-detail', { title: `Bestellung ${order.order_number}`, order, items });
});

router.post('/profil', requireAuth, (req, res) => {
  const { name, company, phone, address } = req.body;
  db.prepare('UPDATE users SET name=?, company=?, phone=?, address=? WHERE id=?')
    .run(name, company, phone, address, req.session.userId);
  req.session.userName = name;
  flash(req, 'success', 'Profil wurde aktualisiert.');
  res.redirect('/konto');
});

router.post('/passwort', requireAuth, (req, res) => {
  const { current, password, password2 } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  if (!bcrypt.compareSync(current, user.password_hash)) {
    flash(req, 'error', 'Aktuelles Passwort ist falsch.');
    return res.redirect('/konto');
  }
  if (password !== password2 || password.length < 8) {
    flash(req, 'error', 'Neues Passwort ungültig (min. 8 Zeichen, Passwörter müssen übereinstimmen).');
    return res.redirect('/konto');
  }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 12), req.session.userId);
  flash(req, 'success', 'Passwort wurde geändert.');
  res.redirect('/konto');
});

module.exports = router;
