'use strict';

// Sperrgut-Regeln (D1). NUR diese zwei Gruppen erhalten den Versandaufschlag –
// bewusst regelbasiert (Kategorie + Namensbestandteil), damit kleine Teile in
// denselben Kategorien (Klemmen etc.) NICHT betroffen sind.
//
//  - 'mast'    : Kategorie "Elemente der Blitzschutzanlage"        UND Name enthält "Mast"    (SKU R.8302–R.8315)
//  - 'trommel' : Kategorie "Verlängerungskabel und Abzweigsteckdosen" UND Name enthält "Trommel" (B.11xx-Serien)
//
// Der Aufschlagbetrag je Gruppe steht in den Einstellungen (settings), damit er
// ohne Code-Änderung anpassbar ist. 0 = kein Aufschlag.
const RULES = [
  { group: 'mast',    category: 'Elemente der Blitzschutzanlage',           nameIncludes: /mast/i,    amountKey: 'sperrgut_mast_eur' },
  { group: 'trommel', category: 'Verlängerungskabel und Abzweigsteckdosen', nameIncludes: /trommel/i, amountKey: 'sperrgut_trommel_eur' },
];

module.exports = { RULES };
