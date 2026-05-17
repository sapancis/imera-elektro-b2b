const express = require('express');
const router = express.Router();
const db = require('../database/db');

async function getMerkliste(req) {
  if (req.session.userId) {
    return await db.prepare(`
      SELECT p.*, (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
      FROM merkliste m JOIN products p ON p.id=m.product_id
      WHERE m.user_id=? AND p.active=1 ORDER BY m.created_at DESC
    `).all(req.session.userId);
  }
  const ids = req.session.merkliste || [];
  if (!ids.length) return [];
  return await db.prepare(`
    SELECT *, (SELECT MIN(price) FROM product_tiers WHERE product_id=id) as price_min
    FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND active=1
  `).all(...ids);
}

router.get('/', async (req, res) => {
  try {
    const products = await getMerkliste(req);
    for (const p of products) p.tiers = await db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(p.id);
    res.render('merkliste', { title: 'Merkliste', products });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/toggle', async (req, res) => {
  try {
    const productId = parseInt(req.body.product_id);
    if (!productId) return res.json({ ok: false });

    if (req.session.userId) {
      const exists = await db.prepare('SELECT id FROM merkliste WHERE user_id=? AND product_id=?').get(req.session.userId, productId);
      if (exists) {
        await db.prepare('DELETE FROM merkliste WHERE user_id=? AND product_id=?').run(req.session.userId, productId);
        const countRow = await db.prepare('SELECT COUNT(*) as c FROM merkliste WHERE user_id=?').get(req.session.userId);
        return res.json({ ok: true, action: 'removed', count: countRow.c });
      } else {
        await db.prepare('INSERT OR IGNORE INTO merkliste (user_id, product_id) VALUES (?,?)').run(req.session.userId, productId);
        const countRow = await db.prepare('SELECT COUNT(*) as c FROM merkliste WHERE user_id=?').get(req.session.userId);
        return res.json({ ok: true, action: 'added', count: countRow.c });
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
  } catch { res.status(500).json({ ok: false }); }
});

router.post('/loeschen', async (req, res) => {
  try {
    const productId = parseInt(req.body.product_id);
    if (req.session.userId) {
      await db.prepare('DELETE FROM merkliste WHERE user_id=? AND product_id=?').run(req.session.userId, productId);
    } else {
      req.session.merkliste = (req.session.merkliste || []).filter(id => id !== productId);
    }
    res.redirect('/merkliste');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

module.exports = router;
