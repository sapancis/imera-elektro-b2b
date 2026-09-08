'use strict';
const db = require('../database/db');

// Pawbol-Mindestbestellwert (E): Werden Pawbol-Artikel bestellt, muss der
// Pawbol-Warenwert (netto) einen Mindestbetrag erreichen (Standard 150 €),
// sonst ist die Bestellung nicht möglich. Betrifft nur die Pawbol-Position(en),
// nicht den Gesamtwarenkorb.

let _pawbolBrandId; // Marken-ID ist stabil → einmal pro Prozess auflösen
async function getPawbolBrandId() {
  if (_pawbolBrandId !== undefined) return _pawbolBrandId;
  try {
    const row = await db.prepare("SELECT id FROM brands WHERE slug='pawbol'").get();
    _pawbolBrandId = row ? row.id : null;
  } catch (_) { _pawbolBrandId = null; }
  return _pawbolBrandId;
}

async function getPawbolMinOrder() {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key='pawbol_min_order'").get();
    const v = parseFloat(row?.value);
    return Number.isFinite(v) ? v : 150;
  } catch (_) { return 150; }
}

/**
 * @param {Array<{product:{brand_id?:number}, lineTotal:number}>} items Warenkorb-Positionen
 * @returns {Promise<{pawbolSubtotal:number,pawbolMin:number,pawbolBlocked:boolean,pawbolShortfall:number}>}
 */
async function checkPawbolMin(items) {
  const [pawbolId, pawbolMin] = await Promise.all([getPawbolBrandId(), getPawbolMinOrder()]);
  let sub = 0;
  if (pawbolId) {
    for (const it of (items || [])) {
      if (it && it.product && it.product.brand_id === pawbolId) sub += it.lineTotal || 0;
    }
  }
  sub = parseFloat(sub.toFixed(2));
  const pawbolBlocked = sub > 0 && sub < pawbolMin;
  return {
    pawbolSubtotal: sub,
    pawbolMin,
    pawbolBlocked,
    pawbolShortfall: pawbolBlocked ? parseFloat((pawbolMin - sub).toFixed(2)) : 0,
  };
}

module.exports = { checkPawbolMin, getPawbolMinOrder, getPawbolBrandId };
