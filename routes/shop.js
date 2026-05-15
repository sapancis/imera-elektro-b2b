const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/', (req, res) => {
  const { kategorie, preis, sort = 'popular', page = 1, verfuegbar } = req.query;
  const perPage = 12;
  const offset = (parseInt(page) - 1) * perPage;

  let where = ['p.active=1'];
  let params = [];

  if (kategorie) {
    where.push('c.slug=?');
    params.push(kategorie);
  }

  if (verfuegbar === '1') {
    where.push('p.stock > 0');
  }

  if (preis) {
    const ranges = Array.isArray(preis) ? preis : [preis];
    const priceConds = [];
    for (const r of ranges) {
      if (r === 'under010') priceConds.push('(SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) < 0.10');
      if (r === '010to050') priceConds.push('((SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) BETWEEN 0.10 AND 0.50)');
      if (r === '050to100') priceConds.push('((SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) BETWEEN 0.50 AND 1.00)');
      if (r === 'over100') priceConds.push('(SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) > 1.00');
    }
    if (priceConds.length) where.push('(' + priceConds.join(' OR ') + ')');
  }

  const orderMap = {
    popular: 'p.featured DESC, p.id ASC',
    price_asc: '(SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) ASC',
    price_desc: '(SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) DESC',
    name_az: 'p.name ASC',
  };
  const orderBy = orderMap[sort] || orderMap.popular;
  const whereStr = where.join(' AND ');

  const total = db.prepare(`
    SELECT COUNT(*) as cnt FROM products p
    LEFT JOIN categories c ON p.category_id=c.id
    WHERE ${whereStr}
  `).get(...params).cnt;

  const products = db.prepare(`
    SELECT p.*, c.name as cat_name, c.slug as cat_slug,
      (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
    FROM products p
    LEFT JOIN categories c ON p.category_id=c.id
    WHERE ${whereStr}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  for (const p of products) {
    p.tiers = db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(p.id);
  }

  const categories = db.prepare('SELECT c.*, COUNT(p.id) as cnt FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.active=1 WHERE c.active=1 GROUP BY c.id ORDER BY c.sort_order').all();
  const totalPages = Math.ceil(total / perPage);

  res.render('shop', {
    title: 'Shop',
    products,
    categories,
    filters: { kategorie, preis, sort, verfuegbar },
    pagination: { page: parseInt(page), totalPages, total },
  });
});

router.get('/produkt/:slug', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, c.name as cat_name, c.slug as cat_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id=c.id
    WHERE p.slug=? AND p.active=1
  `).get(req.params.slug);

  if (!product) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Produkt nicht gefunden.', code: 404 });

  product.tiers = db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(product.id);
  product.specsArr = product.specs ? JSON.parse(product.specs) : [];
  product.appsArr = product.applications ? JSON.parse(product.applications) : [];
  product.imagesArr = product.images ? JSON.parse(product.images) : [];

  const related = db.prepare(`
    SELECT p.*, (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
    FROM products p WHERE p.category_id=? AND p.id!=? AND p.active=1 LIMIT 4
  `).all(product.category_id, product.id);
  for (const rp of related) {
    rp.tiers = db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(rp.id);
  }

  const reviews = db.prepare(`
    SELECT r.*, u.name as user_display_name
    FROM reviews r LEFT JOIN users u ON u.id=r.user_id
    WHERE r.product_id=? AND r.approved=1
    ORDER BY r.created_at DESC
  `).all(product.id);
  const reviewStats = {
    count: reviews.length,
    avg: reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : 0,
  };

  // Giriş yapmış kullanıcı bu ürünü daha önce sipariş etmiş mi?
  let hasOrdered = false;
  let alreadyReviewed = false;
  if (req.session.userId) {
    const ordered = db.prepare(`
      SELECT 1 FROM order_items oi
      JOIN orders o ON o.id=oi.order_id
      WHERE o.user_id=? AND oi.product_id=? LIMIT 1
    `).get(req.session.userId, product.id);
    hasOrdered = !!ordered;
    const existing = db.prepare('SELECT 1 FROM reviews WHERE product_id=? AND user_id=?').get(product.id, req.session.userId);
    alreadyReviewed = !!existing;
  }

  const metaDesc = product.meta_description ||
    `${product.short_description || ''}${product.short_description ? ' ' : ''}${product.name} – ${product.sku ? 'Art.-Nr. ' + product.sku + '. ' : ''}${(product.description || '').slice(0, 120)} | Imera Elektro`;
  const title = product.meta_title || product.name;
  res.render('product', { title, product, related, metaDesc, reviews, reviewStats, hasOrdered, alreadyReviewed });
});

router.post('/produkt/:slug/bewertung', (req, res) => {
  if (!req.session.userId) {
    return res.json({ ok: false, message: 'Bitte melden Sie sich an, um eine Bewertung zu hinterlassen.' });
  }
  const product = db.prepare('SELECT id FROM products WHERE slug=? AND active=1').get(req.params.slug);
  if (!product) return res.json({ ok: false, message: 'Produkt nicht gefunden.' });

  const existing = db.prepare('SELECT 1 FROM reviews WHERE product_id=? AND user_id=?').get(product.id, req.session.userId);
  if (existing) return res.json({ ok: false, message: 'Sie haben dieses Produkt bereits bewertet.' });

  const { rating, text } = req.body;
  const ratingNum = parseInt(rating);
  if (!ratingNum || ratingNum < 1 || ratingNum > 5) return res.json({ ok: false, message: 'Ungültige Bewertung.' });
  if (!text || text.trim().length < 10) return res.json({ ok: false, message: 'Bitte schreiben Sie mindestens 10 Zeichen.' });

  const user = db.prepare('SELECT name, company FROM users WHERE id=?').get(req.session.userId);
  const hasOrdered = db.prepare(`
    SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.user_id=? AND oi.product_id=? LIMIT 1
  `).get(req.session.userId, product.id);

  db.prepare(`
    INSERT INTO reviews (product_id, user_id, author_name, company, rating, text, approved, verified_purchase)
    VALUES (?,?,?,?,?,?,0,?)
  `).run(product.id, req.session.userId, user.name || 'Kunde', user.company || null, ratingNum, text.trim(), hasOrdered ? 1 : 0);

  res.json({ ok: true, message: 'Ihre Bewertung wurde eingereicht und wird nach Prüfung veröffentlicht.' });
});

router.get('/api/schnellansicht/:slug', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, c.name as cat_name
    FROM products p LEFT JOIN categories c ON p.category_id=c.id
    WHERE p.slug=? AND p.active=1
  `).get(req.params.slug);
  if (!product) return res.json({ ok: false });
  product.tiers = db.prepare('SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty').all(product.id);
  product.imagesArr = product.images ? JSON.parse(product.images) : [];
  const mktMax = product.market_price_max || 0;
  const priceMin = product.tiers[0]?.price || 0;
  const savingsPct = mktMax > priceMin ? Math.round((1 - priceMin / mktMax) * 100) : 0;
  res.json({ ok: true, product, savingsPct });
});

router.get('/api/preis/:id', (req, res) => {
  const qty = parseInt(req.query.qty) || 1;
  const tier = db.prepare(`
    SELECT price FROM product_tiers
    WHERE product_id=? AND min_qty<=?
    AND (max_qty IS NULL OR max_qty>=?)
    ORDER BY min_qty DESC LIMIT 1
  `).get(req.params.id, qty, qty);

  if (!tier) return res.json({ ok: false });
  const total = (tier.price * qty).toFixed(2);
  const nextTier = db.prepare(`
    SELECT * FROM product_tiers WHERE product_id=? AND min_qty>? ORDER BY min_qty ASC LIMIT 1
  `).get(req.params.id, qty);

  res.json({ ok: true, unitPrice: tier.price, total, nextTier });
});

module.exports = router;
