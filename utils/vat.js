/**
 * Imera Elektro — USt./MwSt. (KDV) Hilfsfunktionen
 * Imera unterliegt der Regelbesteuerung: 20% MwSt. (Österreich).
 * Bestellungen werden netto in der DB gespeichert (order.total = netto);
 * Steuer- und Bruttobeträge werden überall hieraus abgeleitet.
 */
const VAT_RATE = 0.20;

function vatAmount(net) {
  return typeof net === 'number' ? parseFloat((net * VAT_RATE).toFixed(2)) : 0;
}

function grossAmount(net) {
  return typeof net === 'number' ? parseFloat((net + vatAmount(net)).toFixed(2)) : net;
}

module.exports = { VAT_RATE, vatAmount, grossAmount };
