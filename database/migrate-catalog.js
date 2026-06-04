// Tek seferlik katalog migration'ı.
// catalog-snapshot.json'daki nihai katalogu (20 ürün, gerçek fotoğraflar) aktif DB'ye
// (production'da Turso, dev'de SQLite) yansıtır. Idempotent + sürüm bayrağı korumalı.
// await hem Turso (async) hem better-sqlite3 (sync, await no-op) ile çalışır.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const COLS = ['name','slug','sku','category_id','description','specs','applications',
  'market_price_min','market_price_max','stock','image','images','active','featured','badge',
  'short_description','weight','dimensions','min_order_qty','delivery_time','meta_title','meta_description','size'];

async function migrateCatalog() {
  const snapPath = path.join(__dirname, 'catalog-snapshot.json');
  if (!fs.existsSync(snapPath)) return;
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
  if (!snap.products || !snap.products.length) return;

  // Sürüm bayrağı — bu sürüm zaten uygulanmışsa atla
  const flag = await db.prepare('SELECT value FROM settings WHERE key=?').get('catalog_version');
  if (flag && flag.value === snap.version) return;

  console.log('⏳ Katalog migration başlıyor:', snap.version);

  const snapSkus = new Set(snap.products.map(p => p.sku));
  const existing = await db.prepare('SELECT id, sku FROM products').all();
  const bySku = new Map(existing.map(r => [r.sku, r.id]));

  // 1) Snapshot'ta olmayan ürünleri sil (sipariş geçmişi product_name/sku'da korunur)
  let deleted = 0;
  for (const r of existing) {
    if (snapSkus.has(r.sku)) continue;
    await db.prepare('UPDATE order_items SET product_id=NULL WHERE product_id=?').run(r.id);
    await db.prepare('DELETE FROM cart_items WHERE product_id=?').run(r.id);
    await db.prepare('DELETE FROM merkliste WHERE product_id=?').run(r.id);
    await db.prepare('DELETE FROM reviews WHERE product_id=?').run(r.id);
    await db.prepare('DELETE FROM product_tiers WHERE product_id=?').run(r.id);
    await db.prepare('DELETE FROM products WHERE id=?').run(r.id);
    deleted++;
  }

  // 2) Snapshot'taki her ürünü upsert et (sku'ya göre) + tier'ları yeniden kur
  let inserted = 0, updated = 0;
  for (const p of snap.products) {
    const vals = COLS.map(c => (p[c] === undefined ? null : p[c]));
    let pid = bySku.get(p.sku);
    if (pid != null) {
      const setStr = COLS.map(c => c + '=?').join(', ');
      await db.prepare(`UPDATE products SET ${setStr}, updated_at=datetime('now') WHERE id=?`).run(...vals, pid);
      updated++;
    } else {
      const colStr = COLS.join(', ');
      const ph = COLS.map(() => '?').join(',');
      const r = await db.prepare(`INSERT INTO products (${colStr}) VALUES (${ph})`).run(...vals);
      pid = Number(r.lastInsertRowid);
      inserted++;
    }
    await db.prepare('DELETE FROM product_tiers WHERE product_id=?').run(pid);
    for (const t of (p.tiers || [])) {
      await db.prepare('INSERT INTO product_tiers (product_id, min_qty, max_qty, price, label) VALUES (?,?,?,?,?)')
        .run(pid, t.min_qty, t.max_qty, t.price, t.label);
    }
  }

  // 3) Sürüm bayrağını ayarla
  await db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('catalog_version', snap.version);

  console.log(`✓ Katalog migration tamam: ${inserted} eklendi, ${updated} güncellendi, ${deleted} silindi`);
}

module.exports = migrateCatalog;
