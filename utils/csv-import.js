// Toplu CSV import mantığı (admin sayfası + geçici token endpoint ortak kullanır).
// SKU'ya göre upsert (silme yok), kategoriler otomatik, tek fiyat kademesi, batch.

function slugify(text) {
  return String(text || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function parseCsvBuf(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c === '\r') { /* skip */ } else f += c; }
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function parseSpecsStr(s) {
  if (!s) return [];
  return String(s).split(';').map(p => { const i = p.indexOf(':'); if (i < 0) return null; return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }).filter(x => x && x[0] && x[1]);
}

async function importProducts(db, buffer) {
  const rows = parseCsvBuf(buffer.toString('utf8'));
  if (rows.length < 2) throw new Error('CSV ist leer.');
  const H = rows[0].map(h => h.replace(/^﻿/, '').trim());
  const ci = {}; ['sku', 'name', 'category', 'brand', 'short_description', 'description', 'image_url', 'gallery', 'price', 'stock', 'specs'].forEach(k => ci[k] = H.indexOf(k));
  if (ci.sku < 0 || ci.name < 0 || ci.price < 0) throw new Error('CSV-Kopf muss mindestens sku, name, price enthalten.');
  const data = rows.slice(1).filter(r => (r[ci.sku] || '').trim());

  // 1) Kategoriler
  const catMap = new Map();
  for (const cn of [...new Set(data.map(r => (ci.category >= 0 && r[ci.category] || '').trim() || 'Sonstiges'))]) {
    let row = await db.prepare('SELECT id FROM categories WHERE name=?').get(cn);
    if (!row) {
      try { const r = await db.prepare('INSERT INTO categories (name, slug) VALUES (?,?)').run(cn, slugify(cn) || 'kat-' + Date.now()); row = { id: Number(r.lastInsertRowid) }; }
      catch (_) { row = await db.prepare('SELECT id FROM categories WHERE slug=?').get(slugify(cn)); }
    }
    catMap.set(cn, row.id);
  }

  // 1b) Markalar (varsa oluştur — yeni marka eklemek için yapı değişikliği gerekmez)
  const brandMap = new Map();
  if (ci.brand >= 0) {
    for (const bn of [...new Set(data.map(r => (r[ci.brand] || '').trim()).filter(Boolean))]) {
      let row = await db.prepare('SELECT id FROM brands WHERE name=? OR slug=?').get(bn, slugify(bn));
      if (!row) {
        try { const r = await db.prepare('INSERT INTO brands (name, slug) VALUES (?,?)').run(bn, slugify(bn) || 'marke-' + Date.now()); row = { id: Number(r.lastInsertRowid) }; }
        catch (_) { row = await db.prepare('SELECT id FROM brands WHERE slug=?').get(slugify(bn)); }
      }
      if (row) brandMap.set(bn, row.id);
    }
  }

  // 2) Ürünleri upsert (batch)
  const prodStmts = [], skus = [], priceBySku = new Map();
  for (const r of data) {
    const sku = (r[ci.sku] || '').trim(); skus.push(sku);
    const name = (r[ci.name] || '').trim() || sku;
    const cat_id = catMap.get((ci.category >= 0 && r[ci.category] || '').trim() || 'Sonstiges');
    const short = ci.short_description >= 0 ? (r[ci.short_description] || '').trim() : '';
    const desc = ci.description >= 0 ? (r[ci.description] || '').trim() : '';
    const image = ci.image_url >= 0 ? (r[ci.image_url] || '').trim() : '';
    const gallery = JSON.stringify(ci.gallery >= 0 ? (r[ci.gallery] || '').split('|').map(s => s.trim()).filter(Boolean) : []);
    const stock = ci.stock >= 0 ? (parseInt(r[ci.stock]) || 0) : 0;
    const specs = JSON.stringify(ci.specs >= 0 ? parseSpecsStr(r[ci.specs]) : []);
    const slug = (slugify(name) || 'produkt') + '-' + slugify(sku);
    priceBySku.set(sku, parseFloat((r[ci.price] || '').replace(',', '.')) || 0);
    const brand_id = ci.brand >= 0 ? (brandMap.get((r[ci.brand] || '').trim()) || null) : null;
    prodStmts.push({
      sql: `INSERT INTO products (name, slug, sku, category_id, brand_id, short_description, description, specs, stock, image, images, active, sell_as_pack, pack_size)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,1,0,1)
            ON CONFLICT(sku) DO UPDATE SET name=excluded.name, category_id=excluded.category_id,
              brand_id=COALESCE(excluded.brand_id, products.brand_id),
              short_description=excluded.short_description, description=excluded.description,
              specs=excluded.specs, stock=excluded.stock, image=excluded.image, images=excluded.images,
              updated_at=datetime('now')`,
      args: [name, slug, sku, cat_id, brand_id, short || null, desc || null, specs, stock, image || null, gallery],
    });
  }
  for (let i = 0; i < prodStmts.length; i += 100) await db.batch(prodStmts.slice(i, i + 100));

  // 3) SKU→id
  const idMap = new Map();
  for (let i = 0; i < skus.length; i += 200) {
    const chunk = skus.slice(i, i + 200);
    const found = await db.prepare(`SELECT id, sku FROM products WHERE sku IN (${chunk.map(() => '?').join(',')})`).all(...chunk);
    for (const f of found) idMap.set(f.sku, f.id);
  }

  // 4) Tek fiyat kademesi (batch)
  const tierStmts = [];
  for (const sku of skus) {
    const pid = idMap.get(sku); if (!pid) continue;
    tierStmts.push({ sql: 'DELETE FROM product_tiers WHERE product_id=?', args: [pid] });
    tierStmts.push({ sql: 'INSERT INTO product_tiers (product_id, min_qty, max_qty, price, label) VALUES (?,1,NULL,?,NULL)', args: [pid, priceBySku.get(sku)] });
  }
  for (let i = 0; i < tierStmts.length; i += 100) await db.batch(tierStmts.slice(i, i + 100));

  return { products: skus.length, categories: catMap.size };
}

module.exports = { importProducts };
