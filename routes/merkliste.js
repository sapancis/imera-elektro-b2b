const express = require('express');
const router = express.Router();
const db = require('../database/db');

function getMerkliste(req) {
  if (req.session.userId) {
    return db.prepare(`
      SELECT p.*, (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
      FROM merkliste m JOIN products p ON p.id=m.product_id
      WHERE m.user_id=? AND p.active=1 ORDER BY m.created_at DESC
    `).all(req.session.userId);
  }
  const ids = req.session.merkliste || [];
  if (!ids.length) return [];
  return db.prepare(`
    SELECT *, (SELECT MIN(price) FROM product_tiers WHERE product_id=id) as price_min
    FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND active=1
  `).all(...ids);
}

router.get('/', (req, res) => {
  const products = getMerkliste(req);
  for (const p of products) p.tiers = db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(p.id);
  res.render('merkliste', { title: 'Merkliste', products });
});

router.post('/toggle', (req, res) => {
  const productId = parseInt(req.body.product_id);
  if (!productId) return res.json({ ok: false });

  if (req.session.userId) {
    const exists = db.prepare('SELECT id FROM merkliste WHERE user_id=? AND product_id=?').get(req.session.userId, productId);
    if (exists) {
      db.prepare('DELETE FROM merkliste WHERE user_id=? AND product_id=?').run(req.session.userId, productId);
      const count = db.prepare('SELECT COUNT(*) as c FROM merkliste WHERE user_id=?').get(req.session.userId).c;
      return res.json({ ok: true, action: 'removed', count });
    } else {
      db.prepare('INSERT OR IGNORE INTO merkliste (user_id, product_id) VALUES (?,?)').run(req.session.userId, productId);
      const count = db.prepare('SELECT COUNT(*) as c FROM merkliste WHERE user_id=?').get(req.session.userId).c;
      return res.json({ ok: true, action: 'added', count });
    }
  } else {
    if (!req.session.merkliste) req.session.merkliste = [];
    const idx = req.session.merkliste.indexOf(productId);
    if (idx >= 0) {
      req.session.merkliste.splice(idx, 1);
      return res.json({ ok: true, action: 'removed', count: req.session.merkliste.length });
    } else {
      req.session.merkliste.push(productId);
      return res.json({ ok: true, action: 'added', count: req.session.merkliste.length });
    }
  }
});

router.post('/loeschen', (req, res) => {
  const productId = parseInt(req.body.product_id);
  if (req.session.userId) {
    db.prepare('DELETE FROM merkliste WHERE user_id=? AND product_id=?').run(req.session.userId, productId);
  } else {
    req.session.merkliste = (req.session.merkliste || []).filter(id => id !== productId);
  }
  res.redirect('/merkliste');
});

module.exports = router;
