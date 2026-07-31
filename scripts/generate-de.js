'use strict';
// CSV'deki İngilizce açıklamalı / generic isimli ürünler için Almanca
// isim + açıklama üretir. Çıktı: scripts/de-updates.json  { SKU: {name, short_description, description} }
// Kaynak veriden türetilir (poles/char specs+açıklamadan, amper SKU'dan) — uydurma yok.
const fs = require('fs');
const path = require('path');

function parseCsv(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c === '\r') {} else f += c; } }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const CSV = process.argv[2] || 'C:/Users/alisa/Downloads/import_353.csv';
const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const h = rows[0].map(x => x.trim());
const ci = Object.fromEntries(h.map((x, i) => [x, i]));
const data = rows.slice(1).filter(r => r.length > 3 && (r[ci.sku] || '').trim());

const GENERIC = new Set(['Allgemeines Produkt', 'Leitungsschutzschalter', 'LED-Flutlicht', '']);
const AMP = new Set([2,4,6,10,13,16,20,25,32,40,50,63,80,100,125,160,200,250]);

const spec = (s, k) => { const p = (s || '').split(';').find(x => x.trim().toLowerCase().startsWith(k.toLowerCase())); return p ? p.split(':').slice(1).join(':').trim().replace(/\s+/g, ' ') : ''; };
const ampere = (sku) => { const t = (sku.match(/\d+/g) || []).map(Number).filter(n => AMP.has(n)); return t.length ? Math.max(...t) : null; };
// FI/RCD SKU'da amper+IΔn bitişik olabilir (25100=25A/100mA). ≥4 haneli bloktan son 3 haneyi at.
const rcdAmpere = (sku) => {
  const blk = (sku.match(/\d{4,}/g) || []).map(s => parseInt(s.slice(0, -3))).filter(n => AMP.has(n));
  if (blk.length) return Math.max(...blk);
  return ampere(sku);
};
const polesOf = (desc, specs) => {
  const sp = spec(specs, 'Polzahl (gesamt)').replace(/\D/g, '');
  if (sp) return parseInt(sp);
  const m = desc.match(/(\d)\s*pole/i) || desc.match(/(\d)P\b/i);
  return m ? parseInt(m[1]) : null;
};
const charOf = (desc, specs) => {
  const sc = spec(specs, 'Auslösecharakteristik').replace(/[^A-Z]/gi, '').toUpperCase();
  if (sc) return sc[0];
  const m = desc.match(/([A-Z])\s*char/i);
  return m ? m[1].toUpperCase() : '';
};
const idnMa = (specs) => {
  const v = spec(specs, 'Bemessungsfehlerstrom'); // "0,03 A"
  const m = v.match(/([\d.,]+)/); if (!m) return null;
  const a = parseFloat(m[1].replace(',', '.')); return Math.round(a * 1000);
};
const fTyp = (specs) => spec(specs, 'Fehlerstrom-Typ').split(/\s/)[0] || '';
const nhSize = (specs) => { const v = spec(specs, 'Sicherungs-Baugröße nach IEC 60269'); return v || ''; };

const pol = (n) => n ? `${n}-polig` : '';

// İngilizce açıklamayı Almancaya çeviren sınıflandırıcı. name+desc döndürür.
function build(r) {
  const sku = r[ci.sku].trim();
  const d = (r[ci.description] || '').trim();
  const specs = r[ci.specs] || '';
  const p = polesOf(d, specs), ch = charOf(d, specs);
  const isFI = /residual current/i.test(d);
  const a = isFI ? rcdAmpere(sku) : ampere(sku);
  const idn = idnMa(specs), ft = fTyp(specs);
  const rate = (ch && a) ? `${ch}${a}` : (a ? `${a}A` : '');
  const bits = (...xs) => xs.filter(Boolean).join(', ');

  // 1) RCBO (FI/LS kombiniert)
  if (/residual current circuit breaker/i.test(d)) {
    const name = bits('FI/LS-Schalter (RCBO)', rate || null, pol(p), idn ? `${idn} mA` : null, ft ? `Typ ${ft}` : null);
    return { name, desc: 'Kombischutzschalter (FI/LS, RCBO) – vereint Fehlerstrom- und Leitungsschutz in einem Gerät.' };
  }
  // 2) FI mit Wiedereinschaltautomatik
  if (/auto recloser/i.test(d)) {
    const name = bits('FI-Schutzschalter mit Wiedereinschaltautomatik', pol(p), a ? `${a}A` : null, idn ? `${idn} mA` : null);
    return { name, desc: 'FI-Schutzschalter (RCD) mit automatischer Wiedereinschaltung nach Fehlerabschaltung.' };
  }
  // 3) FI-Schutzschalter (RCD)
  if (/residual current breaker/i.test(d)) {
    const ga = /G\/A/i.test(d) ? 'kurzzeitverzögert (Typ G/A)' : (ft ? `Typ ${ft}` : null);
    const name = bits('FI-Schutzschalter (RCD)', pol(p), a ? `${a}A` : null, idn ? `${idn} mA` : null, ga);
    return { name, desc: 'Fehlerstrom-Schutzschalter (RCD) zum Schutz von Personen vor gefährlichen Fehlerströmen.' };
  }
  // 4) DC-LS für PV
  if (/dc modular circuit breaker/i.test(d)) {
    const name = bits('DC-Leitungsschutzschalter für PV-Anlagen', rate || null, pol(p));
    return { name, desc: 'DC-Leitungsschutzschalter für Photovoltaik-Anlagen – Überstrom- und Kurzschlussschutz im DC-Kreis.' };
  }
  // 5) LS-Schalter (evtl. farbiger Kipphebel)
  if (/modular circuit breaker/i.test(d)) {
    const col = /colored handle/i.test(d) ? 'farbiger Kipphebel' : null;
    const name = bits('Leitungsschutzschalter', rate || null, pol(p), col);
    return { name, desc: 'Leitungsschutzschalter (LS-Schalter) für Überstrom- und Kurzschlussschutz in Elektroinstallationen.' };
  }
  // 6) NH-Sicherung
  if (/nh fuse/i.test(d)) {
    const sz = nhSize(specs); const name = bits('NH-Sicherungseinsatz', sz || null, a ? `${a}A` : null, 'gG');
    return { name, desc: 'NH-Sicherungseinsatz (Niederspannungs-Hochleistungssicherung) für den Kabel- und Leitungsschutz.' };
  }
  // 7) Verteilerschrank
  if (/distribution cabinet/i.test(d)) {
    const extras = [];
    if (/modul panel/i.test(d)) extras.push('mit Modulträger');
    if (/transparent door|transp\. ?door/i.test(d)) extras.push('mit transparenter Tür');
    const name = bits('Kunststoff-Verteilerschrank', extras.length ? extras.join(', ') : null);
    return { name, desc: 'Kunststoff-Verteilerschrank (Aufputz) zur Aufnahme von Reiheneinbaugeräten.' };
  }
  // 8) Überspannungsableiter
  if (/surge arrester/i.test(d)) {
    if (/socket for/i.test(d)) return { name: 'Sockel für Überspannungsableiter-Einsätze (Typ 2)', desc: 'Basissockel zur Aufnahme steckbarer Überspannungsableiter-Einsätze Typ 2.' };
    if (/^t2|type 2|\bt2\b/i.test(d)) return { name: 'Überspannungsableiter Typ 2 (AC) mit wechselbarem Einsatz', desc: 'Überspannungsableiter Typ 2 für den Schutz elektrischer Anlagen; Einsatz austauschbar.' };
    if (/^t3|type 3|\bt3\b/i.test(d)) return { name: 'Überspannungsableiter Typ 3 (AC) für Steckdoseneinbau', desc: 'Überspannungs-Feinschutz Typ 3 für den Einbau nahe empfindlicher Endgeräte.' };
    return { name: 'Überspannungsableiter', desc: 'Überspannungsschutzgerät für elektrische Anlagen.' };
  }
  // 9) Hilfskontakt
  if (/auxiliary contact/i.test(d)) {
    const side = /side/i.test(d) ? 'Seitlicher' : 'Frontseitiger';
    return { name: `${side} Hilfskontakt für Schütze (TR1D/F${/TR1E/i.test(d) ? ', TR1E' : ''})`, desc: 'Hilfskontakt zur Signalisierung/Ansteuerung an Leistungsschützen der Baureihe TR1.' };
  }
  // 10) Endkappe Kammschiene
  if (/end cap for comb bus bar/i.test(d)) return { name: 'Endkappe für Kammschiene (Phasenschiene)', desc: 'Isolierende Endkappe zum Berührungsschutz von Kamm-/Phasenschienen.' };
  // 11) Relais
  if (/time relay|flasher relay|delay off/i.test(d)) {
    if (/multifunction/i.test(d)) return { name: 'Multifunktions-Zeitrelais (10 Funktionen)', desc: 'Multifunktions-Zeitrelais mit zehn wählbaren Zeitfunktionen für Steuerungsaufgaben.' };
    if (/delay on/i.test(d)) return { name: 'Zeitrelais, anzugsverzögert (Delay ON)', desc: 'Einfunktions-Zeitrelais mit Anzugsverzögerung.' };
    if (/delay off/i.test(d)) return { name: 'Zeitrelais, abfallverzögert (Delay OFF)', desc: 'Einfunktions-Zeitrelais mit Abfallverzögerung.' };
    if (/flasher/i.test(d)) return { name: 'Blinkrelais', desc: 'Blinkrelais zur getakteten Ansteuerung von Signalgebern.' };
    return { name: 'Zeitrelais', desc: 'Zeitrelais für Steuerungsaufgaben.' };
  }
  // 12) Aufputz-Programm
  if (/surface type/i.test(d)) {
    const shuko = /shuko/i.test(d) ? ', Schuko' : (/french/i.test(d) ? ', französisch' : '');
    const vert = /vertical/i.test(d) ? ', vertikal' : '';
    if (/socket-outlet\+/i.test(d)) {
      const sw = /changeover/i.test(d) ? 'Wechselschalter' : /two way/i.test(d) ? 'Wechselschalter' : /two pole/i.test(d) ? 'Schalter (zweipolig)' : 'Schalter (einpolig)';
      return { name: `Aufputz-Steckdose + ${sw}${shuko}${vert}`, desc: 'Aufputz-Kombination aus Steckdose und Schalter.' };
    }
    if (/socket-outlet.*usb/i.test(d)) return { name: 'Aufputz-Steckdose (Schuko) mit USB-Anschluss', desc: 'Aufputz-Schuko-Steckdose mit integriertem USB-Ladeanschluss.' };
    if (/pushbutton/i.test(d)) {
      const sign = /bell/i.test(d) ? 'Klingelsymbol' : /wc/i.test(d) ? 'WC-Symbol' : /light sign/i.test(d) ? 'Lichtsymbol' : /with light/i.test(d) ? 'Beleuchtung' : '';
      return { name: `Aufputz-Taster${sign ? ' mit ' + sign : ''}`, desc: 'Aufputz-Taster für Klingel-/Steuerungsanwendungen.' };
    }
    if (/tv and fm|tv.*fm/i.test(d)) return { name: 'Aufputz-Antennendose (TV/UKW)', desc: 'Aufputz-Antennenanschlussdose für TV- und UKW-Signale.' };
    if (/jalousie/i.test(d)) return { name: 'Aufputz-Jalousieschalter', desc: 'Aufputz-Schalter zur Ansteuerung von Jalousien/Rollläden.' };
    const light = /with light/i.test(d) ? ' mit Beleuchtung' : '';
    if (/changeover|two way changeover/i.test(d)) return { name: `Aufputz-Kreuzschalter${light}`, desc: 'Aufputz-Kreuz-/Umschalter für die Elektroinstallation.' };
    if (/two way/i.test(d)) return { name: `Aufputz-Wechselschalter${light}`, desc: 'Aufputz-Wechselschalter für die Elektroinstallation.' };
    if (/two pole/i.test(d)) return { name: `Aufputz-Schalter, zweipolig${light}`, desc: 'Zweipoliger Aufputz-Schalter für die Elektroinstallation.' };
    if (/one pole/i.test(d)) return { name: `Aufputz-Schalter, einpolig${light}`, desc: 'Einpoliger Aufputz-Schalter für die Elektroinstallation.' };
    return { name: 'Aufputz-Schalter', desc: 'Aufputz-Schaltgerät für die Elektroinstallation.' };
  }
  // 13) LED
  if (/led-flutlicht|led flutlicht/i.test(d)) {
    const w = (sku.match(/(\d+)\s*W/i) || [])[1];
    const ms = /motion/i.test(d) ? ' und Bewegungsmelder' : '';
    return { name: bits('LED-Flutlicht', w ? `${w}W` : null, `mit SAMSUNG-Chip${ms}`), desc: 'LED-Fluter mit SAMSUNG-LED-Chip für Außen- und Objektbeleuchtung.' };
  }
  if (/smd led spot/i.test(d)) return { name: 'SMD-LED-Spot (Kunststoffgehäuse)', desc: 'SMD-LED-Leuchtmittel im Kunststoffgehäuse.' };
  // 14) Zählerverteiler
  if (/consumption meter box/i.test(d)) {
    const ph = /^3f|3f /i.test(d) ? '3-phasig' : '1-phasig';
    return { name: `Zählerverteiler ${ph} (für Unterzähler)`, desc: 'Zählerverteilergehäuse zur Aufnahme eines Unterzählers.' };
  }
  // 15) TME Schlösser
  if (/lock for tme|lock for tme plastic/i.test(d)) {
    if (/safety lock/i.test(d)) return { name: 'Sicherheitsschloss für TME-Kunststoffschrank', desc: 'Abschließbares Sicherheitsschloss für Verteilerschränke der Baureihe TME.' };
    return { name: 'Verschluss für TME-Kunststoffschrank (Dreikant)', desc: 'Dreikant-Verschluss für Verteilerschränke der Baureihe TME.' };
  }
  // 16) Gummi
  if (/rubber plug/i.test(d)) return { name: 'Gummi-Stecker mit Schutzkontakt (leicht zu öffnen)', desc: 'Robuster Gummi-Schutzkontaktstecker für den rauen Einsatz.' };
  if (/rubber socket/i.test(d)) return { name: 'Gummi-Kupplung mit Schutzkontakt (leicht zu öffnen)', desc: 'Robuste Gummi-Schutzkontaktkupplung für den rauen Einsatz.' };
  if (/rubber cable entry/i.test(d)) return { name: 'Gummi-Kabeleinführung für TQB2-Abzweigdosen', desc: 'Gummi-Kabeleinführung als Zubehör für Abzweigdosen der Baureihe TQB2.' };
  // 17) CEE Industrie
  if (/industrial plug/i.test(d)) return { name: `CEE-Industriestecker${/high protection/i.test(d) ? ' (hohe Schutzart)' : ' mit Kabelverschraubung'}`, desc: 'CEE-Industriestecker für den gewerblichen/industriellen Einsatz.' };
  if (/industrial socket/i.test(d)) return { name: 'CEE-Industriesteckdose mit Kabelverschraubung', desc: 'CEE-Industriesteckdose für den gewerblichen/industriellen Einsatz.' };
  // 18) Sonstige Einzelteile
  if (/motion sensor adapter/i.test(d)) return { name: 'Bewegungsmelder-Adapter für E27-Fassungen (PIR)', desc: 'PIR-Bewegungsmelder als Adapter für E27-Leuchtmittelfassungen.' };
  if (/n\/pe rail holder/i.test(d)) return { name: 'Kunststoff-Halter für N/PE-Schiene (1 Schiene)', desc: 'Isolierter Halter zur Befestigung einer N/PE-Sammelschiene.' };
  if (/socket-outlet.*usb/i.test(d)) return { name: 'Schuko-Steckdose mit USB-Anschluss', desc: 'Schuko-Steckdose mit integriertem USB-Ladeanschluss.' };
  if (/pir motion sensor/i.test(d)) return { name: 'Aufputz-Bewegungsmelder (PIR), weiß', desc: 'PIR-Bewegungsmelder für die Aufputzmontage zur automatischen Lichtsteuerung.' };
  if (/panel mount socket/i.test(d)) { const t = /french/i.test(d) ? 'französisch' : 'Schuko'; return { name: `Einbausteckdose rund (${t})`, desc: 'Runde Einbausteckdose zur Frontplatten-/Gehäusemontage.' }; }

  return null; // eşleşmedi
}

const out = {};
let matched = 0, kept = 0, unmatched = [];
for (const r of data) {
  const sku = r[ci.sku].trim();
  const curName = (r[ci.name] || '').trim();
  const built = build(r);
  const rec = {};
  if (built) {
    matched++;
    if (GENERIC.has(curName)) rec.name = built.name;      // generic ismi değiştir
    rec.short_description = built.name;                    // kısa açıklama = temiz Almanca isim
    rec.description = built.desc;                          // İngilizce açıklamayı Almanca ile değiştir
  } else {
    // eşleşmedi: en azından İngilizce açıklamayı temizle
    const engRe = /\b(circuit|breaker|modular|pole|characteristic|surface|switch|socket|plug|relay|fuse|holder|cabinet|arrester|contact|meter|lock|rubber|industrial|with|for|and)\b/i;
    if (engRe.test(r[ci.description] || '')) { unmatched.push(sku + ' :: ' + r[ci.description]); }
    else kept++;
  }
  if (Object.keys(rec).length) out[sku] = rec;
}

fs.writeFileSync(path.join(__dirname, 'de-updates.json'), JSON.stringify(out, null, 1));
console.log('Ürün:', data.length, '| eşleşen:', matched, '| çıktı kaydı:', Object.keys(out).length);
console.log('EŞLEŞMEYEN (İngilizce kalan):', unmatched.length);
unmatched.slice(0, 40).forEach(x => console.log('  ', x));
