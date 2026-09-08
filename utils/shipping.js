'use strict';

// Zentrale Versandkosten-Berechnung (D1).
// Bausteine (können sich addieren, jeweils eigene Zeile im Checkout):
//  - Normal-Paket (eigenes Lager, z. B. Onka/Tork): Pauschale 7,90 € netto,
//    entfällt ab Frei-Schwelle (1500 € netto). NUR wenn Eigenlager-Ware im Korb ist.
//  - Sperrgut (Mast/Trommel): fixer Aufschlag JE GRUPPE einmal, IMMER berechnet,
//    unabhängig von der Frei-Schwelle (eigener Speditionskanal).
//  - Pawbol-Partnerversand: Direktversand ab Werk (PL), gewichtsbasiert nach
//    GESAMT-Pawbol-Gewicht der NICHT-Sperrgut-Pawbol-Artikel:
//    ≤25kg=24€, ≤30kg=25,50€, ≤40kg=30€, >40kg oder Gewicht unbekannt = auf Anfrage.
//  - Tracon/Karlik: Partnerversand ohne Tarif → auf Anfrage.
// Auf-Anfrage-Beträge fließen NICHT in die Summe; sie werden separat mitgeteilt.
const cache = require('./cache');
const { RULES } = require('../config/sperrgut');

const FLAT_PACKAGE = 7.90;
const PARTNER_SLUGS = ['pawbol', 'tracon', 'karlik'];
// Pawbol-Gewichtsstaffel: [max_kg, preis]; oberste Grenze überschritten → auf Anfrage.
const PAWBOL_TARIFF = [[25, 24], [30, 25.5], [40, 30]];

// Regeln + Marken-IDs auflösen (gecacht, 120s).
async function loadShippingConfig(db) {
  let cfg = cache.get('shipping_cfg');
  if (cfg) return cfg;
  const sperrgut = [];
  const brandIds = {};
  try {
    for (const r of RULES) {
      const cats = await db.prepare('SELECT id FROM categories WHERE name=?').all(r.category);
      const amtRow = await db.prepare('SELECT value FROM settings WHERE key=?').get(r.amountKey);
      sperrgut.push({
        group: r.group,
        catIds: new Set(cats.map(c => c.id)),
        nameIncludes: r.nameIncludes,
        amount: parseFloat(amtRow && amtRow.value) || 0,
      });
    }
    for (const slug of PARTNER_SLUGS) {
      const b = await db.prepare('SELECT id FROM brands WHERE slug=?').get(slug);
      brandIds[slug] = b ? b.id : null;
    }
  } catch (_) { /* Schema noch nicht bereit → leere Defaults */ }
  cfg = { sperrgut, brandIds };
  cache.set('shipping_cfg', cfg, 120_000);
  return cfg;
}

// Ordnet eine Position einer Sperrgut-Gruppe zu (oder null).
function matchGroup(item, sperrgut) {
  if (!item || !item.product) return null;
  const cid = item.product.category_id;
  const nm = item.product.name || '';
  for (const c of sperrgut) {
    if (c.amount > 0 && c.catIds.has(cid) && c.nameIncludes.test(nm)) return c;
  }
  return null;
}

function pawbolTariff(kg) {
  for (const [max, price] of PAWBOL_TARIFF) if (kg <= max) return price;
  return null; // > oberste Grenze → auf Anfrage
}

/**
 * @param {Array<{product?:object, qty?:number, lineTotal?:number}>} items
 * @param {{freeThreshold?:number, db?:object}} opts  db für Regeln/Marken nötig
 */
async function computeShipping(items, opts = {}) {
  const freeThreshold = opts.freeThreshold != null ? opts.freeThreshold : 1500;
  const { sperrgut: sperrgutCfg, brandIds } = opts.db
    ? await loadShippingConfig(opts.db)
    : { sperrgut: [], brandIds: {} };

  let subtotal = 0;
  let ownStockPresent = false;         // Eigenlager-Ware (nicht Partner) im Korb?
  const groupsPresent = new Map();     // Sperrgut-Gruppe -> Betrag (einmal)
  let manualTotal = 0;
  let pawbolParcelItems = 0;           // Pawbol-Positionen, die NICHT Sperrgut sind
  let pawbolWeight = 0;                 // deren Gesamtgewicht (kg)
  let pawbolWeightKnown = true;        // sind alle Gewichte vorhanden?
  const manualBrands = new Set();      // Tracon/Karlik → auf Anfrage

  for (const it of (items || [])) {
    const qty = it.qty || 1;
    subtotal += it.lineTotal || 0;
    const p = it.product || {};
    const brand = p.brand_id;
    const isPawbol = brandIds.pawbol && brand === brandIds.pawbol;
    const isTracon = brandIds.tracon && brand === brandIds.tracon;
    const isKarlik = brandIds.karlik && brand === brandIds.karlik;
    const isPartner = isPawbol || isTracon || isKarlik;
    if (!isPartner) ownStockPresent = true;
    if (isTracon) manualBrands.add('Tracon');
    if (isKarlik) manualBrands.add('Karlik');

    // Sperrgut (Mast/Trommel) bzw. manuelle Übersteuerung → eigener Kanal
    const manual = parseFloat(p.sperrgut_surcharge);
    if (manual && manual > 0) { manualTotal += manual; continue; }
    const g = matchGroup(it, sperrgutCfg);
    if (g) { groupsPresent.set(g.group, g.amount); continue; }

    // Pawbol-Paketware (nicht Sperrgut) → Gewicht für Staffel sammeln
    if (isPawbol) {
      pawbolParcelItems += 1;
      const w = parseFloat(p.weight_kg);
      if (w > 0) pawbolWeight += w * qty;
      else pawbolWeightKnown = false;
    }
  }

  // Sperrgut
  let sperrgut = manualTotal;
  for (const amt of groupsPresent.values()) sperrgut += amt;
  sperrgut = parseFloat(sperrgut.toFixed(2));

  // Normal-Paket nur bei Eigenlager-Ware
  const packageShipping = ownStockPresent ? (subtotal >= freeThreshold ? 0 : FLAT_PACKAGE) : 0;

  // Pawbol-Partnerversand (gewichtsbasiert)
  let pawbolShipping = 0;
  let pawbolAufAnfrage = false;
  if (pawbolParcelItems > 0) {
    pawbolWeight = parseFloat(pawbolWeight.toFixed(3));
    if (!pawbolWeightKnown || pawbolWeight <= 0) {
      pawbolAufAnfrage = true; // Gewicht unbekannt → nicht automatisch berechenbar
    } else {
      const t = pawbolTariff(pawbolWeight);
      if (t == null) pawbolAufAnfrage = true; // > 40 kg
      else pawbolShipping = t;
    }
  }

  subtotal = parseFloat(subtotal.toFixed(2));
  const numericTotal = parseFloat((packageShipping + sperrgut + pawbolShipping).toFixed(2));
  const partnerManualBrands = Array.from(manualBrands);
  const aufAnfrage = pawbolAufAnfrage || partnerManualBrands.length > 0;

  return {
    subtotal,
    packageShipping,
    sperrgut,
    pawbolShipping,
    pawbolAufAnfrage,
    pawbolWeight,
    partnerManualBrands,
    aufAnfrage,
    total: numericTotal,
    freeThreshold,
    hasSperrgut: sperrgut > 0,
  };
}

module.exports = { computeShipping, FLAT_PACKAGE, loadShippingConfig };
