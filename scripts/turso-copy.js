'use strict';
/**
 * Turso-zu-Turso Kopyalama (CLI'siz, @libsql/client ile).
 * Kaynak (eski) DB'deki şema + tüm veriyi hedef (yeni) DB'ye kopyalar.
 * Token'lar ortam değişkeninden okunur — koda/sohbete girmez.
 *
 * Kullanım (Windows PowerShell):
 *   $env:SRC_URL="libsql://eski-...turso.io";  $env:SRC_TOKEN="..."
 *   $env:DEST_URL="libsql://yeni-...turso.io";  $env:DEST_TOKEN="..."
 *   node scripts/turso-copy.js            # önce kuru test (sadece sayım)
 *   node scripts/turso-copy.js --apply    # gerçek kopyalama
 *
 * macOS/Linux:  SRC_URL=... SRC_TOKEN=... DEST_URL=... DEST_TOKEN=... node scripts/turso-copy.js --apply
 */
const { createClient } = require('@libsql/client');

const APPLY = process.argv.includes('--apply');
const need = ['SRC_URL', 'SRC_TOKEN', 'DEST_URL', 'DEST_TOKEN'];
// file: URL'lerde token gerekmez (lokal test) → token'ı opsiyonele düşür
for (const k of ['SRC_URL', 'DEST_URL']) if (!process.env[k]) { console.error('Eksik:', k); process.exit(1); }

function cli(prefix) {
  const url = process.env[prefix + '_URL'];
  const authToken = process.env[prefix + '_TOKEN'] || undefined;
  return createClient({ url, authToken });
}
const src = cli('SRC');
const dest = cli('DEST');

const CHUNK = 500;
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';

async function main() {
  // 1) Kaynaktan şema objelerini al (tablo → index → trigger sırası önemli)
  const master = await src.execute(
    "SELECT type, name, tbl_name, sql FROM sqlite_master " +
    "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' " +
    "ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END"
  );
  const tables = master.rows.filter(r => r.type === 'table');
  const others = master.rows.filter(r => r.type !== 'table');
  console.log(`Kaynak: ${tables.length} tablo, ${others.length} index/trigger`);

  // Satır sayıları (kuru testte de göster)
  let totalRows = 0;
  const counts = {};
  for (const t of tables) {
    const c = await src.execute(`SELECT COUNT(*) n FROM ${q(t.name)}`);
    counts[t.name] = Number(c.rows[0].n); totalRows += counts[t.name];
  }
  console.log('Satır sayıları:', JSON.stringify(counts));
  console.log('Toplam satır:', totalRows);

  if (!APPLY) { console.log('\nKURU TEST — hiçbir şey yazılmadı. --apply ile çalıştır.'); return; }
  if (need.some(k => !process.env[k]) && !/^file:/.test(process.env.DEST_URL)) {
    console.error('Gerçek kopyalama için SRC_TOKEN ve DEST_TOKEN gerekli.'); process.exit(1);
  }

  // 2) Hedefte şemayı oluştur (IF NOT EXISTS'e çevirerek güvenli yap)
  try { await dest.execute('PRAGMA foreign_keys=OFF'); } catch (_) {}
  const idemp = (sql, type) => {
    if (type === 'table')   return sql.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
    if (type === 'index')   return sql.replace(/^CREATE (UNIQUE )?INDEX\s+/i, (m,u)=>`CREATE ${u||''}INDEX IF NOT EXISTS `);
    if (type === 'trigger') return sql.replace(/^CREATE TRIGGER\s+/i, 'CREATE TRIGGER IF NOT EXISTS ');
    return sql;
  };
  for (const t of tables) await dest.execute(idemp(t.sql, 'table'));
  console.log('Tablolar oluşturuldu.');

  // 3) Veriyi kopyala.
  // Turso uzaktan bağlantıda `PRAGMA foreign_keys=OFF` tek execute'ta kalıcı olmuyor;
  // bu yüzden `turso .dump` restore gibi: TEK script içinde (executeMultiple) önce
  // PRAGMA OFF, sonra BEGIN/INSERT.../COMMIT çalıştırıyoruz → FK zorlanmaz, sıra dert değil.
  const lit = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v instanceof Uint8Array || Buffer.isBuffer(v)) return "X'" + Buffer.from(v).toString('hex') + "'";
    return "'" + String(v).replace(/'/g, "''") + "'";
  };
  for (const t of tables) {
    const colsRes = await src.execute(`PRAGMA table_info(${q(t.name)})`);
    const cols = colsRes.rows.map(r => r.name);
    const colList = cols.map(q).join(',');
    const all = await src.execute(`SELECT ${colList} FROM ${q(t.name)}`);
    let done = 0;
    for (let i = 0; i < all.rows.length; i += CHUNK) {
      const slice = all.rows.slice(i, i + CHUNK);
      const values = slice.map(row => '(' + cols.map(c => lit(row[c])).join(',') + ')').join(',\n');
      const script =
        'PRAGMA foreign_keys=OFF;\nBEGIN;\n' +
        `INSERT OR REPLACE INTO ${q(t.name)} (${colList}) VALUES\n${values};\n` +
        'COMMIT;';
      await dest.executeMultiple(script);
      done += slice.length;
    }
    console.log(`  ${t.name}: ${done} satır`);
  }

  // 4) Index + trigger'ları oluştur
  for (const o of others) { try { await dest.execute(idemp(o.sql, o.type)); } catch (e) { console.error('  (atlandı)', o.name, e.message); } }
  try { await dest.execute('PRAGMA foreign_keys=ON'); } catch (_) {}

  // 5) Doğrulama: hedef satır sayıları
  const verify = {};
  for (const t of tables) {
    const c = await dest.execute(`SELECT COUNT(*) n FROM ${q(t.name)}`);
    verify[t.name] = Number(c.rows[0].n);
  }
  console.log('\nHedef satır sayıları:', JSON.stringify(verify));
  const ok = tables.every(t => verify[t.name] === counts[t.name]);
  console.log(ok ? '✓ Tüm tablolar birebir kopyalandı.' : '⚠ Bazı tablolarda sayı farkı var — yukarıyı kontrol et.');
}

main().then(() => process.exit(0)).catch(e => { console.error('HATA:', e.message); process.exit(1); });
