'use strict';
/**
 * Turso DB yedeği → yerel .sql dosyası (turso .dump benzeri, CLI'siz).
 * Sadece kaynak gerekir. Dosya PRAGMA foreign_keys=OFF + BEGIN/COMMIT ile sarılır,
 * böylece istenirse başka bir SQLite/Turso'ya geri yüklenebilir.
 *
 * Kullanım (Windows):
 *   set SRC_URL=libsql://...turso.io
 *   set SRC_TOKEN=...
 *   node scripts/turso-backup.js                 # yedek-YYYYMMDD-HHMM.sql
 *   node scripts/turso-backup.js backup.sql      # belirtilen dosyaya
 */
const { createClient } = require('@libsql/client');
const fs = require('fs');

if (!process.env.SRC_URL) { console.error('Eksik: SRC_URL'); process.exit(1); }
const src = createClient({ url: process.env.SRC_URL, authToken: process.env.SRC_TOKEN || undefined });

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return "X'" + Buffer.from(v).toString('hex') + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
};

async function main() {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const out = process.argv[2] || `yedek-${ts}.sql`;
  const ws = fs.createWriteStream(out, { encoding: 'utf8' });
  ws.write('PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n');

  const master = await src.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' " +
    "ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END"
  );
  const tables = master.rows.filter(r => r.type === 'table');

  let totalRows = 0;
  // Şema (tablolar)
  for (const t of tables) ws.write(t.sql + ';\n');
  // Veri
  for (const t of tables) {
    const colsRes = await src.execute(`PRAGMA table_info(${q(t.name)})`);
    const cols = colsRes.rows.map(r => r.name);
    const colList = cols.map(q).join(',');
    const all = await src.execute(`SELECT ${colList} FROM ${q(t.name)}`);
    for (const row of all.rows) {
      ws.write(`INSERT INTO ${q(t.name)} (${colList}) VALUES (${cols.map(c => lit(row[c])).join(',')});\n`);
    }
    totalRows += all.rows.length;
    console.log(`  ${t.name}: ${all.rows.length} satır`);
  }
  // Index + trigger
  for (const o of master.rows.filter(r => r.type !== 'table')) ws.write(o.sql + ';\n');
  ws.write('COMMIT;\n');
  await new Promise(r => ws.end(r));

  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`\n✓ Yedek yazıldı: ${out}  (${tables.length} tablo, ${totalRows} satır, ${kb} KB)`);
}
main().then(() => process.exit(0)).catch(e => { console.error('HATA:', e.message); process.exit(1); });
