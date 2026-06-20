const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { flash } = require('../middleware/auth');
const { sendContactNotification } = require('../utils/mailer');

router.get('/ueber-uns', (req, res) => res.render('pages/about', { title: 'Über uns' }));
router.get('/faq', (req, res) => res.render('pages/faq', { title: 'FAQ' }));
router.get('/impressum', (req, res) => res.render('pages/impressum', { title: 'Impressum' }));
router.get('/agb', (req, res) => res.render('pages/agb', { title: 'AGB' }));
router.get('/datenschutz', (req, res) => res.render('pages/datenschutz', { title: 'Datenschutz' }));
router.get('/widerruf', (req, res) => res.render('pages/widerruf', { title: 'Widerrufsrecht' }));

router.get('/kontakt', (req, res) => res.render('pages/contact', { title: 'Kontakt' }));

router.post('/kontakt', async (req, res) => {
  try {
    const { vorname, nachname, email, phone, subject, message } = req.body;
    const name = `${(vorname || '').trim()} ${(nachname || '').trim()}`.trim();
    if (!name || !email || !message) {
      flash(req, 'error', 'Bitte füllen Sie alle Pflichtfelder aus.');
      return res.redirect('/kontakt');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      flash(req, 'error', 'Ungültige E-Mail-Adresse.');
      return res.redirect('/kontakt');
    }
    await db.prepare('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?,?,?,?,?)')
      .run(name, email.trim(), phone || null, subject || null, message.trim());
    // E-Mail-Weiterleitung an info@imeragroup.com (async, blockiert die Antwort nicht)
    sendContactNotification({ name, email: email.trim(), phone, subject, message: message.trim() })
      .catch(e => console.error('Kontakt-Mail Fehler:', e.message));
    flash(req, 'success', 'Ihre Nachricht wurde gesendet. Wir melden uns so schnell wie möglich!');
    res.redirect('/kontakt');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

module.exports = router;
