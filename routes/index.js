const express = require('express');
const router = express.Router();
const db = require('../database/db');
const cache = require('../utils/cache');
const { attachTiers, settingsMap } = require('../utils/perf');
const { sendPriceListReply } = require('../utils/mailer');

router.get('/', async (req, res) => {
  try {
    // Cache'den al, yoksa DB'den çek (2 dk TTL)
    let categories = cache.get('categories');
    if (!categories) {
      categories = await db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY sort_order').all();
      cache.set('categories', categories, 120_000);
    }

    let homeData = cache.get('home_data');
    if (!homeData) {
      const featured = await db.prepare(`
        SELECT p.*, c.name as cat_name,
          (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
        FROM products p
        LEFT JOIN categories c ON p.category_id=c.id
        WHERE p.active=1 AND p.featured=1
        ORDER BY p.id LIMIT 3
      `).all();
      await attachTiers(db, featured);
      const [statsRow, newProducts] = await Promise.all([
        db.prepare('SELECT COUNT(*) as n FROM products WHERE active=1').get(),
        db.prepare(`
          SELECT p.*, c.name as cat_name,
            (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min
          FROM products p
          LEFT JOIN categories c ON p.category_id=c.id
          WHERE p.active=1
          ORDER BY p.id DESC LIMIT 8
        `).all(),
      ]);
      homeData = { featured, newProducts, stats: { products: statsRow.n } };
      cache.set('home_data', homeData, 120_000);
    }

    const settings = await getSettings();
    res.render('index', {
      title: 'CE-zertifizierte Elektrokomponenten – 40-60% günstiger',
      metaDesc: 'Kabelbinder, Kabelverschraubungen & Reihenklemmen direkt vom Hersteller. CE-zertifiziert, Direktimport. 40-60% günstiger als der österreichische Markt.',
      ogTitle: 'Imera Elektro – Elektrokomponenten 40-60% unter Marktpreis',
      categories, featured: homeData.featured, newProducts: homeData.newProducts, stats: homeData.stats, settings,
    });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// Sitemap.xml – otomatik üretilir
router.get('/sitemap.xml', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const now  = new Date().toISOString().slice(0, 10);

    const staticPages = [
      { url: '/',           priority: '1.0', freq: 'weekly' },
      { url: '/shop',       priority: '0.9', freq: 'daily'  },
      { url: '/marken',     priority: '0.8', freq: 'weekly' },
      { url: '/kataloge',   priority: '0.6', freq: 'weekly' },
      { url: '/ueber-uns',  priority: '0.6', freq: 'monthly'},
      { url: '/kontakt',    priority: '0.6', freq: 'monthly'},
      { url: '/faq',        priority: '0.5', freq: 'monthly'},
    ];

    const products = await db.prepare('SELECT slug, updated_at FROM products WHERE active=1').all();
    const cats     = await db.prepare('SELECT slug FROM categories WHERE active=1').all();
    const brands   = await db.prepare('SELECT slug FROM brands WHERE active=1').all();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const p of staticPages) {
      xml += `  <url><loc>${base}${p.url}</loc><lastmod>${now}</lastmod><changefreq>${p.freq}</changefreq><priority>${p.priority}</priority></url>\n`;
    }
    for (const cat of cats) {
      xml += `  <url><loc>${base}/shop?kategorie=${cat.slug}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    }
    for (const b of brands) {
      xml += `  <url><loc>${base}/marken/${b.slug}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    }
    for (const prod of products) {
      const lastmod = prod.updated_at ? prod.updated_at.slice(0, 10) : now;
      xml += `  <url><loc>${base}/shop/produkt/${prod.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
    }
    xml += `</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch { res.status(500).send(''); }
});

router.post('/preisliste', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ ok: false, message: 'Ungültige E-Mail-Adresse.' });
    }
    await db.prepare('INSERT OR IGNORE INTO price_list_requests (email) VALUES (?)').run(email.trim().toLowerCase());
    // Antwort-/Bestätigungsmail an Interessent + Admin-Hinweis (async)
    sendPriceListReply({ email: email.trim().toLowerCase() })
      .catch(e => console.error('Preisliste-Mail Fehler:', e.message));
    res.json({ ok: true, message: 'Danke! Sie erhalten unsere Preisliste in Kürze.' });
  } catch {
    res.json({ ok: false, message: 'Ein Fehler ist aufgetreten.' });
  }
});

async function getSettings() {
  return settingsMap(db);
}

module.exports = router;
