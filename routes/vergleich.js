const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/', async (req, res) => {
  try {
    const ids = req.session.vergleich || [];
    const products = ids.length
      ? await db.prepare(`SELECT p.*, c.name as cat_name, (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id IN (${ids.map(()=>'?').join(',')}) AND p.active=1`).all(...ids)
      : [];
    for (const p of products) {
      p.tiers = await db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(p.id);
      p.specsArr = p.specs ? JSON.parse(p.specs) : [];
    }
    res.render('vergleich', { title: 'Produktvergleich', products });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/toggle', (req, res) => {
  const productId = parseInt(req.body.product_id);
  if (!productId) return res.json({ ok: false, message: 'Ungültige Produkt-ID.' });

  if (!req.session.vergleich) req.session.vergleich = [];
  const idx = req.session.vergleich.indexOf(productId);

  if (idx >= 0) {
    req.session.vergleich.splice(idx, 1);
    return res.json({ ok: true, action: 'removed', count: req.session.vergleich.length });
  }
  if (req.session.vergleich.length >= 3) {
    return res.json({ ok: false, message: 'Maximal 3 Produkte vergleichbar.' });
  }
  req.session.vergleich.push(productId);
  res.json({ ok: true, action: 'added', count: req.session.vergleich.length });
});

router.post('/leeren', (req, res) => {
  req.session.vergleich = [];
  res.redirect('/vergleich');
});

module.exports = router;
