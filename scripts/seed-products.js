/**
 * Imera Elektro — Örnek Ürün Tohumlama Scripti
 * Çalıştırmak için: node scripts/seed-products.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db     = require('../database/db');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const UPLOADS = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// ─── Hilfsfunktionen ────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

async function downloadImage(url, filename) {
  const dest = path.join(UPLOADS, filename);
  if (fs.existsSync(dest)) {
    console.log(`  ✓ Bereits vorhanden: ${filename}`);
    return `/uploads/${filename}`;
  }
  return new Promise((resolve) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'ImeraElektroBot/1.0 (product seeder; info@imeragroup.com)',
        'Accept': 'image/*'
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadImage(res.headers.location, filename).then(resolve);
        return;
      }
      if (res.statusCode !== 200) {
        console.log(`  ✗ Download fehlgeschlagen (${res.statusCode}): ${url}`);
        resolve(null);
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        const size = fs.statSync(dest).size;
        if (size < 1000) { // Korrupte Datei
          fs.unlinkSync(dest);
          console.log(`  ✗ Datei zu klein (${size} bytes): ${filename}`);
          resolve(null);
          return;
        }
        console.log(`  ✓ Heruntergeladen: ${filename} (${(size/1024).toFixed(0)} KB)`);
        resolve(`/uploads/${filename}`);
      });
      file.on('error', (e) => {
        fs.existsSync(dest) && fs.unlinkSync(dest);
        console.log(`  ✗ Datei-Fehler: ${e.message}`);
        resolve(null);
      });
    });
    req.on('error', (e) => {
      console.log(`  ✗ Netzwerk-Fehler: ${e.message}`);
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      console.log(`  ✗ Timeout: ${url}`);
      resolve(null);
    });
  });
}

function insertProduct(p, imageUrl) {
  try {
    const existing = db.prepare('SELECT id FROM products WHERE sku=?').get(p.sku);
    if (existing) {
      console.log(`  ⚠ SKU bereits vorhanden: ${p.sku} — übersprungen`);
      return null;
    }

    const result = db.prepare(`
      INSERT INTO products
        (name, slug, sku, category_id, description, specs, applications,
         market_price_min, market_price_max, stock, image, images,
         active, featured, badge)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
    `).run(
      p.name,
      slugify(p.name) + '-' + p.sku.toLowerCase().replace(/[^a-z0-9]/g,'-'),
      p.sku,
      p.category_id,
      p.description,
      JSON.stringify(p.specs || []),
      JSON.stringify(p.applications || []),
      p.market_price_min,
      p.market_price_max,
      p.stock,
      imageUrl,
      JSON.stringify([]),
      p.featured ? 1 : 0,
      p.badge || null
    );

    const productId = result.lastInsertRowid;

    // Staffelpreise
    const tierStmt = db.prepare(
      'INSERT INTO product_tiers (product_id, min_qty, max_qty, price, label) VALUES (?,?,?,?,?)'
    );
    for (const t of p.tiers) {
      tierStmt.run(productId, t.min, t.max ?? null, t.price, t.label ?? null);
    }

    console.log(`  ✓ Produkt erstellt: ${p.name} (ID: ${productId})`);
    return productId;
  } catch (e) {
    console.log(`  ✗ Fehler bei ${p.sku}: ${e.message}`);
    return null;
  }
}

// ─── Kategorien holen ────────────────────────────────────────────────────────

const cats = {};
for (const c of db.prepare('SELECT * FROM categories').all()) {
  cats[c.slug] = c.id;
}
console.log('Kategorien:', Object.keys(cats).join(', '));

// ─── Produkt-Definitionen ────────────────────────────────────────────────────

const products = [

  // ══════════════════════════════════════════════════════════════════
  // KABELBINDER & ZUBEHÖR
  // ══════════════════════════════════════════════════════════════════
  {
    sku: 'KB-100-25N',
    name: 'Kabelbinder 100x2,5mm natur (100er Pack)',
    category_id: cats['kabelbinder'],
    description: 'Standard-Kabelbinder aus hochwertigem Polyamid 6.6, natur (naturfarben/transparent). Ideal für Innenanwendungen im Schaltschrankbau und der Installationstechnik. Hergestellt nach DIN EN 62275.',
    specs: [
      ['Material', 'Polyamid 6.6 (PA66)'],
      ['Länge', '100 mm'],
      ['Breite', '2,5 mm'],
      ['Farbe', 'Natur (transparent)'],
      ['Max. Bündeldurchmesser', '22 mm'],
      ['Max. Zugkraft', '80 N'],
      ['Temperaturbereich', '-40°C bis +85°C'],
      ['Norm', 'DIN EN 62275'],
      ['Verpackungseinheit', '100 Stück'],
      ['Zertifizierung', 'CE, UL, RoHS-konform'],
    ],
    applications: [
      'Schaltschrankbau und Elektroinstallation',
      'Kabelmanagement in EDV und Serverräumen',
      'Befestigung von Kabelbündeln in Fahrzeugen',
      'Allgemeine Industrie- und Handwerksanwendungen',
    ],
    market_price_min: 0.04,
    market_price_max: 0.09,
    stock: 8500,
    featured: 1,
    badge: 'BESTSELLER',
    tiers: [
      { min: 1,    max: 99,   price: 0.042, label: 'Einzelpreis' },
      { min: 100,  max: 499,  price: 0.031, label: 'Kleinkauf' },
      { min: 500,  max: 1999, price: 0.024, label: 'Großkauf' },
      { min: 2000, max: null, price: 0.018, label: 'Industriemenge' },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/0d/Kabelbinder_--_2024_--_6907.jpg',
    imageFile: 'prod-kb-100-25n.jpg',
  },

  {
    sku: 'KB-150-36B',
    name: 'Kabelbinder 150x3,6mm schwarz UV-beständig (100er Pack)',
    category_id: cats['kabelbinder'],
    description: 'UV-beständige Kabelbinder in Schwarz aus Polyamid 6.6 mit UV-Stabilisatoren. Hervorragend geeignet für Außenanwendungen und unter direkter Sonneneinstrahlung. Erhöhte Wetterbeständigkeit dank Carbon-Black-Zusatz.',
    specs: [
      ['Material', 'Polyamid 6.6 UV-stabilisiert (PA66 UV)'],
      ['Länge', '150 mm'],
      ['Breite', '3,6 mm'],
      ['Farbe', 'Schwarz (UV-stabilisiert)'],
      ['Max. Bündeldurchmesser', '35 mm'],
      ['Max. Zugkraft', '180 N'],
      ['Temperaturbereich', '-40°C bis +105°C'],
      ['UV-Beständigkeit', 'gemäß ISO 4892 / UL 508'],
      ['Verpackungseinheit', '100 Stück'],
      ['Zertifizierung', 'CE, UL 94V-2, RoHS'],
    ],
    applications: [
      'Außenanwendungen unter UV-Einstrahlung',
      'Solar- und Photovoltaikanlagen',
      'Kfz-Außenbereich und Landmaschinen',
      'Industrieanlagen im Freien',
    ],
    market_price_min: 0.07,
    market_price_max: 0.15,
    stock: 6200,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,    max: 99,   price: 0.068 },
      { min: 100,  max: 499,  price: 0.052 },
      { min: 500,  max: 1999, price: 0.041 },
      { min: 2000, max: null, price: 0.031 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/Cable_ties.jpg',
    imageFile: 'prod-kb-150-36b.jpg',
  },

  {
    sku: 'KB-370-76B',
    name: 'Kabelbinder 370x7,6mm schwarz Heavy-Duty (50er Pack)',
    category_id: cats['kabelbinder'],
    description: 'Hochbelastbare Heavy-Duty-Kabelbinder für schwere Kabelbündel und industrielle Anwendungen. Breites Profil mit erhöhter Zugkraft bis 540 N. UV-beständig, ideal für den rauen Außeneinsatz.',
    specs: [
      ['Material', 'Polyamid 6.6 UV-stabilisiert'],
      ['Länge', '370 mm'],
      ['Breite', '7,6 mm'],
      ['Farbe', 'Schwarz'],
      ['Max. Bündeldurchmesser', '100 mm'],
      ['Max. Zugkraft', '540 N'],
      ['Temperaturbereich', '-40°C bis +105°C'],
      ['Verpackungseinheit', '50 Stück'],
      ['Zertifizierung', 'CE, UL 94V-2, RoHS'],
    ],
    applications: [
      'Bündelung schwerer Kabelstränge',
      'Maschinenbau und Anlagentechnik',
      'Befestigung in Schaltschränken und Verteilern',
      'Außenanwendungen mit starker Belastung',
    ],
    market_price_min: 0.18,
    market_price_max: 0.38,
    stock: 3200,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,   max: 49,  price: 0.175 },
      { min: 50,  max: 199, price: 0.138 },
      { min: 200, max: 999, price: 0.109 },
      { min: 1000,max: null,price: 0.082 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/Cable_ties.jpg',
    imageFile: 'prod-kb-370-76b.jpg',
  },

  {
    sku: 'KS-25-N',
    name: 'Kabelbinder-Klebesockel 25x25mm natur (100er Pack)',
    category_id: cats['kabelbinder'],
    description: 'Selbstklebende Befestigungssockel für Kabelbinder aus Nylon. Klebefläche mit doppelseitigem Klebeband für schnelle Montage ohne Bohren. Kompatibel mit Kabelbindern bis 4,8mm Breite.',
    specs: [
      ['Material', 'Polyamid 6.6 (Sockel) + Acrylkleber'],
      ['Abmessungen', '25 x 25 mm'],
      ['Farbe', 'Natur (weiß)'],
      ['Max. Kabelbinderbreite', '4,8 mm'],
      ['Haftkraft', '> 35 N (auf glattem Untergrund)'],
      ['Temperaturbereich', '-40°C bis +85°C'],
      ['Klebstoff', 'doppelseitig 3M-Klebeband'],
      ['Verpackungseinheit', '100 Stück'],
    ],
    applications: [
      'Kabelführung in Schaltschränken ohne Bohren',
      'Montage auf glatten Metallflächen',
      'Fahrzeuginnenraum und -karosserie',
      'Kunststoff- und Acrylglasplatten',
    ],
    market_price_min: 0.08,
    market_price_max: 0.18,
    stock: 4800,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,    max: 99,   price: 0.078 },
      { min: 100,  max: 499,  price: 0.059 },
      { min: 500,  max: 1999, price: 0.045 },
      { min: 2000, max: null, price: 0.034 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/0d/Kabelbinder_--_2024_--_6907.jpg',
    imageFile: 'prod-ks-25-n.jpg',
  },

  {
    sku: 'EDL-200-46-W4',
    name: 'Edelstahl-Kabelbinder 200x4,6mm W4 (50er Pack)',
    category_id: cats['kabelbinder'],
    description: 'Hochwertige Kabelbinder aus Edelstahl 316 (W4) für extreme Bedingungen. Ideal für Offshore, Chemie, Lebensmittelindustrie und hoch korrosive Umgebungen. Unlösbar und manipulationssicher.',
    specs: [
      ['Material', 'Edelstahl 316 (1.4401 / W4)'],
      ['Länge', '200 mm'],
      ['Breite', '4,6 mm'],
      ['Oberfläche', 'Blank (unbehandelt)'],
      ['Max. Bündeldurchmesser', '45 mm'],
      ['Max. Zugkraft', '1120 N'],
      ['Temperaturbereich', '-80°C bis +538°C'],
      ['Korrosionsbeständigkeit', 'Sehr hoch (Salzwasser, Säuren)'],
      ['Verpackungseinheit', '50 Stück'],
      ['Zertifizierung', 'CE, ATEX-geeignet'],
    ],
    applications: [
      'Offshore- und Marineanwendungen',
      'Chemische und petrochemische Industrie',
      'Lebensmittel- und Pharmaindustrie',
      'Hochtemperaturanwendungen bis 538°C',
      'ATEX-Bereiche und explosionsgefährdete Zonen',
    ],
    market_price_min: 0.65,
    market_price_max: 1.40,
    stock: 1800,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,   max: 49,  price: 0.620 },
      { min: 50,  max: 199, price: 0.480 },
      { min: 200, max: 499, price: 0.385 },
      { min: 500, max: null,price: 0.295 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/5b/Stailess_steel_cable_tie.png',
    imageFile: 'prod-edl-200-46-w4.png',
  },

  {
    sku: 'KB-SORT-500',
    name: 'Kabelbinder-Sortiment 4 Größen 500-teilig im Koffer',
    category_id: cats['kabelbinder'],
    description: 'Praktisches Sortiment mit 4 gängigen Kabelbindergrößen in einem stabilen Kunststoffkoffer. Ideal für Werkstatt, Service-Techniker und als Erstausstattung. Alle Kabelbinder aus PA66, schwarz UV-beständig.',
    specs: [
      ['Inhalt', '500 Kabelbinder in 4 Größen'],
      ['Größe 1', '100x2,5mm — 200 Stk. (natur)'],
      ['Größe 2', '150x3,6mm — 150 Stk. (schwarz)'],
      ['Größe 3', '200x4,8mm — 100 Stk. (schwarz)'],
      ['Größe 4', '300x4,8mm — 50 Stk. (schwarz)'],
      ['Material', 'Polyamid 6.6 (PA66)'],
      ['Koffer', 'Stabiler Kunststoffkoffer mit Griff'],
      ['Abmessungen Koffer', '30 x 22 x 8 cm'],
    ],
    applications: [
      'Werkstattausstattung und Fahrzeugbau',
      'Service- und Installationstechniker',
      'Elektriker und Schaltschrankbauer',
      'Hausinstallation und Renovierung',
    ],
    market_price_min: 0.06,
    market_price_max: 0.14,
    stock: 420,
    featured: 1,
    badge: 'NEU',
    tiers: [
      { min: 1,  max: 4,  price: 18.90, label: 'pro Koffer' },
      { min: 5,  max: 19, price: 16.50, label: '5–19 Koffer' },
      { min: 20, max: null,price: 13.80,label: 'ab 20 Koffer' },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/Cable_ties.jpg',
    imageFile: 'prod-kb-sort-500.jpg',
  },

  // ══════════════════════════════════════════════════════════════════
  // KABELVERSCHRAUBUNGEN
  // ══════════════════════════════════════════════════════════════════
  {
    sku: 'KV-M12-PG7',
    name: 'Kabelverschraubung M12 PG7 IP68 grau (50er Pack)',
    category_id: cats['kabelverschraubungen'],
    description: 'Metrische Kabelverschraubung M12 aus Polyamid, IP68-zertifiziert für dauerhaften Schutz gegen Staub und Wasser (bis 10m Tiefe). Klemmt Kabel-Ø 3–6,5mm. Flachdichtung und Klemmring inklusive.',
    specs: [
      ['Material', 'Polyamid PA6 (halogenhaltig)'],
      ['Gewindegröße', 'M12 x 1,5 mm'],
      ['Kabeleinführung', 'Ø 3,0 – 6,5 mm'],
      ['Farbe', 'Grau (RAL 7001)'],
      ['Schutzklasse', 'IP68 (10m / 72h nach DIN EN 60529)'],
      ['Anzugsmoment', '3,0 Nm'],
      ['Temperaturbereich', '-20°C bis +100°C'],
      ['Lieferumfang', 'Verschraubung + Gegenmutter + Dichtung'],
      ['Verpackungseinheit', '50 Stück'],
    ],
    applications: [
      'Schaltschränke und Steuerungskästen',
      'Maschinen- und Anlagenbau',
      'Außenkästen und Schutzgehäuse',
      'Mess- und Regelungstechnik',
    ],
    market_price_min: 0.18,
    market_price_max: 0.42,
    stock: 3600,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,   max: 49,  price: 0.175 },
      { min: 50,  max: 199, price: 0.138 },
      { min: 200, max: 999, price: 0.108 },
      { min: 1000,max: null,price: 0.082 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Cabent_01.jpg',
    imageFile: 'prod-kv-m12-pg7.jpg',
  },

  {
    sku: 'KV-M25-IP68',
    name: 'Kabelverschraubung M25 IP68 grau (25er Pack)',
    category_id: cats['kabelverschraubungen'],
    description: 'Robuste Kabelverschraubung M25 aus glasfaserverstärktem Polyamid für mittlere bis schwere Kabel. Zuverlässige Zugentlastung und hermetische Abdichtung. Ideal für raue Industrieumgebungen.',
    specs: [
      ['Material', 'Polyamid PA6-GF (glasfaserverstärkt)'],
      ['Gewindegröße', 'M25 x 1,5 mm'],
      ['Kabeleinführung', 'Ø 13 – 18 mm'],
      ['Farbe', 'Grau (RAL 7001)'],
      ['Schutzklasse', 'IP68 (10m / 72h nach DIN EN 60529)'],
      ['Anzugsmoment', '8,0 Nm'],
      ['Temperaturbereich', '-20°C bis +100°C'],
      ['Zugentlastung', 'Gemäß DIN VDE 0619'],
      ['Verpackungseinheit', '25 Stück'],
    ],
    applications: [
      'Industriemaschinen und Automatisierung',
      'Pumpen und Antriebssysteme',
      'Outdoor-Schaltschränke und Verteiler',
      'Schiffbau und Off-Shore (mit passenden Dichteinsätzen)',
    ],
    market_price_min: 0.45,
    market_price_max: 1.05,
    stock: 2100,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,   max: 24,  price: 0.445 },
      { min: 25,  max: 99,  price: 0.345 },
      { min: 100, max: 499, price: 0.272 },
      { min: 500, max: null,price: 0.208 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/85/Cable_entry01.jpg',
    imageFile: 'prod-kv-m25-ip68.jpg',
  },

  {
    sku: 'KV-SET-36',
    name: 'Kabelverschraubung Sortiment M12–M32 IP68 (36-teilig)',
    category_id: cats['kabelverschraubungen'],
    description: 'Komplettes Sortiment aus 36 Kabelverschraubungen in 6 metrischen Größen (M12 bis M32), je 6 Stück. Alle IP68-zertifiziert aus grauem Polyamid. Im stabilen Sortierbehälter — ideal als Werkzeugkasten-Ergänzung.',
    specs: [
      ['Inhalt', '36 Kabelverschraubungen in 6 Größen'],
      ['Größe M12', '6 Stk. — Kabel Ø 3–6,5 mm'],
      ['Größe M16', '6 Stk. — Kabel Ø 4,5–10 mm'],
      ['Größe M20', '6 Stk. — Kabel Ø 6–12 mm'],
      ['Größe M25', '6 Stk. — Kabel Ø 13–18 mm'],
      ['Größe M32', '6 Stk. — Kabel Ø 18–25 mm'],
      ['Größe M40', '6 Stk. — Kabel Ø 22–32 mm'],
      ['Material', 'Polyamid PA6, grau'],
      ['Schutzklasse', 'IP68'],
      ['Behälter', 'Klappdeckel-Sortierbox'],
    ],
    applications: [
      'Schaltschrankbau und Elektroinstallation',
      'Wartungs- und Servicetechniker',
      'Hausinstallation und Werkstätten',
    ],
    market_price_min: 1.20,
    market_price_max: 2.80,
    stock: 340,
    featured: 1,
    badge: 'NEU',
    tiers: [
      { min: 1,  max: 9,  price: 10.90, label: 'pro Set' },
      { min: 10, max: 49, price: 9.20,  label: '10–49 Sets' },
      { min: 50, max: null,price: 7.80, label: 'ab 50 Sets' },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Cabent_01.jpg',
    imageFile: 'prod-kv-set-36.jpg',
  },

  // ══════════════════════════════════════════════════════════════════
  // REIHENKLEMMEN
  // ══════════════════════════════════════════════════════════════════
  {
    sku: 'RK-60-GR',
    name: 'Reihenklemme 6mm² grau (50er Pack)',
    category_id: cats['reihenklemmen'],
    description: 'Hochwertige Schrauben-Reihenklemme für Leiterquerschnitte bis 6mm². Geeignet für Nennspannungen bis 800V AC. Optimale Kontaktgabe durch versilberte Klemmschrauben. Zur Montage auf 35mm DIN-Schiene (Hutschiene).',
    specs: [
      ['Nennquerschnitt', '6 mm²'],
      ['Leiterquerschnitt', '0,5 – 6 mm²'],
      ['Nennspannung', '800 V AC / 1000 V DC'],
      ['Nennstrom', '41 A'],
      ['Schrauben-Anzugsmoment', '1,2 Nm'],
      ['Farbe', 'Grau'],
      ['Montage', 'DIN-Schiene 35mm (EN 60715)'],
      ['Material Kontakt', 'Versilberter Kupfer-Käfig'],
      ['Temperaturbereich', '-50°C bis +120°C'],
      ['Verpackungseinheit', '50 Stück'],
      ['Norm', 'DIN EN 60947-7-1, VDE 0611-1'],
    ],
    applications: [
      'Schaltschränke und Steuerkästen',
      'Energieverteiler und Sicherungskästen',
      'Industrieautomation und Prozessleittechnik',
      'Gebäudeleittechnik und Smart Building',
    ],
    market_price_min: 0.28,
    market_price_max: 0.68,
    stock: 5200,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,   max: 49,  price: 0.275 },
      { min: 50,  max: 199, price: 0.215 },
      { min: 200, max: 999, price: 0.168 },
      { min: 1000,max: null,price: 0.128 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e3/Klemmen.jpg',
    imageFile: 'prod-rk-60-gr.jpg',
  },

  {
    sku: 'RK-PE-25',
    name: 'Schutzleiter-Klemme PE 2,5mm² grün-gelb (50er Pack)',
    category_id: cats['reihenklemmen'],
    description: 'Spezielle Schutzleiter-Reihenklemme (PE-Klemme) in der genormten grün-gelben Farbe. Ermöglicht die direkte Verbindung zur DIN-Schiene als Schutzleiter. Normkonform nach DIN VDE 0611.',
    specs: [
      ['Nennquerschnitt', '2,5 mm²'],
      ['Leiterquerschnitt', '0,5 – 4 mm²'],
      ['Nennspannung', '800 V AC'],
      ['Nennstrom', '24 A'],
      ['Farbe', 'Grün-Gelb (PE-Kennzeichnung)'],
      ['Montage', 'DIN-Schiene 35mm, direkte Erdung'],
      ['Schutzfunktion', 'Direktkontakt zur Hutschiene'],
      ['Verpackungseinheit', '50 Stück'],
      ['Norm', 'DIN EN 60947-7-1, VDE 0611-1'],
    ],
    applications: [
      'Schutzleiteranschluss in Schaltschränken',
      'Erdungsverbindungen in Verteilern',
      'Maschinen- und Anlagenbau (Sicherheitskreise)',
      'Erneuerbare Energieanlagen',
    ],
    market_price_min: 0.22,
    market_price_max: 0.55,
    stock: 4100,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,   max: 49,  price: 0.218 },
      { min: 50,  max: 199, price: 0.168 },
      { min: 200, max: 999, price: 0.132 },
      { min: 1000,max: null,price: 0.099 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e3/Klemmen.jpg',
    imageFile: 'prod-rk-pe-25.jpg',
  },

  {
    sku: 'QV-10-25',
    name: 'Querverbinder 10-polig für 2,5mm² Reihenklemmen (10er Pack)',
    category_id: cats['reihenklemmen'],
    description: 'Steckbarer Querverbinder (Brücker) für 10 nebeneinanderliegende 2,5mm² Reihenklemmen. Ermöglicht die einfache Potentialbrücke ohne Verdrahtung. Kompatibel mit gängigen 2,5mm² Schienenklemmen.',
    specs: [
      ['Polzahl', '10-polig'],
      ['Geeignet für', 'Reihenklemmen 2,5 mm²'],
      ['Nennspannung', '500 V AC'],
      ['Nennstrom', '16 A'],
      ['Material', 'Polyamid + Kupfer versilbert'],
      ['Farbe', 'Grau'],
      ['Montage', 'Einsteckbar ohne Werkzeug'],
      ['Verpackungseinheit', '10 Stück'],
    ],
    applications: [
      'Potentialbrücken in Schaltschränken',
      'Verknüpfung von Neutralleitern',
      'SPS-Eingangs- und Ausgangsgruppen',
    ],
    market_price_min: 0.55,
    market_price_max: 1.30,
    stock: 2400,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,   max: 9,   price: 0.545 },
      { min: 10,  max: 49,  price: 0.420 },
      { min: 50,  max: 199, price: 0.335 },
      { min: 200, max: null,price: 0.255 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e3/Klemmen.jpg',
    imageFile: 'prod-qv-10-25.jpg',
  },

  // ══════════════════════════════════════════════════════════════════
  // DIN-SCHIENEN & ZUBEHÖR
  // ══════════════════════════════════════════════════════════════════
  {
    sku: 'DIN-35-2M',
    name: 'DIN-Schiene 35x7,5mm galvanisiert 2m',
    category_id: cats['din-schienen'],
    description: 'Hutschiene (DIN-Schiene) 35x7,5mm aus verzinktem Stahlband, 2 Meter Länge. Genormte Befestigungsschiene für Reihenklemmen, Sicherungsautomaten und alle DIN-kompatiblen Komponenten. Werkzeuglos kürzbar.',
    specs: [
      ['Abmessungen', '35 x 7,5 mm'],
      ['Länge', '2000 mm'],
      ['Material', 'Stahlband verzinkt (Fe/Zn)'],
      ['Wandstärke', '1,0 mm'],
      ['Oberfläche', 'Elektrolytisch verzinkt'],
      ['Lochung', 'gelocht'],
      ['Befestigung', 'M5-Schrauben durch Langlöcher'],
      ['Norm', 'DIN EN 60715 (TH 35-7,5)'],
    ],
    applications: [
      'Montage von Reihenklemmen und Sicherungsautomaten',
      'Schaltschrankbau und Verteilerbau',
      'Motorschutzschalter und Schütze',
      'SPS- und Buskomponenten',
    ],
    market_price_min: 3.50,
    market_price_max: 7.80,
    stock: 680,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,  max: 9,  price: 3.45 },
      { min: 10, max: 49, price: 2.85 },
      { min: 50, max: 199,price: 2.28 },
      { min: 200,max: null,price: 1.78 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/0d/DIN_rail.JPG',
    imageFile: 'prod-din-35-2m.jpg',
  },

  {
    sku: 'DIN-EH-10',
    name: 'DIN-Schienen-Endhalter Stahl (10er Pack)',
    category_id: cats['din-schienen'],
    description: 'Endhalter und Endstücke aus verzinktem Stahl für 35mm DIN-Schienen. Verhindert das seitliche Verrutschen von Reihenklemmen und Geräten. Einfache Befestigung durch Umklappen und Einschnappen.',
    specs: [
      ['Material', 'Stahl verzinkt'],
      ['Kompatibilität', 'DIN-Schiene 35x7,5mm und 35x15mm'],
      ['Befestigung', 'Schnappbefestigung ohne Werkzeug'],
      ['Maße (BxH)', '8 x 37 mm'],
      ['Verpackungseinheit', '10 Stück (5 Paare)'],
    ],
    applications: [
      'Abschluss von Klemmblöcken auf DIN-Schienen',
      'Verhinderung von Verlagerung bei Vibration',
      'Schaltschrankbau und Steuerkästen',
    ],
    market_price_min: 0.15,
    market_price_max: 0.45,
    stock: 3800,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,   max: 9,   price: 0.148 },
      { min: 10,  max: 49,  price: 0.115 },
      { min: 50,  max: 199, price: 0.088 },
      { min: 200, max: null,price: 0.068 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/0d/DIN_rail.JPG',
    imageFile: 'prod-din-eh-10.jpg',
  },

  {
    sku: 'KK-60-40-2M',
    name: 'Kabelkanal 60x40mm grau 2m mit Deckel',
    category_id: cats['din-schienen'],
    description: 'Selbstverlöschender Kabelkanal aus PVC mit aufrastbarem Deckel. Für geordnete Kabelführung im Schaltschrank. Perforierter Boden erleichtert das Einführen und Herausführen von Kabeln an beliebiger Stelle.',
    specs: [
      ['Abmessungen', '60 x 40 mm (B x H)'],
      ['Länge', '2000 mm'],
      ['Material', 'PVC hart, selbstverlöschend V0'],
      ['Farbe', 'Grau (RAL 7030)'],
      ['Wandstärke', '1,5 mm'],
      ['Perforation', 'Schlitzraster 5 mm'],
      ['Temperaturbereich', '-5°C bis +60°C'],
      ['Norm', 'DIN EN 50085'],
    ],
    applications: [
      'Kabelführung in Schaltschränken',
      'Geordnete Verdrahtung im Anlagenbau',
      'Übersichtliche Leitungsführung in Verteilern',
    ],
    market_price_min: 2.80,
    market_price_max: 6.50,
    stock: 520,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,  max: 9,  price: 2.75 },
      { min: 10, max: 49, price: 2.20 },
      { min: 50, max: null,price: 1.75 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/91/Angular_trunking_accessories.JPG',
    imageFile: 'prod-kk-60-40-2m.jpg',
  },

  // ══════════════════════════════════════════════════════════════════
  // BESCHRIFTUNG & MARKIERUNG
  // ══════════════════════════════════════════════════════════════════
  {
    sku: 'AEH-SORT-1000',
    name: 'Aderendhülsen-Sortiment isoliert 1000-teilig (0,5–6mm²)',
    category_id: cats['beschriftung'],
    description: 'Hochwertiges Aderendhülsen-Sortiment in 6 Querschnitten und 6 Farben in praktischer Sortierbox. Isolierte Aderendhülsen (Isolierhülse aus PP) nach DIN 46228 T4 für professionelle Leitungsendbehandlung.',
    specs: [
      ['Inhalt', '1000 Aderendhülsen in 6 Größen'],
      ['Größe 1', '0,5 mm² weiß — 200 Stk.'],
      ['Größe 2', '0,75 mm² grau — 150 Stk.'],
      ['Größe 3', '1,0 mm² rot — 200 Stk.'],
      ['Größe 4', '1,5 mm² schwarz — 200 Stk.'],
      ['Größe 5', '2,5 mm² blau — 150 Stk.'],
      ['Größe 6', '4,0–6,0 mm² gelb/grün — 100 Stk.'],
      ['Material Kontakt', 'Elektrolytisches Kupfer'],
      ['Isolierung', 'Polypropylen (PP)'],
      ['Norm', 'DIN 46228 Teil 4'],
      ['Behälter', 'Klapp-Sortierbox'],
    ],
    applications: [
      'Professionelle Leitungsendbehandlung',
      'Schaltschrankbau und Verdrahtung',
      'Klemmanschlüsse an Schaltgeräten',
      'Elektrische Installationen aller Art',
    ],
    market_price_min: 0.012,
    market_price_max: 0.035,
    stock: 1200,
    featured: 0,
    badge: 'NEU',
    tiers: [
      { min: 1,  max: 4,  price: 8.90,  label: 'pro Box' },
      { min: 5,  max: 19, price: 7.50,  label: '5–19 Boxen' },
      { min: 20, max: null,price: 6.20, label: 'ab 20 Boxen' },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Wire_ferrules_with_and_without_insulation.jpg',
    imageFile: 'prod-aeh-sort-1000.jpg',
  },

  {
    sku: 'KM-PVC-W',
    name: 'Kabelmarkierungsclip PVC weiß beschriftbar (200er Pack)',
    category_id: cats['beschriftung'],
    description: 'Selbstlaminierende Kabelmarkierungsclips aus PVC für Kabel-Ø 2–8mm. Aufsteckbar, mit Beschriftungsfeld (20x8mm) — ideal für Tuschestift, Laserdrucker oder Kugelschreiber. Temperaturbeständig bis 80°C.',
    specs: [
      ['Material', 'PVC weich (beschriftbar)'],
      ['Farbe', 'Weiß (beschriftbar)'],
      ['Kabel-Ø', '2 – 8 mm'],
      ['Beschriftungsfeld', '20 x 8 mm'],
      ['Befestigung', 'Aufsteckbar (kein Kleber)'],
      ['Temperaturbereich', '-20°C bis +80°C'],
      ['Verpackungseinheit', '200 Stück'],
      ['Beschriftung', 'Stift, Drucker oder Lasergravur'],
    ],
    applications: [
      'Kabelidentifikation in Schaltschränken',
      'Leitungsmarkierung in Verteilern',
      'Anlagendokumentation nach DIN EN 81346',
      'Netzwerk- und IT-Infrastruktur',
    ],
    market_price_min: 0.08,
    market_price_max: 0.22,
    stock: 2600,
    featured: 0,
    badge: null,
    tiers: [
      { min: 1,    max: 99,   price: 0.078 },
      { min: 100,  max: 499,  price: 0.058 },
      { min: 500,  max: 1999, price: 0.045 },
      { min: 2000, max: null, price: 0.034 },
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Wire_ferrules_with_and_without_insulation.jpg',
    imageFile: 'prod-km-pvc-w.jpg',
  },
];

// ─── Hauptprogramm ───────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Imera Elektro — Produkt-Seeder');
  console.log('═══════════════════════════════════════════════\n');

  let success = 0, skipped = 0, failed = 0;

  for (const p of products) {
    console.log(`\n→ ${p.name} [${p.sku}]`);

    // Bild herunterladen
    let imageUrl = null;
    if (p.imageUrl) {
      imageUrl = await downloadImage(p.imageUrl, p.imageFile);
    }

    // Produkt in DB einfügen
    const id = insertProduct(p, imageUrl);
    if (id) success++;
    else if (id === null && db.prepare('SELECT id FROM products WHERE sku=?').get(p.sku)) skipped++;
    else failed++;
  }

  // Vorhandene Produkte ohne Bild aktualisieren (optionale Verbesserungen)
  console.log('\n\n─── Vorhandene Produkte aktualisieren ──────────────\n');
  const imgKB200B = await downloadImage(
    'https://upload.wikimedia.org/wikipedia/commons/2/2f/Cable_ties.jpg',
    'prod-kb-200-45b-upd.jpg'
  );
  const imgEDL = await downloadImage(
    'https://upload.wikimedia.org/wikipedia/commons/5/5b/Stailess_steel_cable_tie.png',
    'prod-edl-300-46-upd.png'
  );
  const imgKV = await downloadImage(
    'https://upload.wikimedia.org/wikipedia/commons/8/85/Cable_entry01.jpg',
    'prod-kv-upd.jpg'
  );
  const imgRK = await downloadImage(
    'https://upload.wikimedia.org/wikipedia/commons/e/e3/Klemmen.jpg',
    'prod-rk-upd.jpg'
  );
  const imgDIN = await downloadImage(
    'https://upload.wikimedia.org/wikipedia/commons/0/0d/DIN_rail.JPG',
    'prod-din-upd.jpg'
  );

  // Bilder und Beschreibungen für vorhandene Produkte ergänzen
  const updates = [
    {
      sku: 'TRK-200-45B',
      image: imgKB200B,
      description: 'UV-beständige Kabelbinder aus Polyamid 6.6 in Schwarz, Maße 200x4,5mm. Ideal für Bündelung mittlerer Kabeldurchmesser in Innen- und Außenbereichen. Hohe Zugfestigkeit und Temperaturbeständigkeit.',
      market_price_min: 0.09, market_price_max: 0.20
    },
    {
      sku: 'TRK-300-48W',
      image: imgKB200B,
      description: 'Lange Kabelbinder 300x4,8mm in Weiß aus Polyamid 6.6. Naturfarbene Ausführung für Innenanwendungen wo Ästhetik wichtig ist — z.B. Innenausbau, Haustechnik und IT-Installationen.',
      market_price_min: 0.11, market_price_max: 0.25
    },
    {
      sku: 'EDL-300-46',
      image: imgEDL,
      description: 'Edelstahl-Kabelbinder 300x4,6mm aus Edelstahl 304 (W2) für anspruchsvolle Umgebungen. Erhöhte Zugfestigkeit und Korrosionsbeständigkeit. Geeignet für Außenanlagen, Industrie und den maritimen Bereich.',
      market_price_min: 0.95, market_price_max: 2.10
    },
    {
      sku: 'KV-M20-IP68',
      image: imgKV,
      description: 'Metrische Kabelverschraubung M20 aus Polyamid, IP68-zertifiziert. Klemmt Kabel-Ø 6–12mm. Hermetische Abdichtung und zuverlässige Zugentlastung gemäß DIN VDE 0619. Flachdichtung und Gegenmutter inklusive.',
      market_price_min: 0.32, market_price_max: 0.75
    },
    {
      sku: 'KV-M16-IP68',
      image: imgKV,
      description: 'Kabelverschraubung M16 aus hochwertigem Polyamid, IP68-zertifiziert. Für Kabeldurchmesser Ø 4,5–10mm. Kompakte Bauform für enge Einbausituationen. Mit Gegenmutter und Dichtring.',
      market_price_min: 0.25, market_price_max: 0.58
    },
    {
      sku: 'RK-25-GR',
      image: imgRK,
      description: 'Standard-Schrauben-Reihenklemme 2,5mm² in Grau. Nennspannung 800V AC, Nennstrom 24A. Zur Montage auf 35mm DIN-Schiene (Hutschiene). Versilberte Klemmschrauben für optimale Kontaktgabe.',
      market_price_min: 0.18, market_price_max: 0.45
    },
    {
      sku: 'RK-40-GR',
      image: imgRK,
      description: 'Reihenklemme 4mm² in Grau für höhere Leiterquerschnitte. Nennspannung 800V, Nennstrom 32A. Kompakte Bauform für dichte Klemmblöcke. Kompatibel mit Querverbindern und Standard-Beschriftungszubehör.',
      market_price_min: 0.22, market_price_max: 0.52
    },
    {
      sku: 'RK-25-BL',
      image: imgRK,
      description: 'Reihenklemme 2,5mm² in Blau — normkonforme Kennfarbe für Neutralleiter (N). Nennspannung 800V AC, Nennstrom 24A. Identisch aufgebaut wie graue Standardklemmen — einfacher Systemwechsel.',
      market_price_min: 0.19, market_price_max: 0.46
    },
    {
      sku: 'DIN-35-1M',
      image: imgDIN,
      description: 'Hutschiene 35x7,5mm galvanisiert, 1 Meter Länge. Normierte Montageschiene nach DIN EN 60715 (TH 35-7,5) für alle DIN-kompatiblen Komponenten. Gelocht für einfache Schraubbefestigung.',
      market_price_min: 1.80, market_price_max: 4.20
    },
  ];

  for (const u of updates) {
    try {
      const set = ['description=?', 'market_price_min=?', 'market_price_max=?'];
      const vals = [u.description, u.market_price_min, u.market_price_max];
      if (u.image) { set.push('image=?'); vals.push(u.image); }
      vals.push(u.sku);
      db.prepare(`UPDATE products SET ${set.join(',')} WHERE sku=?`).run(...vals);
      console.log(`  ✓ Aktualisiert: ${u.sku}${u.image ? ' (mit Bild)' : ''}`);
    } catch(e) {
      console.log(`  ✗ Fehler bei ${u.sku}: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Fertig! ${success} neu erstellt, ${skipped} übersprungen, ${failed} Fehler`);
  const total = db.prepare('SELECT COUNT(*) as n FROM products WHERE active=1').get().n;
  console.log(`  Gesamt aktive Produkte: ${total}`);
  console.log('═══════════════════════════════════════════════\n');
}

// Doğrudan çalıştırılınca main() çağrılır; require ile import edilince sadece export edilir
if (require.main === module) {
  main().catch(console.error);
} else {
  module.exports = main;
}
