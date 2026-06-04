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

async function migrateCatalog(opts = {}) {
  const snapPath = path.join(__dirname, 'catalog-snapshot.json');
  if (!fs.existsSync(snapPath)) return { skipped: 'snapshot yok' };
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
  if (!snap.products || !snap.products.length) return { skipped: 'ürün yok' };

  // Sürüm bayrağı — bu sürüm zaten uygulanmışsa atla (force ile baypas)
  if (!opts.force) {
    const flag = await db.prepare('SELECT value FROM settings WHERE key=?').get('catalog_version');
    if (flag && flag.value === snap.version) return { skipped: 'zaten uygulanmış', version: snap.version };
  }

  console.log('⏳ Katalog migration başlıyor:', snap.version);

  const snapSkus = new Set(snap.products.map(p => p.sku));
  const existing = await db.prepare('SELECT id, sku FROM products').all();
  const bySku = new Map(existing.map(r => [r.sku, r.id]));

  // Yardımcı: hata olursa yoksay (Turso şemasında eksik tablo/kolon olabilir)
  async function safeRun(sql, args) {
    try { await db.prepare(sql).run(...args); return true; }
    catch (e) { console.warn('  (atlandı) ' + sql.slice(0, 40) + ' → ' + e.message); return false; }
  }

  // 1) Snapshot'ta olmayan ürünleri sil (sipariş geçmişi product_name/sku'da korunur)
  let deleted = 0;
  for (const r of existing) {
    if (snapSkus.has(r.sku)) continue;
    await safeRun('UPDATE order_items SET product_id=NULL WHERE product_id=?', [r.id]);
    await safeRun('DELETE FROM cart_items WHERE product_id=?', [r.id]);
    await safeRun('DELETE FROM merkliste WHERE product_id=?', [r.id]);
    await safeRun('DELETE FROM reviews WHERE product_id=?', [r.id]);
    await safeRun('DELETE FROM product_tiers WHERE product_id=?', [r.id]);
    if (await safeRun('DELETE FROM products WHERE id=?', [r.id])) deleted++;
  }

  // 2) Snapshot'taki her ürünü upsert et (sku'ya göre)
  // Tier'lar yalnızca YENİ eklenen ürünler için kurulur — mevcut ürünlerin tier'ları
  // zaten orijinal seed'den doğru (round-trip sayısını azaltır, timeout'tan kaçınır).
  let inserted = 0, updated = 0;
  for (const p of snap.products) {
    const vals = COLS.map(c => (p[c] === undefined ? null : p[c]));
    let pid = bySku.get(p.sku);
    let isNew = false;
    if (pid != null) {
      const setStr = COLS.map(c => c + '=?').join(', ');
      await safeRun(`UPDATE products SET ${setStr}, updated_at=datetime('now') WHERE id=?`, [...vals, pid]);
      updated++;
    } else {
      try {
        const colStr = COLS.join(', ');
        const ph = COLS.map(() => '?').join(',');
        const r = await db.prepare(`INSERT INTO products (${colStr}) VALUES (${ph})`).run(...vals);
        pid = Number(r.lastInsertRowid);
        inserted++; isNew = true;
      } catch (e) {
        // Muhtemelen eşzamanlı insert (UNIQUE) — mevcut id'yi al + tier'ları kur
        const row = await db.prepare('SELECT id FROM products WHERE sku=?').get(p.sku);
        pid = row ? Number(row.id) : null; isNew = true;
      }
    }
    if (pid == null) continue;
    // Tier kontrolü: yeni üründe ya da tier'ı hiç yoksa kur
    if (isNew || opts.rebuildAllTiers) {
      await safeRun('DELETE FROM product_tiers WHERE product_id=?', [pid]);
      for (const t of (p.tiers || [])) {
        await safeRun('INSERT INTO product_tiers (product_id, min_qty, max_qty, price, label) VALUES (?,?,?,?,?)',
          [pid, t.min_qty, t.max_qty, t.price, t.label]);
      }
    }
  }

  // 3) Sürüm bayrağını ayarla
  await db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('catalog_version', snap.version);

  console.log(`✓ Katalog migration tamam: ${inserted} eklendi, ${updated} güncellendi, ${deleted} silindi`);
  return { inserted, updated, deleted, version: snap.version };
}

module.exports = migrateCatalog;
