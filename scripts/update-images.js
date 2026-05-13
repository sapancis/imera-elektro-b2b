const db = require('../database/db');

const updates = [
  { slug: 'kabelbinder-200x45-schwarz-uv', image: 'prod1-kabelbinder-schwarz.jpg' },
  { slug: 'kabelbinder-300x48-weiss',      image: 'prod2-kabelbinder-weiss.jpg' },
  { slug: 'edelstahl-kabelbinder-300x46-w4', image: 'prod3-edelstahl-kabelbinder.png' },
  { slug: 'kabelverschraubung-m20-ip68',   image: 'prod4-kabelverschraubung-m20.jpg' },
  { slug: 'kabelverschraubung-m16-ip68',   image: 'prod5-kabelverschraubung-m16.jpg' },
  { slug: 'reihenklemme-25mm2-grau',       image: 'prod6-reihenklemme-grau.jpg' },
  { slug: 'reihenklemme-4mm2-grau',        image: 'prod7-reihenklemme-4mm.jpg' },
  { slug: 'reihenklemme-25mm2-blau',       image: 'prod8-reihenklemme-blau.jpg' },
  { slug: 'din-schiene-35x75-galv-1m',     image: 'prod9-din-schiene.jpg' },
];

const stmt = db.prepare('UPDATE products SET image = ? WHERE slug = ?');

for (const { slug, image } of updates) {
  const res = stmt.run(image, slug);
  console.log(res.changes === 1 ? `✓ ${slug}` : `✗ NOT FOUND: ${slug}`);
}

console.log('\nDone.');
process.exit(0);
