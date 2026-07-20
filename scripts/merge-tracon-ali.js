// Tek seferlik: Ali fiyat listesi (353) + TRACON export → normalize import CSV.
// Fiyat Ali'den, foto/açıklama/kategori/stok/spec TRACON'dan (SKU = Artikelnummer = ManufacturerProductNumber).
const fs = require('fs');
const path = require('path');

function parseCSV(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c === '\r') { /* skip */ }
      else f += c;
    }
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function csvField(v) {
  v = (v == null ? '' : String(v));
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

const DL = 'C:/Users/alisa/Downloads/';
const ali = parseCSV(fs.readFileSync(DL + 'Ali_Artikelliste_353 (2).csv', 'utf8'));
const trc = parseCSV(fs.readFileSync(DL + 'tracon_backup (1).csv', 'utf8'));

const aH = ali[0].map(h => h.replace(/^﻿/, ''));
const tH = trc[0].map(h => h.replace(/^﻿/, ''));
const ai = n => aH.indexOf(n);
const ti = n => tH.indexOf(n);

const aSku = ai('Artikelnummer'), aPrice = ai('Verkaufspreis_netto_EUR');
const tMpn = ti('ManufacturerProductNumber');
const idx = {
  name: ti('Name'), short: ti('ShortDescription'), desc: ti('Description'),
  cat: ti('ProductCategory'), stock: ti('Bestand'), techn: ti('Technische Daten'),
  weight: ti('Gewicht'), ean: ti('EAN'),
  photo1: ti('Photo 1'), etimDE: ti('ETIM-Merkmale, Werte.1'),
};
const photoCols = ['Photo 1', 'Photo 2', 'Photo 3', 'Photo 4', 'Photo 5', 'Bild 6', 'Bild 7', 'Bild 8'].map(ti).filter(x => x >= 0);

// TRACON'u SKU'ya göre indeksle
const tByMpn = new Map();
for (const r of trc.slice(1)) { const k = (r[tMpn] || '').trim(); if (k) tByMpn.set(k, r); }

const out = [['sku', 'name', 'category', 'short_description', 'description', 'image_url', 'gallery', 'price', 'stock', 'specs']];
const cats = new Map(); let withImg = 0, noMatch = 0; let pMin = Infinity, pMax = 0;

for (const r of ali.slice(1)) {
  const sku = (r[aSku] || '').trim(); if (!sku) continue;
  const price = parseFloat((r[aPrice] || '').replace(',', '.')) || 0;
  const t = tByMpn.get(sku);
  if (!t) { noMatch++; continue; }
  const imgs = photoCols.map(ci => (t[ci] || '').trim()).filter(u => /^https?:\/\//.test(u));
  const image = imgs[0] || '';
  const gallery = imgs.slice(1).join('|');
  const cat = (t[idx.cat] || '').trim() || 'Sonstiges';
  cats.set(cat, (cats.get(cat) || 0) + 1);
  if (image) withImg++;
  if (price > 0) { pMin = Math.min(pMin, price); pMax = Math.max(pMax, price); }
  // specs: Almanca ETIM "k: v; k: v" → "k: v; k: v" (admin tarafında JSON'a çevrilecek); yoksa Technische Daten
  const specs = (t[idx.etimDE] || '').trim() || (t[idx.techn] || '').trim();
  out.push([
    sku, (t[idx.name] || '').trim(), cat,
    (t[idx.short] || '').trim(), (t[idx.desc] || '').trim(),
    image, gallery, price.toFixed(4), (t[idx.stock] || '0').trim(), specs,
  ]);
}

const outPath = DL + 'import_353.csv';
fs.writeFileSync(outPath, out.map(row => row.map(csvField).join(',')).join('\n'), 'utf8');

console.log('✓ Yazıldı:', outPath);
console.log('Ürün (satır):', out.length - 1, '| eşleşmeyen:', noMatch);
console.log('Görseli olan:', withImg, '/', out.length - 1);
console.log('Fiyat aralığı: ' + pMin.toFixed(2) + '€ – ' + pMax.toFixed(2) + '€');
console.log('Kategoriler (' + cats.size + '):');
[...cats.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log('  ' + n + '  ' + c));
