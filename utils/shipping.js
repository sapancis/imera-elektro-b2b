'use strict';

// Zentrale Versandkosten-Berechnung (D1).
// - Normales Paket: Pauschale 7,90 € netto; entfällt ab Frei-Schwelle (Standard 1500 € netto Warenwert).
// - Sperrgut: fixer Aufschlag JE ARTIKEL & Stück, IMMER berechnet – unabhängig vom
//   Bestellwert (eigener Kanal/Spedition), fällt NICHT unter die Gratis-Paket-Schwelle.
//   Ermittlung regelbasiert (config/sperrgut.js: Kategorie + Namensbestandteil);
//   Betrag je Gruppe aus den Einstellungen. Ein manuell gesetzter
//   products.sperrgut_surcharge > 0 hat Vorrang (Einzel-Übersteuerung).
const cache = require('./cache');
const { RULES } = require('../config/sperrgut');

const FLAT_PACKAGE = 7.90;

// Kategorie-IDs + Beträge je Regel auflösen (gecacht, 120s).
async function loadSperrgutConfig(db) {
  let cfg = cache.get('sperrgut_cfg');
  if (cfg) return cfg;
  cfg = [];
  for (const r of RULES) {
    let catIds = new Set();
    let amount = 0;
    try {
      const cats = await db.prepare('SELECT id FROM categories WHERE name=?').all(r.category);
      catIds = new Set(cats.map(c => c.id));
      const amtRow = await db.prepare('SELECT value FROM settings WHERE key=?').get(r.amountKey);
      amount = parseFloat(amtRow && amtRow.value) || 0;
    } catch (_) { /* Tabelle/Spalte fehlt noch → 0 */ }
    cfg.push({ group: r.group, catIds, nameIncludes: r.nameIncludes, amount });
  }
  cache.set('sperrgut_cfg', cfg, 120_000);
  return cfg;
}

// Ordnet eine Position einer Sperrgut-Gruppe zu (oder null).
function matchGroup(item, cfg) {
  if (!item || !item.product) return null;
  const cid = item.product.category_id;
  const nm = item.product.name || '';
  for (const c of cfg) {
    if (c.amount > 0 && c.catIds.has(cid) && c.nameIncludes.test(nm)) return c;
  }
  return null;
}

/**
 * @param {Array<{product?:object, qty?:number, lineTotal?:number}>} items
 * @param {{freeThreshold?:number, db?:object}} opts  db wird für die Sperrgut-Regeln benötigt
 *
 * Sperrgut wird JE GRUPPE nur EINMAL berechnet (unabhängig von der Menge):
 * ist mindestens ein Mast im Warenkorb → einmal Mast-Aufschlag; ebenso Trommel.
 * Ein manuell gesetzter products.sperrgut_surcharge > 0 wird je Position einmal
 * addiert (Escape-Hatch für Einzelfälle außerhalb der Regeln).
 */
async function computeShipping(items, opts = {}) {
  const freeThreshold = opts.freeThreshold != null ? opts.freeThreshold : 1500;
  const cfg = opts.db ? await loadSperrgutConfig(opts.db) : [];
  let subtotal = 0;
  const groupsPresent = new Map(); // group -> amount (einmal)
  let manualTotal = 0;
  for (const it of (items || [])) {
    subtotal += it.lineTotal || 0;
    const manual = it.product ? parseFloat(it.product.sperrgut_surcharge) : 0;
    if (manual && manual > 0) { manualTotal += manual; continue; } // manuelle Übersteuerung hat Vorrang
    const g = matchGroup(it, cfg);
    if (g) groupsPresent.set(g.group, g.amount);
  }
  let sperrgut = manualTotal;
  for (const amt of groupsPresent.values()) sperrgut += amt;
  subtotal = parseFloat(subtotal.toFixed(2));
  sperrgut = parseFloat(sperrgut.toFixed(2));
  const packageShipping = subtotal >= freeThreshold ? 0 : FLAT_PACKAGE;
  const total = parseFloat((packageShipping + sperrgut).toFixed(2));
  return { subtotal, packageShipping, sperrgut, total, freeThreshold, hasSperrgut: sperrgut > 0 };
}

module.exports = { computeShipping, FLAT_PACKAGE, loadSperrgutConfig };
