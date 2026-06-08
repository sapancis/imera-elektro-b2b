'use strict';
// Performans yardımcıları: settings'i tek sorguda cache'le, tier'ları batch yükle.
const cache = require('./cache');

// Tüm settings'i TEK sorguda al + cache'le (60s). setLocals her istekte 5 ayrı
// sorgu yapıyordu — bu onu 0/1'e indirir.
async function settingsMap(db) {
  let s = cache.get('settings_map');
  if (!s) {
    const rows = await db.prepare('SELECT key, value FROM settings').all();
    s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    cache.set('settings_map', s, 60_000);
  }
  return s;
}

// Bir ürün listesinin tier'larını TEK sorguda yükler (N+1 yerine 1 round-trip).
async function attachTiers(db, products) {
  if (!products || !products.length) return products;
  const ids = products.map(p => p.id).filter(v => v != null);
  if (!ids.length) return products;
  const ph = ids.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT * FROM product_tiers WHERE product_id IN (${ph}) ORDER BY min_qty`
  ).all(...ids);
  const grouped = {};
  for (const t of rows) (grouped[t.product_id] = grouped[t.product_id] || []).push(t);
  for (const p of products) p.tiers = grouped[p.id] || [];
  return products;
}

module.exports = { settingsMap, attachTiers };
