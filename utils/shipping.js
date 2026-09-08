'use strict';

// Zentrale Versandkosten-Berechnung (D1).
// - Normales Paket: Pauschale 7,90 € netto; entfällt ab Frei-Schwelle (Standard 1500 € netto Warenwert).
// - Sperrgut: fixer Aufschlag JE ARTIKEL & Stück (SKU-basiert, products.sperrgut_surcharge).
//   Wird IMMER berechnet – unabhängig vom Bestellwert, da Sperrgut über einen eigenen
//   Kanal (Spedition/Palette) läuft und nicht unter die Gratis-Paket-Schwelle fällt.
const FLAT_PACKAGE = 7.90;

/**
 * @param {Array<{product?:{sperrgut_surcharge?:number}, qty?:number, lineTotal?:number}>} items
 * @param {{freeThreshold?:number}} opts
 */
function computeShipping(items, opts = {}) {
  const freeThreshold = opts.freeThreshold != null ? opts.freeThreshold : 1500;
  let subtotal = 0;
  let sperrgut = 0;
  for (const it of (items || [])) {
    subtotal += it.lineTotal || 0;
    const sur = it.product ? parseFloat(it.product.sperrgut_surcharge) : 0;
    if (sur && sur > 0) sperrgut += sur * (it.qty || 1);
  }
  subtotal = parseFloat(subtotal.toFixed(2));
  sperrgut = parseFloat(sperrgut.toFixed(2));
  const packageShipping = subtotal >= freeThreshold ? 0 : FLAT_PACKAGE;
  const total = parseFloat((packageShipping + sperrgut).toFixed(2));
  return { subtotal, packageShipping, sperrgut, total, freeThreshold, hasSperrgut: sperrgut > 0 };
}

module.exports = { computeShipping, FLAT_PACKAGE };
