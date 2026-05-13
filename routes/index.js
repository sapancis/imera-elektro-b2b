const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY sort_order').all();
  const featured = db.prepare(`
    SELECT p.*, c.name as cat_name,
      (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
    FROM products p
    LEFT JOIN categories c ON p.category_id=c.id
    WHERE p.active=1 AND p.featured=1
    ORDER BY p.id LIMIT 3
  `).all();

  for (const p of featured) {
    p.tiers = db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(p.id);
  }

  const settings = getSettings();
  res.render('index', { title: 'Startseite', categories, featured, settings });
});

router.post('/preisliste', (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({ ok: false, message: 'Ungültige E-Mail-Adresse.' });
  }
  try {
    db.prepare('INSERT OR IGNORE INTO price_list_requests (email) VALUES (?)').run(email.trim().toLowerCase());
    res.json({ ok: true, message: 'Danke! Sie erhalten unsere Preisliste in Kürze.' });
  } catch {
    res.json({ ok: false, message: 'Ein Fehler ist aufgetreten.' });
  }
});

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

module.exports = router;
