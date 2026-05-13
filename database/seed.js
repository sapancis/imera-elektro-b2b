require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('./db');
const bcrypt = require('bcryptjs');

console.log('Seeding database...');

db.exec(`
  DELETE FROM product_tiers;
  DELETE FROM products;
  DELETE FROM categories;
`);

const insertCategory = db.prepare(`
  INSERT INTO categories (name, slug, icon, description, sort_order) VALUES (?, ?, ?, ?, ?)
`);

const categories = [
  ['Kabelbinder & Zubehör', 'kabelbinder', '🔗', 'UV-beständig, Edelstahl, Klebesockel', 1],
  ['Kabelverschraubungen', 'kabelverschraubungen', '🔧', 'IP68, M16-M32, Polyamid grau', 2],
  ['Reihenklemmen', 'reihenklemmen', '⚡', '2,5-6mm², grau/blau/PE', 3],
  ['DIN-Schienen & Zubehör', 'din-schienen', '📐', '35x7,5mm galvanisiert, Endhalter', 4],
  ['Beschriftung & Markierung', 'beschriftung', '🏷️', 'Markierungsträger, Kabeletiketten', 5],
];

const catIds = {};
for (const [name, slug, icon, desc, order] of categories) {
  const r = insertCategory.run(name, slug, icon, desc, order);
  catIds[slug] = r.lastInsertRowid;
}

const insertProduct = db.prepare(`
  INSERT INTO products (name, slug, sku, category_id, description, specs, applications, market_price_min, market_price_max, stock, active, featured, badge)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);

const insertTier = db.prepare(`
  INSERT INTO product_tiers (product_id, min_qty, max_qty, price, label) VALUES (?, ?, ?, ?, ?)
`);

const products = [
  {
    name: 'Kabelbinder 200x4.5 schwarz UV-beständig',
    slug: 'kabelbinder-200x45-schwarz-uv',
    sku: 'TRK-200-45B',
    cat: 'kabelbinder',
    desc: 'Hochwertige UV-beständige Kabelbinder aus schwarzem Polyamid 6.6. Mit einer Länge von 200mm und einer Breite von 4,5mm eignen sie sich perfekt für den Einsatz im Innen- und Außenbereich.',
    specs: JSON.stringify([['Material','Polyamid 6.6 (PA66)'],['Länge','200mm'],['Breite','4,5mm'],['Farbe','Schwarz (UV-beständig)'],['Zugfestigkeit','22 kg (220N)'],['Temperaturbereich','-40°C bis +85°C'],['Zertifizierung','CE, RoHS konform']]),
    apps: JSON.stringify(['Elektroinstallationen im Innen- und Außenbereich','Kabelbündelung in Schaltschränken','Befestigung von Leitungen an Kabeltrassen','Automotive und Maschinenbau']),
    mpMin: 0.05, mpMax: 0.08, stock: 2450, featured: 1, badge: 'BESTSELLER',
    tiers: [[1,99,0.025,'1–99 Stück'],[100,999,0.022,'100–999 Stück'],[1000,null,0.019,'Ab 1.000 Stück']],
  },
  {
    name: 'Kabelbinder 300x4.8 weiß',
    slug: 'kabelbinder-300x48-weiss',
    sku: 'TRK-300-48W',
    cat: 'kabelbinder',
    desc: 'Kabelbinder aus weißem Polyamid 6.6, 300mm x 4,8mm. Ideal für sichtbare Installationen.',
    specs: JSON.stringify([['Material','Polyamid 6.6'],['Länge','300mm'],['Breite','4,8mm'],['Farbe','Weiß'],['Zugfestigkeit','22 kg']]),
    apps: JSON.stringify(['Innenbereich','Bürotechnik','Sichtbare Kabelführungen']),
    mpMin: 0.06, mpMax: 0.10, stock: 1800, featured: 0, badge: null,
    tiers: [[1,99,0.028,'1–99 Stück'],[100,999,0.024,'100–999 Stück'],[1000,null,0.020,'Ab 1.000 Stück']],
  },
  {
    name: 'Edelstahl Kabelbinder 300x4.6 W4',
    slug: 'edelstahl-kabelbinder-300x46-w4',
    sku: 'EDL-300-46',
    cat: 'kabelbinder',
    desc: 'Edelstahl Kabelbinder W4 (316L), 300mm x 4,6mm. Hochkorrosionsbeständig.',
    specs: JSON.stringify([['Material','Edelstahl 316L (W4)'],['Länge','300mm'],['Breite','4,6mm'],['Zugfestigkeit','50 kg']]),
    apps: JSON.stringify(['Offshore und Marine','Lebensmittelindustrie','Außenbereich']),
    mpMin: 0.80, mpMax: 1.20, stock: 0, featured: 0, badge: null,
    tiers: [[1,49,0.45,'1–49 Stück'],[50,199,0.39,'50–199 Stück'],[200,null,0.34,'Ab 200 Stück']],
  },
  {
    name: 'Kabelverschraubung M20 IP68',
    slug: 'kabelverschraubung-m20-ip68',
    sku: 'KV-M20-IP68',
    cat: 'kabelverschraubungen',
    desc: 'Kabelverschraubung M20, Polyamid grau, IP68 zertifiziert. Kabeleinführbereich 6-12mm.',
    specs: JSON.stringify([['Material','Polyamid PA66'],['Gewinde','M20'],['Schutzklasse','IP68'],['Kabeleinführbereich','6–12mm'],['Farbe','Grau RAL 7035']]),
    apps: JSON.stringify(['Schaltschränke','Maschinen und Anlagen','Industriesteuerungen']),
    mpMin: 0.95, mpMax: 1.20, stock: 1840, featured: 1, badge: '-42%',
    tiers: [[1,99,0.79,'1–99 Stück'],[100,499,0.69,'100–499 Stück'],[500,null,0.59,'Ab 500 Stück']],
  },
  {
    name: 'Kabelverschraubung M16 IP68',
    slug: 'kabelverschraubung-m16-ip68',
    sku: 'KV-M16-IP68',
    cat: 'kabelverschraubungen',
    desc: 'Kabelverschraubung M16, Polyamid grau, IP68. Kabeleinführbereich 4-8mm.',
    specs: JSON.stringify([['Material','Polyamid PA66'],['Gewinde','M16'],['Schutzklasse','IP68'],['Kabeleinführbereich','4–8mm']]),
    apps: JSON.stringify(['Schaltschränke','Steuerungsanlagen','Industrie']),
    mpMin: 0.75, mpMax: 1.00, stock: 2100, featured: 0, badge: null,
    tiers: [[1,99,0.65,'1–99 Stück'],[100,499,0.56,'100–499 Stück'],[500,null,0.48,'Ab 500 Stück']],
  },
  {
    name: 'Reihenklemme 2,5mm² grau',
    slug: 'reihenklemme-25mm2-grau',
    sku: 'RK-25-GR',
    cat: 'reihenklemmen',
    desc: 'Reihenklemme mit Push-in Anschluss, 2,5mm², grau. Schnelle werkzeuglose Verdrahtung.',
    specs: JSON.stringify([['Anschlussquerschnitt','0,5–2,5mm²'],['Anschlussart','Push-in'],['Nennspannung','500V'],['Nennstrom','24A'],['Norm','IEC 60947-7-1']]),
    apps: JSON.stringify(['Schaltschränke','Steuerungstechnik','Gebäudeautomation']),
    mpMin: 0.80, mpMax: 1.20, stock: 890, featured: 1, badge: '-40%',
    tiers: [[1,49,0.82,'1–49 Stück'],[50,199,0.72,'50–199 Stück'],[200,null,0.62,'Ab 200 Stück']],
  },
  {
    name: 'Reihenklemme 4mm² grau',
    slug: 'reihenklemme-4mm2-grau',
    sku: 'RK-40-GR',
    cat: 'reihenklemmen',
    desc: 'Reihenklemme Push-in, 4mm², grau. Nennstrom bis 32A.',
    specs: JSON.stringify([['Anschlussquerschnitt','0,5–4mm²'],['Nennspannung','500V'],['Nennstrom','32A']]),
    apps: JSON.stringify(['Schaltschränke','Energieverteilung']),
    mpMin: 1.00, mpMax: 1.50, stock: 450, featured: 0, badge: null,
    tiers: [[1,49,1.05,'1–49 Stück'],[50,199,0.92,'50–199 Stück'],[200,null,0.79,'Ab 200 Stück']],
  },
  {
    name: 'Reihenklemme 2,5mm² blau (N-Leiter)',
    slug: 'reihenklemme-25mm2-blau',
    sku: 'RK-25-BL',
    cat: 'reihenklemmen',
    desc: 'Reihenklemme Push-in, 2,5mm², blau. Standard für N-Leiter Anschlüsse.',
    specs: JSON.stringify([['Anschlussquerschnitt','0,5–2,5mm²'],['Nennstrom','24A'],['Farbe','Blau (N-Leiter)']]),
    apps: JSON.stringify(['N-Leiter Anschlüsse','Schaltschränke']),
    mpMin: 0.85, mpMax: 1.25, stock: 620, featured: 0, badge: null,
    tiers: [[1,49,0.85,'1–49 Stück'],[50,199,0.75,'50–199 Stück'],[200,null,0.65,'Ab 200 Stück']],
  },
  {
    name: 'DIN-Schiene 35x7,5mm galvanisiert 1m',
    slug: 'din-schiene-35x75-galv-1m',
    sku: 'DIN-35-1M',
    cat: 'din-schienen',
    desc: 'DIN-Schiene 35x7,5mm, galvanisiert, 1 Meter. Norm EN 60715.',
    specs: JSON.stringify([['Abmessung','35x7,5mm'],['Länge','1000mm'],['Material','Stahl galvanisiert'],['Norm','EN 60715 (TH35-7,5)']]),
    apps: JSON.stringify(['Schaltschränke','Verteiler','Industrie']),
    mpMin: 3.50, mpMax: 5.00, stock: 320, featured: 0, badge: null,
    tiers: [[1,9,2.20,'1–9 Stück'],[10,49,1.90,'10–49 Stück'],[50,null,1.60,'Ab 50 Stück']],
  },
];

for (const p of products) {
  const r = insertProduct.run(
    p.name, p.slug, p.sku, catIds[p.cat],
    p.desc, p.specs, p.apps,
    p.mpMin, p.mpMax, p.stock, p.featured, p.badge
  );
  for (const [minQ, maxQ, price, label] of p.tiers) {
    insertTier.run(r.lastInsertRowid, minQ, maxQ, price, label);
  }
}

const adminExists = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 12);
  db.prepare(`INSERT OR IGNORE INTO users (email, password_hash, name, company, role) VALUES (?, ?, ?, ?, ?)`)
    .run('admin@imeraelektro.at', hash, 'Administrator', 'Imera Elektro', 'admin');
  console.log('Admin user created: admin@imeraelektro.at / admin123');
}

console.log(`✓ Seeding completed! ${categories.length} categories, ${products.length} products`);
