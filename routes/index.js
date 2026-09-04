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
      // Startseite: kuratierte Kategorien zuerst (mit Icon+Beschreibung), max. 12 Kacheln.
      // Alle übrigen sind weiter über den Shop erreichbar.
      categories = await db.prepare(`SELECT c.*,
          (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) as pcount
        FROM categories c
        WHERE c.active=1 AND EXISTS (SELECT 1 FROM products p WHERE p.category_id=c.id AND p.active=1)
        ORDER BY (c.description IS NOT NULL AND c.description != '') DESC, c.sort_order, pcount DESC
        LIMIT 12`).all();
      cache.set('categories', categories, 120_000);
    }

    let homeData = cache.get('home_data');
    if (!homeData) {
      // "Ausgewählte Produkte": 1 repräsentatives Produkt pro Marke (mit Bild bevorzugt)
      const featured = await db.prepare(`
        SELECT * FROM (
          SELECT p.*, c.name as cat_name, b.name as brand_name, b.slug as brand_slug,
            (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min,
            ROW_NUMBER() OVER (PARTITION BY p.brand_id ORDER BY p.featured DESC, (p.image IS NULL OR p.image=''), p.id) as rn
          FROM products p
          LEFT JOIN categories c ON p.category_id=c.id
          JOIN brands b ON p.brand_id=b.id
          WHERE p.active=1
        ) WHERE rn=1
        ORDER BY (image IS NULL OR image=''), brand_id LIMIT 6
      `).all();
      await attachTiers(db, featured);
      const [statsRow, newProducts] = await Promise.all([
        db.prepare('SELECT COUNT(*) as n FROM products WHERE active=1').get(),
        // "Aktuelle Produkte": pro Kategorie nur 1 Artikel → abwechslungsreiche Auswahl
        db.prepare(`
          SELECT * FROM (
            SELECT p.*, c.name as cat_name,
              (SELECT MIN(price) FROM product_tiers WHERE product_id=p.id) as price_min,
              ROW_NUMBER() OVER (PARTITION BY p.category_id ORDER BY (p.image IS NULL), p.id DESC) as rn
            FROM products p
            LEFT JOIN categories c ON p.category_id=c.id
            WHERE p.active=1
          ) WHERE rn=1
          ORDER BY (image IS NULL), id DESC LIMIT 8
        `).all(),
      ]);
      // Marken-Übersicht: nur Marken mit Logo, für die Logo-Leiste auf der Startseite
      const brands = await db.prepare(`
        SELECT b.id, b.name, b.slug, b.logo
        FROM brands b
        WHERE b.active=1 AND b.logo IS NOT NULL AND b.logo != ''
          AND EXISTS (SELECT 1 FROM products p WHERE p.brand_id=b.id AND p.active=1)
        ORDER BY b.sort_order, b.name
      `).all();
      homeData = { featured, newProducts, stats: { products: statsRow.n }, brands };
      cache.set('home_data', homeData, 120_000);
    }

    const settings = await getSettings();
    res.render('index', {
      title: 'Installationsmaterial & Schaltschrankbau – Direktimport vom Hersteller',
      metaDesc: 'Installationsmaterial, Schaltschrankbau & mehr direkt vom Hersteller. CE-konforme Markenprodukte (Onka, Tork, Tracon, Karlik, Pawbol), attraktive Preise für Geschäftskunden in Österreich.',
      ogTitle: 'Imera Elektro – Direktimport vom Hersteller',
      categories, featured: homeData.featured, newProducts: homeData.newProducts, stats: homeData.stats, brands: homeData.brands, settings,
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
    const cats     = await db.prepare('SELECT DISTINCT c.slug FROM categories c JOIN products p ON p.category_id=c.id AND p.active=1 WHERE c.active=1').all();
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
