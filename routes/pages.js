const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { flash } = require('../middleware/auth');

router.get('/ueber-uns', (req, res) => res.render('pages/about', { title: 'Über uns' }));
router.get('/faq', (req, res) => res.render('pages/faq', { title: 'FAQ' }));
router.get('/impressum', (req, res) => res.render('pages/impressum', { title: 'Impressum' }));
router.get('/agb', (req, res) => res.render('pages/agb', { title: 'AGB' }));
router.get('/datenschutz', (req, res) => res.render('pages/datenschutz', { title: 'Datenschutz' }));
router.get('/widerruf', (req, res) => res.render('pages/widerruf', { title: 'Widerrufsrecht' }));

router.get('/kontakt', (req, res) => res.render('pages/contact', { title: 'Kontakt' }));

router.post('/kontakt', (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !message) {
    flash(req, 'error', 'Bitte füllen Sie alle Pflichtfelder aus.');
    return res.redirect('/kontakt');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    flash(req, 'error', 'Ungültige E-Mail-Adresse.');
    return res.redirect('/kontakt');
  }
  db.prepare('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?,?,?,?,?)')
    .run(name.trim(), email.trim(), phone || null, subject || null, message.trim());
  flash(req, 'success', 'Ihre Nachricht wurde gesendet. Wir melden uns so schnell wie möglich!');
  res.redirect('/kontakt');
});

module.exports = router;
