'use strict';
/**
 * Cloudinary-Migration: Bilder vom ALTEN Cloudinary-Konto ins NEUE kopieren
 * (gleiche public_id/Ordner) und die URLs in der (bereits auf das neue Turso
 * umgezogenen) Datenbank umschreiben.
 *
 * Voraussetzungen:
 *   - Daten sind schon ins neue Turso uebernommen (die image-URLs zeigen noch
 *     auf das ALTE Cloudinary — das ist gewollt, sie sind die Quelle).
 *   - Das alte Cloudinary-Konto ist noch online (Bilder abrufbar).
 *
 * ENV:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN      -> das NEUE Turso
 *   CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET  -> das NEUE Cloudinary-Konto
 *
 * Lauf:  node scripts/migrate-cloudinary.js          (Testlauf, schreibt nichts)
 *        node scripts/migrate-cloudinary.js --apply  (kopiert + schreibt DB um)
 */
require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const db = require('../database/db');

const APPLY = process.argv.includes('--apply');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});
const NEW_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;

// Aus einer Cloudinary-URL public_id (inkl. Ordner, ohne Version/Endung) ziehen.
function parseCloudinary(url) {
  const m = /res\.cloudinary\.com\/([^/]+)\/(?:image|raw|video)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i.exec(url || '');
  if (!m) return null;
  return { cloud: m[1], publicId: m[2] };
}

// Alle image-URLs aus den 3 Spalten sammeln (eindeutig).
async function collectUrls() {
  const urls = new Set();
  const add = (v) => { if (typeof v === 'string' && v.includes('res.cloudinary.com')) urls.add(v); };
  for (const r of await db.prepare('SELECT image FROM products WHERE image LIKE ?').all('%res.cloudinary.com%')) add(r.image);
  for (const r of await db.prepare('SELECT image FROM product_variants WHERE image LIKE ?').all('%res.cloudinary.com%')) add(r.image);
  for (const r of await db.prepare("SELECT images FROM products WHERE images LIKE ?").all('%res.cloudinary.com%')) {
    try { (JSON.parse(r.images) || []).forEach(add); } catch (_) {}
  }
  return [...urls];
}

async function main() {
  const urls = await collectUrls();
  const clouds = new Set(urls.map(u => parseCloudinary(u)?.cloud).filter(Boolean));
  console.log(`Gefundene Bild-URLs: ${urls.length}`);
  console.log(`Alte Cloud-Namen in URLs: ${[...clouds].join(', ') || '—'}`);
  console.log(`Neues Cloudinary-Ziel: ${NEW_CLOUD}`);
  if (!APPLY) { console.log('\nTestlauf (keine Aenderung). Mit --apply ausfuehren.'); return; }
  if (!NEW_CLOUD || !process.env.CLOUDINARY_API_KEY) { console.error('Neue Cloudinary-ENV fehlt.'); process.exit(1); }

  // 1) Jede Bild-Datei ins neue Konto kopieren (gleiche public_id).
  let copied = 0, failed = 0;
  for (const url of urls) {
    const p = parseCloudinary(url);
    if (!p || p.cloud === NEW_CLOUD) continue; // schon im neuen Konto
    try {
      await cloudinary.uploader.upload(url, { public_id: p.publicId, overwrite: true, resource_type: 'image' });
      copied++;
      if (copied % 25 === 0) console.log(`  kopiert: ${copied}`);
    } catch (e) { failed++; console.error('  FEHLER', p.publicId, e.message); }
  }
  console.log(`Kopiert: ${copied}, Fehler: ${failed}`);

  // 2) URLs in der DB umschreiben: alten Cloud-Namen -> neuen.
  let updated = 0;
  for (const oldCloud of clouds) {
    if (oldCloud === NEW_CLOUD) continue;
    const from = `res.cloudinary.com/${oldCloud}/`;
    const to = `res.cloudinary.com/${NEW_CLOUD}/`;
    const r1 = await db.prepare('UPDATE products SET image=REPLACE(image, ?, ?) WHERE image LIKE ?').run(from, to, `%${oldCloud}%`);
    const r2 = await db.prepare('UPDATE product_variants SET image=REPLACE(image, ?, ?) WHERE image LIKE ?').run(from, to, `%${oldCloud}%`);
    const r3 = await db.prepare('UPDATE products SET images=REPLACE(images, ?, ?) WHERE images LIKE ?').run(from, to, `%${oldCloud}%`);
    updated += (r1.changes || 0) + (r2.changes || 0) + (r3.changes || 0);
  }
  console.log(`DB-Zeilen aktualisiert: ${updated}`);
  console.log('Fertig. Bitte Stichprobe im Shop pruefen, dann altes Cloudinary-Konto behalten bis alles bestaetigt ist.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
