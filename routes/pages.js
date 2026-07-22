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

// ─── Markenseiten (tek şablon → yeni marka otomatik sayfa) ───────────────────
router.get('/marken', async (req, res) => {
  try {
    const brands = await db.prepare(`SELECT b.*, COUNT(p.id) as cnt FROM brands b
      LEFT JOIN products p ON p.brand_id=b.id AND p.active=1
      WHERE b.active=1 GROUP BY b.id ORDER BY b.sort_order, b.name`).all();
    res.render('pages/brands', {
      title: 'Marken & Hersteller',
      brands,
      metaDesc: 'Unsere Partner-Marken: ' + brands.map(b => b.name).join(', ') + ' – CE-zertifizierte Elektrokomponenten im B2B-Großhandel bei Imera Elektro.',
    });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.get('/marken/:slug', async (req, res) => {
  try {
    const brand = await db.prepare('SELECT * FROM brands WHERE slug=? AND active=1').get(req.params.slug);
    if (!brand) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Marke nicht gefunden.', code: 404 });
    const [products, catalogs, totalRow] = await Promise.all([
      db.prepare(`SELECT p.*, c.name as cat_name, c.slug as cat_slug,
           (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
         FROM products p LEFT JOIN categories c ON p.category_id=c.id
         WHERE p.brand_id=? AND p.active=1 ORDER BY p.featured DESC, p.name LIMIT 24`).all(brand.id),
      db.prepare('SELECT * FROM brand_catalogs WHERE brand_id=? ORDER BY sort_order, id').all(brand.id),
      db.prepare('SELECT COUNT(*) as n FROM products WHERE brand_id=? AND active=1').get(brand.id),
    ]);
    res.render('pages/brand', {
      title: `${brand.name} Produkte kaufen – Großhandel`,
      brand, products, catalogs, total: totalRow.n,
      metaDesc: (brand.description || `${brand.name} Produkte im B2B-Großhandel bei Imera Elektro – CE-zertifiziert, schnelle Lieferung ab Lager in Österreich.`).slice(0, 300),
      ogTitle: `${brand.name} – Imera Elektro`,
    });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

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
