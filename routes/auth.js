const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { flash } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Zu viele Anmeldeversuche. Bitte versuchen Sie es in 15 Minuten erneut.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/konto');
  res.render('account/login', { title: 'Anmelden', mode: 'login' });
});

router.get('/registrieren', (req, res) => {
  if (req.session.userId) return res.redirect('/konto');
  res.render('account/login', { title: 'Registrieren', mode: 'register' });
});

router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    flash(req, 'error', 'Bitte füllen Sie alle Felder aus.');
    return res.redirect('/konto/login');
  }

  const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    flash(req, 'error', 'E-Mail oder Passwort ist falsch.');
    return res.redirect('/konto/login');
  }

  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userEmail = user.email;
  req.session.userRole = user.role;

  db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(user.id);

  const returnTo = req.session.returnTo || (user.role === 'admin' ? '/admin' : '/konto');
  delete req.session.returnTo;

  flash(req, 'success', `Willkommen zurück, ${user.name || user.email}!`);
  res.redirect(returnTo);
});

router.post('/registrieren', (req, res) => {
  const { name, email, company, phone, password, password2, datenschutz } = req.body;
  if (!email || !password) {
    flash(req, 'error', 'Bitte füllen Sie alle Pflichtfelder aus.');
    return res.redirect('/konto/registrieren');
  }
  if (!datenschutz) {
    flash(req, 'error', 'Bitte stimmen Sie der Datenschutzerklärung zu, um fortzufahren.');
    return res.redirect('/konto/registrieren');
  }
  if (password !== password2) {
    flash(req, 'error', 'Passwörter stimmen nicht überein.');
    return res.redirect('/konto/registrieren');
  }
  if (password.length < 8) {
    flash(req, 'error', 'Das Passwort muss mindestens 8 Zeichen lang sein.');
    return res.redirect('/konto/registrieren');
  }

  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase().trim());
  if (exists) {
    flash(req, 'error', 'Diese E-Mail-Adresse ist bereits registriert.');
    return res.redirect('/konto/registrieren');
  }

  const hash = bcrypt.hashSync(password, 12);
  const r = db.prepare(`
    INSERT INTO users (email, password_hash, name, company, phone) VALUES (?,?,?,?,?)
  `).run(email.toLowerCase().trim(), hash, name || null, company || null, phone || null);

  req.session.userId = r.lastInsertRowid;
  req.session.userName = name;
  req.session.userEmail = email;
  req.session.userRole = 'customer';

  // Willkommensrabatt-Coupon generieren
  try {
    const discountSetting = db.prepare("SELECT value FROM settings WHERE key='welcome_discount_percent'").get();
    const discountPercent = parseFloat(discountSetting?.value || '10');
    if (discountPercent > 0) {
      const code = 'WELCOME-' + Math.random().toString(36).substring(2,8).toUpperCase();
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
      db.prepare('INSERT INTO coupons (code, type, value, max_uses, user_id, expires_at) VALUES (?,?,?,?,?,?)')
        .run(code, 'percent', discountPercent, 1, r.lastInsertRowid, expires);
      flash(req, 'success', `Willkommen! Ihr ${discountPercent}% Willkommensrabatt-Code: ${code} (gültig 30 Tage)`);
    } else {
      flash(req, 'success', 'Willkommen bei Imera Elektro! Ihr Konto wurde erfolgreich erstellt.');
    }
  } catch {
    flash(req, 'success', 'Willkommen bei Imera Elektro! Ihr Konto wurde erfolgreich erstellt.');
  }
  res.redirect('/konto');
});

router.post('/abmelden', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
