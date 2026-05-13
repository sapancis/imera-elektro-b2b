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

// Sitemap.xml – otomatik üretilir
router.get('/sitemap.xml', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const now  = new Date().toISOString().slice(0, 10);

  const staticPages = [
    { url: '/',           priority: '1.0', freq: 'weekly' },
    { url: '/shop',       priority: '0.9', freq: 'daily'  },
    { url: '/ueber-uns',  priority: '0.6', freq: 'monthly'},
    { url: '/kontakt',    priority: '0.6', freq: 'monthly'},
    { url: '/faq',        priority: '0.5', freq: 'monthly'},
  ];

  const products = db.prepare('SELECT slug, updated_at FROM products WHERE active=1').all();
  const cats     = db.prepare('SELECT slug FROM categories WHERE active=1').all();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const p of staticPages) {
    xml += `  <url><loc>${base}${p.url}</loc><lastmod>${now}</lastmod><changefreq>${p.freq}</changefreq><priority>${p.priority}</priority></url>\n`;
  }
  for (const cat of cats) {
    xml += `  <url><loc>${base}/shop?kategorie=${cat.slug}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
  }
  for (const prod of products) {
    const lastmod = prod.updated_at ? prod.updated_at.slice(0, 10) : now;
    xml += `  <url><loc>${base}/shop/produkt/${prod.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
  }
  xml += `</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.send(xml);
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
