// Imera ürün fotoğrafları içe aktarma
// - Mevcut ürünlerin image + images alanlarını gerçek fotoğraflarla günceller
// - Eksik ürünleri (M32, PE 4mm, 6mm blau, Trennklemme) yeni oluşturur
// Görseller process_images.py ile public/uploads/ içine küçültülüp kopyalandı.
const db = require('../database/db');
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(
  path.join('C:', 'Users', 'alisa', 'Downloads', 'Imera Produktfotos Ordnung', 'manifest.json'), 'utf-8'
));

function gallery(prefix) {
  const arr = manifest[prefix];
  if (!arr || !arr.length) throw new Error('manifest eksik: ' + prefix);
  return { image: arr[0], images: JSON.stringify(arr.slice(1)) };
}

// ─── 1) MEVCUT ÜRÜNLERİ GÜNCELLE (sku → foto grubu) ──────────────────────────
const EXISTING = [
  ['KV-M16-IP68', 'prod-kvm16'],
  ['KV-M20-IP68', 'prod-kvm20'],
  ['KV-M25-IP68', 'prod-kvm25'],
  ['KB-100-25N',  'prod-kb100'],
  ['TRK-200-45B', 'prod-kb200'],
  ['TRK-300-48W', 'prod-kb300'],
  ['EDL-200-46-W4','prod-w4-200'],
  ['EDL-300-46',  'prod-w4-300'],
  ['RK-25-GR',    'prod-kl25gr'],
  ['RK-40-GR',    'prod-kl40gr'],
  ['RK-60-GR',    'prod-kl60gr'],
  ['DIN-EH-10',   'prod-endh'],
  ['KS-25-N',     'prod-kleb'],
  ['KM-PVC-W',    'prod-besch'],
];

const updStmt = db.prepare("UPDATE products SET image=?, images=?, updated_at=datetime('now') WHERE sku=?");
console.log('=== MEVCUT ÜRÜNLER GÜNCELLENİYOR ===');
for (const [sku, prefix] of EXISTING) {
  const g = gallery(prefix);
  const r = updStmt.run(g.image, g.images, sku);
  console.log(`${r.changes === 1 ? '✓' : '✗ BULUNAMADI'} ${sku}  (${manifest[prefix].length} foto)`);
}

// ─── 2) YENİ ÜRÜNLER ─────────────────────────────────────────────────────────
// Fiyatlar TAHMİNİDİR — admin panelinden ayarlanabilir.
const NEW = [
  {
    sku: 'KV-M32-IP68', prefix: 'prod-kvm32', cat: 7,
    name: 'Kabelverschraubung M32 IP68 grau (25er Pack)',
    slug: 'kabelverschraubung-m32-ip68-grau-25er-pack-kv-m32-ip68',
    short: 'Metrische Kabelverschraubung M32 IP68 aus Polyamid PA6, für Kabel Ø 18–25 mm. Inkl. O-Ring und Gegenmutter.',
    desc: 'Metrische Kabelverschraubung M32x1,5 aus Polyamid PA6, IP68-zertifiziert. Klemmt Kabeldurchmesser 18–25 mm. Lieferung inkl. O-Ring und Gegenmutter. Ideal für den professionellen Schaltschrank- und Maschinenbau.',
    specs: [["Material","Polyamid PA6"],["Gewindegröße","M32 x 1,5 mm"],["Kabeleinführung","Ø 18 – 25 mm"],["Farbe","Grau"],["Schutzklasse","IP68"],["Temperaturbereich","-30°C bis +80°C"],["Norm","EN 62444, EN 60423"],["Lieferumfang","inkl. O-Ring und Gegenmutter"],["Verpackungseinheit","25 Stück"]],
    apps: ["Schaltschrankbau","Maschinen- und Anlagenbau","Außeninstallationen","Feuchte und staubige Umgebungen"],
    mpMin: 0.65, mpMax: 1.45, stock: 1500,
    tiers: [[1,24,0.62],[25,99,0.49],[100,499,0.39],[500,null,0.30]],
  },
  {
    sku: 'RK-PE-40', prefix: 'prod-kl40pe', cat: 8,
    name: 'Schutzleiter-Klemme PE 4mm² grün-gelb (50er Pack)',
    slug: 'schutzleiter-klemme-pe-4mm-gruen-gelb-50er-pack-rk-pe-40',
    short: 'Schutzleiterklemme 4 mm² grün-gelb für DIN-Schiene, direkte Erdung über die Hutschiene.',
    desc: 'Federzug-Schutzleiterklemme 4 mm² für DIN-Schiene 35 mm. Direkter Erdungskontakt zur Hutschiene, werkzeuglose Bedienung durch Federzuganschluss. TSE/CE-zertifiziert.',
    specs: [["Nennquerschnitt","4 mm²"],["Leiterquerschnitt","0,5 – 6 mm²"],["Nennspannung","800 V AC"],["Farbe","Grün-Gelb (PE-Kennzeichnung)"],["Montage","DIN-Schiene 35mm, direkte Erdung"],["Schutzfunktion","Direktkontakt zur Hutschiene"],["Material","PA6.6 / Edelstahlfeder"],["Temperaturbereich","-40°C bis +140°C"],["Verpackungseinheit","50 Stück"],["Norm","DIN EN 60947-7-2, VDE 0611-1"]],
    apps: ["Schutzleiteranschluss in Schaltschränken","Erdungsverbindungen in Verteilern","Maschinen- und Anlagenbau (Sicherheitskreise)","Erneuerbare Energieanlagen"],
    mpMin: 0.26, mpMax: 0.62, stock: 3500,
    tiers: [[1,49,0.258],[50,199,0.198],[200,999,0.156],[1000,null,0.118]],
  },
  {
    sku: 'RK-60-BL', prefix: 'prod-kl60bl', cat: 8,
    name: 'Reihenklemme 6mm² blau (N-Leiter) (50er Pack)',
    slug: 'reihenklemme-6mm-blau-n-leiter-50er-pack-rk-60-bl',
    short: 'Federzug-Reihenklemme 6 mm² in Blau für N-Leiter-Anschlüsse, DIN-Schiene 35 mm.',
    desc: 'Federzugklemme 6 mm² für DIN-Schiene, blau gekennzeichnet für Neutralleiter (N). Werkzeuglose Bedienung durch Federzuganschluss. TSE/CE-zertifiziert.',
    specs: [["Nennquerschnitt","6 mm²"],["Leiterquerschnitt","0,5 – 6 mm²"],["Nennspannung","800 V AC / 1000 V DC"],["Nennstrom","41 A"],["Farbe","Blau (N-Leiter)"],["Montage","DIN-Schiene 35mm (EN 60715)"],["Material","PA6.6 / Edelstahlfeder"],["Temperaturbereich","-50°C bis +120°C"],["Verpackungseinheit","50 Stück"],["Norm","DIN EN 60947-7-1, VDE 0611-1"]],
    apps: ["N-Leiter-Anschlüsse in Schaltschränken","Energieverteiler und Sicherungskästen","Industrieautomation","Gebäudeleittechnik"],
    mpMin: 0.28, mpMax: 0.68, stock: 3000,
    tiers: [[1,49,0.275],[50,199,0.215],[200,999,0.168],[1000,null,0.128]],
  },
  {
    sku: 'TK-4-GR', prefix: 'prod-trenn', cat: 8,
    name: 'Trennklemme 4mm² grau mit Trennmesser (50er Pack)',
    slug: 'trennklemme-4mm-grau-mit-trennmesser-50er-pack-tk-4-gr',
    short: 'Trennklemme 4 mm² mit integriertem Trennmesser zur Stromkreis-Unterbrechung, DIN-Schiene 35 mm.',
    desc: 'Reihen-Trennklemme 4 mm² mit Trennmesser zum einfachen Auftrennen von Stromkreisen für Messung und Wartung. Für DIN-Schiene 35 mm, TSE/CE-zertifiziert.',
    specs: [["Nennquerschnitt","4 mm²"],["Leiterquerschnitt","0,5 – 4 mm²"],["Nennspannung","800 V AC"],["Nennstrom","32 A"],["Funktion","Trennmesser / Messertrennung"],["Farbe","Grau"],["Montage","DIN-Schiene 35mm (EN 60715)"],["Material","PA6.6"],["Temperaturbereich","-40°C bis +120°C"],["Verpackungseinheit","50 Stück"],["Norm","DIN EN 60947-7-1"]],
    apps: ["Mess- und Prüfstellen in Schaltschränken","Trennstellen für Wartung","Signal- und Steuerkreise","Prüf- und Servicepunkte"],
    mpMin: 0.55, mpMax: 1.30, stock: 1200,
    tiers: [[1,49,0.54],[50,199,0.42],[200,999,0.33],[1000,null,0.25]],
  },
];

const insProd = db.prepare(`
  INSERT INTO products (name, slug, sku, category_id, short_description, description, specs, applications,
    market_price_min, market_price_max, stock, min_order_qty, delivery_time,
    image, images, active, featured, badge)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?)
`);
const insTier = db.prepare('INSERT INTO product_tiers (product_id, min_qty, max_qty, price) VALUES (?,?,?,?)');
const findBySku = db.prepare('SELECT id FROM products WHERE sku=?');
const delTiers = db.prepare('DELETE FROM product_tiers WHERE product_id=?');
const updNew = db.prepare(`UPDATE products SET name=?, slug=?, category_id=?, short_description=?, description=?,
  specs=?, applications=?, market_price_min=?, market_price_max=?, stock=?, min_order_qty=?, delivery_time=?,
  image=?, images=?, active=1, updated_at=datetime('now') WHERE id=?`);

console.log('\n=== YENİ ÜRÜNLER ===');
for (const p of NEW) {
  const g = gallery(p.prefix);
  const specs = JSON.stringify(p.specs);
  const apps = JSON.stringify(p.apps);
  const existing = findBySku.get(p.sku);
  let pid;
  if (existing) {
    pid = existing.id;
    updNew.run(p.name, p.slug, p.cat, p.short, p.desc, specs, apps, p.mpMin, p.mpMax, p.stock, 1, '1-2 Werktage', g.image, g.images, pid);
    delTiers.run(pid);
    console.log(`↻ GÜNCELLENDİ ${p.sku} (id ${pid})`);
  } else {
    const r = insProd.run(p.name, p.slug, p.sku, p.cat, p.short, p.desc, specs, apps, p.mpMin, p.mpMax, p.stock, 1, '1-2 Werktage', g.image, g.images, null);
    pid = r.lastInsertRowid;
    console.log(`✓ EKLENDİ ${p.sku} (id ${pid}, ${manifest[p.prefix].length} foto)`);
  }
  for (const [minq, maxq, price] of p.tiers) insTier.run(pid, minq, maxq, price);
}

console.log('\nTamamlandı.');
process.exit(0);
