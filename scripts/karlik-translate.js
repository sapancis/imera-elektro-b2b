'use strict';
// Karlik-Produktnamen Englisch → Deutsch (glossarbasiert).
// Reihenfolge wichtig: längere/spezifische Phrasen ZUERST.

const RULES = [
  // ── 0) Spezifische Voll-Phrasen ZUERST ──────────────────────────
  [/Electronic dimmer push-rotary mechanism for use with 1-10V voltage-controlled power supply unit/gi, 'Elektronischer Dreh-/Tastdimmer-Mechanismus für 1-10V spannungsgesteuerte Netzteile'],
  [/Elektronischer Dreh-\/Tastdimmer-Mechanismus for LED lamps/gi, 'Elektronischer Dreh-/Tastdimmer-Mechanismus für LED-Lampen'],
  [/Elektronische Steuerung Rollladen shutter mechnism/gi, 'Elektronische Rollladensteuerung (Mechanismus)'],
  [/Elektronische Steuerung Rollladen shutter/gi, 'Elektronische Rollladensteuerung'],
  [/Non-standard flush-mounted modular junction box/gi, 'Unterputz-Modul-Verbindungsdose (Sondermaß)'],
  [/Non-standard modular glass effect frame/gi, 'Modularrahmen Glasoptik (Sondermaß)'],
  [/DATA single socket with the 2P\+Z DATA earth mechanism, without key/gi, 'DATA-Einzelsteckdose mit DATA-Erdungsmechanismus (2P+Z), ohne Schlüssel'],
  [/DATA single socket with the 2P\+Z DATA earth, with key/gi, 'DATA-Einzelsteckdose mit DATA-Erdung (2P+Z), mit Schlüssel'],
  [/DECO single surface mounted box/gi, 'DECO Aufputzgehäuse, 1-fach'],
  [/Single surface mounted box for multiple frames/gi, 'Aufputzgehäuse für Mehrfachrahmen'],
  [/Double mounting box for a central vacuum cleaner suction socket with a single socket with earth/gi, 'Doppel-Montagedose für Zentralstaubsauger-Anschlussdose mit Einzelsteckdose mit Erdung'],
  [/Single mounting box for a central vacuum cleaner suction socket/gi, 'Einzel-Montagedose für Zentralstaubsauger-Anschlussdose'],
  [/Central vac[uu]*m cleaner suction socket with a single socket with earth/gi, 'Zentralstaubsauger-Anschlussdose mit Einzelsteckdose mit Erdung'],
  [/Central vac[uu]*m cleaner suction socket/gi, 'Zentralstaubsauger-Anschlussdose'],

  // Element/Modul in Anführungszeichen → deutsche „ "
  [/"([A-Z])"\s*element/gi, '„$1"-Element'],
  [/"([A-Z])"\s*module/gi, '„$1"-Modul'],

  // Hintergrundbeleuchtung / Beleuchtung (vor Farben!)
  [/white backlight/gi, 'weiße Hintergrundbeleuchtung'],
  [/blue backlight/gi, 'blaue Hintergrundbeleuchtung'],
  [/\bbacklight\b/gi, 'Hintergrundbeleuchtung'],
  [/with illumination/gi, 'mit Beleuchtung'],

  // Abdeckungen (vor Farben, da "white cover" sonst zu "weiß cover" wird)
  [/shaded transparent cover/gi, 'getönte transparente Abdeckung'],
  [/transparent cover/gi, 'transparente Abdeckung'],
  [/white cover/gi, 'weiße Abdeckung'],
  [/beige cover/gi, 'beige Abdeckung'],

  // "two push buttons" vor generischem "push button"
  [/two push ?buttons/gi, 'zwei Taster'],

  // ── Rahmen-Serie (dominante Gruppe) ─────────────────────────────
  [/(\d+)-gang/gi, '$1-fach'],
  [/round universal frame/gi, 'runder Universalrahmen'],
  [/square universal frame/gi, 'quadratischer Universalrahmen'],
  [/universal frame round/gi, 'Universalrahmen rund'],
  [/universal frame square/gi, 'Universalrahmen quadratisch'],
  [/universal frame with rounded edges/gi, 'Universalrahmen mit abgerundeten Kanten'],
  [/universal frame/gi, 'Universalrahmen'],
  [/with rounded edges/gi, 'mit abgerundeten Kanten'],
  [/modular glass effect frame/gi, 'Modularrahmen Glasoptik'],
  [/Non-standard flush-mounted modular junction box/gi, 'Unterputz-Modul-Verbindungsdose (Sondermaß)'],
  [/Non-standard modular glass effect frame/gi, 'Modularrahmen Glasoptik (Sondermaß)'],
  [/flush-mounted modular junction box/gi, 'Unterputz-Modul-Verbindungsdose'],
  [/(\d+)\s*bays/gi, '$1 Module'],
  [/1\s*module\b/gi, '1 Modul'],
  [/horizontal/gi, 'horizontal'],
  [/vertical/gi, 'vertikal'],

  // Materialien
  [/brushed aluminum/gi, 'gebürstetes Aluminium'],
  [/glass effect/gi, 'Glasoptik'],
  [/wood effect/gi, 'Holzoptik'],
  [/\bglass\b/gi, 'Glas'],
  [/\bwood\b/gi, 'Holz'],
  [/\bconcrete\b/gi, 'Beton'],

  // Rahmen-/Rückseiten-Angaben + Farben
  [/frame:/gi, 'Rahmen:'],
  [/rear:/gi, 'Rückseite:'],
  [/american nut/gi, 'amerikanischer Nussbaum'],
  [/light grey/gi, 'hellgrau'],
  [/graphite matt/gi, 'Graphit matt'],
  [/\bgraphite\b/gi, 'Graphit'],
  [/\bwenge\b/gi, 'Wenge'],
  [/\boak\b/gi, 'Eiche'],
  [/\bsilver\b/gi, 'Silber'],
  [/\bwhite\b/gi, 'weiß'],
  [/\bblack\b/gi, 'schwarz'],
  [/\bbeige\b/gi, 'beige'],
  [/\borange\b/gi, 'orange'],
  [/\bred\b/gi, 'rot'],

  // ── Schalter / Taster ───────────────────────────────────────────
  [/Single pole with two-way switch with illumination/gi, 'Ausschalter mit Wechselschalter, beleuchtet'],
  [/Single pole with two-way switch/gi, 'Ausschalter mit Wechselschalter'],
  [/Single pole switch/gi, 'Ausschalter'],
  [/Two-circuit switch/gi, 'Serienschalter'],
  [/Two-circuit push button/gi, 'Serientaster'],
  [/Two-way switch/gi, 'Wechselschalter'],
  [/cross switch/gi, 'Kreuzschalter'],
  [/Double hotel switch/gi, 'Doppel-Hotelschalter'],
  [/Hotel switch/gi, 'Hotelschalter'],
  [/Double push button switch/gi, 'Doppeltaster'],
  [/push button switch/gi, 'Taster'],
  [/Double push button/gi, 'Doppeltaster'],
  [/Single push button/gi, 'Einzeltaster'],
  [/push button/gi, 'Taster'],
  [/push-rotary/gi, 'Dreh-/Tast-'],

  // ── Steckdosen ──────────────────────────────────────────────────
  [/Splash-proof socket/gi, 'Spritzwassergeschützte Steckdose'],
  [/Triple socket/gi, 'Dreifach-Steckdose'],
  [/Double socket/gi, 'Doppelsteckdose'],
  [/single socket/gi, 'Einzelsteckdose'],
  [/Single socket/gi, 'Einzelsteckdose'],
  [/with the 2P\+Z earth SCHUKO/gi, 'mit Erdung (2P+Z), SCHUKO'],
  [/with the 2P\+Z earth/gi, 'mit Erdung (2P+Z)'],
  [/with the 2x\(2P\+Z\) earth/gi, 'mit Erdung (2×2P+Z)'],
  [/with the 3x\(2P\+Z\) earth/gi, 'mit Erdung (3×2P+Z)'],
  [/with single socket with earth/gi, 'mit Einzelsteckdose mit Erdung'],
  [/with earth\b/gi, 'mit Erdung'],
  [/with a single socket with earth/gi, 'mit Einzelsteckdose mit Erdung'],

  // Abdeckungen / Schutz
  [/with increased contact protection\/shutter/gi, 'mit erhöhtem Berührungsschutz'],
  [/without increased contact protection\/shutter/gi, 'ohne erhöhten Berührungsschutz'],
  [/shaded transparent cover/gi, 'getönte transparente Abdeckung'],
  [/transparent cover/gi, 'transparente Abdeckung'],
  [/white cover/gi, 'weiße Abdeckung'],
  [/beige cover/gi, 'beige Abdeckung'],
  [/without metal claws/gi, 'ohne Metallkrallen'],
  [/Czech and Slovak version/gi, 'tschechischer und slowakischer Ausführung'],
  [/\bcwith\b/gi, 'with'],

  // ── Daten / Multimedia ──────────────────────────────────────────
  [/Double computer socket/gi, 'Doppel-Datensteckdose'],
  [/Single computer socket/gi, 'Einzel-Datensteckdose'],
  [/computer socket/gi, 'Datensteckdose'],
  [/Double telephone socket/gi, 'Doppel-Telefonsteckdose'],
  [/Single telephone socket/gi, 'Einzel-Telefonsteckdose'],
  [/telephone socket/gi, 'Telefonsteckdose'],
  [/Double antenna F type socket \(SAT\)/gi, 'Doppel-Antennensteckdose Typ F (SAT)'],
  [/Single antenna F type socket \(SAT\)/gi, 'Einzel-Antennensteckdose Typ F (SAT)'],
  [/antenna F type socket \(SAT\)/gi, 'Antennensteckdose Typ F (SAT)'],
  [/Double loudspeaker socket/gi, 'Doppel-Lautsprecheranschluss'],
  [/Single loudspeaker socket/gi, 'Einzel-Lautsprecheranschluss'],
  [/loudspeaker socket/gi, 'Lautsprecheranschluss'],
  [/banana type/gi, 'Bananentyp'],
  [/Radio\/Tv\/SAT through socket/gi, 'Radio/TV/SAT-Durchgangssteckdose'],
  [/Radio\/Tv through socket/gi, 'Radio/TV-Durchgangssteckdose'],
  [/4K HDMI 2\.0 single socket/gi, '4K-HDMI-2.0-Einzelsteckdose'],
  [/Single USB charger/gi, 'Einzel-USB-Ladegerät'],
  [/USB charger/gi, 'USB-Ladegerät'],
  [/(\d+)-contact/gi, '$1-polig'],
  [/\bscreened\b/gi, 'geschirmt'],
  [/tool-less/gi, 'werkzeuglos'],
  [/gold-plated|glod-plated/gi, 'vergoldet'],
  [/\bcat\. /gi, 'Kat. '],

  // ── Staubsauger / Montage ───────────────────────────────────────
  [/Double mounting box for a central vacuum cleaner suction socket/gi, 'Doppel-Montagedose für Zentralstaubsauger-Anschlussdose'],
  [/Single mounting box for a central vacuum cleaner suction socket/gi, 'Einzel-Montagedose für Zentralstaubsauger-Anschlussdose'],
  [/Central vac[uu]*m cleaner suction socket with a single socket with earth/gi, 'Zentralstaubsauger-Anschlussdose mit Einzelsteckdose mit Erdung'],
  [/Central vac[uu]*m cleaner suction socket/gi, 'Zentralstaubsauger-Anschlussdose'],
  [/mounting box/gi, 'Montagedose'],

  // ── Dimmer / Regler / Rollladen ────────────────────────────────
  [/Electronic dimmer push-rotary mechanism for use with 1-10V voltage-controlled power supply unit/gi, 'Elektronischer Dreh-/Tastdimmer-Mechanismus für 1-10V spannungsgesteuerte Netzteile'],
  [/Electronic temperature controller with underfloor sensor/gi, 'Elektronischer Temperaturregler mit Fußbodensensor'],
  [/Electronic temperature regulator with air sensor/gi, 'Elektronischer Temperaturregler mit Luftsensor'],
  [/Elektronische Steuerung Rollladen shutter mechnism/gi, 'Elektronische Rollladensteuerung (Mechanismus)'],
  [/Elektronische Steuerung Rollladen shutter/gi, 'Elektronische Rollladensteuerung'],
  [/for LED lamps/gi, 'für LED-Lampen'],
  [/for use with/gi, 'für'],

  // ── Rahmen DECO / MINI / Aufputz ───────────────────────────────
  [/DECO single surface mounted box/gi, 'DECO Aufputzgehäuse, 1-fach'],
  [/Single surface mounted box for multiple frames/gi, 'Aufputzgehäuse für Mehrfachrahmen'],
  [/surface mounted box/gi, 'Aufputzgehäuse'],
  [/with a single universal plastic DECO Soft frame/gi, 'mit Universal-Kunststoffrahmen DECO Soft, 1-fach'],
  [/with a single universal plastic DECO frame/gi, 'mit Universal-Kunststoffrahmen DECO, 1-fach'],

  // ── DATA ────────────────────────────────────────────────────────
  [/DATA single socket with the 2P\+Z DATA earth mechanism, without key/gi, 'DATA-Einzelsteckdose mit DATA-Erdungsmechanismus (2P+Z), ohne Schlüssel'],
  [/DATA single socket with the 2P\+Z DATA earth, with key/gi, 'DATA-Einzelsteckdose mit DATA-Erdung (2P+Z), mit Schlüssel'],
  [/with key\b/gi, 'mit Schlüssel'],
  [/without key\b/gi, 'ohne Schlüssel'],

  // ── allgemeine Wörter / Reste ──────────────────────────────────
  [/(two pushbuttons|two push buttons)/gi, 'zwei Taster'],
  [/without pictograms|without piktograms|without pictogram/gi, 'ohne Piktogramme'],
  [/separate power supply/gi, 'getrennte Stromversorgung'],
  [/common power supply/gi, 'gemeinsame Stromversorgung'],
  [/with illumination/gi, 'mit Beleuchtung'],
  [/blue backlight/gi, 'blaue Hintergrundbeleuchtung'],
  [/white backlight/gi, 'weiße Hintergrundbeleuchtung'],
  [/voltage-controlled power supply unit/gi, 'spannungsgesteuerte Netzteile'],
  [/power supply unit/gi, 'Netzteil'],
  [/\s+mechanism\b/gi, '-Mechanismus'],
  [/\bmechanism\b/gi, 'Mechanismus'],
  [/\bred and black\b/gi, 'rot und schwarz'],
  [/\bwith a\b/gi, 'mit'],
  [/\bwith the\b/gi, 'mit'],
  [/\bwith\b/gi, 'mit'],
  [/\bwithout\b/gi, 'ohne'],
  [/\bfor a\b/gi, 'für'],
  [/\bfor\b/gi, 'für'],
  [/\band\b/gi, 'und'],
  [/\btwo\b/gi, 'zwei'],
  [/Non-standard/gi, 'Sondermaß'],
  [/\bthe\b/gi, ''],
  [/\bsingle\b/gi, 'Einzel-'],
  [/\bdouble\b/gi, 'Doppel-'],
  [/\btriple\b/gi, 'Dreifach-'],
  [/\btwisted\b/gi, 'verdrillt'],
  [/increased contact protection/gi, 'erhöhter Berührungsschutz'],
];

function translate(name) {
  let s = name;
  for (const [re, to] of RULES) s = s.replace(re, to);
  // Aufräumen: doppelte Leerzeichen, Leerzeichen vor Satzzeichen, "- " Reste
  s = s.replace(/\bcmit\b/g, 'mit')
       .replace(/\)-Mechanismus\b/g, ') (Mechanismus)')
       .replace(/Bananentyp-\s*/g, 'Bananentyp, ')
       .replace(/Universalrahmen\s*[-–]\s*/g, 'Universalrahmen – ')
       .replace(/\s{2,}/g, ' ')
       .replace(/\s+([;,)])/g, '$1')
       .replace(/\(\s+/g, '(')
       .replace(/\s+-\s+-/g, ' –')
       .replace(/\s+-\s+/g, ' – ')
       .replace(/^\s*[–-]\s*/, '')
       .replace(/\s{2,}/g, ' ')
       .trim();
  return s;
}

module.exports = { translate };

// Dry-run: node scripts/karlik-translate.js
if (require.main === module) {
  const db = require('../database/db');
  const enWords = /\b(box|surface|mounted|single|multiple|frame|module|element|switch|socket|cover|with|for|and|the|double|triple|flush|button|blind|dimmer|sensor|holder|plate|mechanism|outlet|earth|shutter|bell|light|two-way|cross|push)\b/i;
  (async () => {
    const kar = await db.prepare("SELECT p.sku, p.name FROM products p JOIN brands b ON p.brand_id=b.id WHERE b.slug='karlik'").all();
    const en = kar.filter(p => enWords.test(p.name || ''));
    const write = process.argv.includes('--write');
    const out = {};
    const seen = new Set();
    for (const p of en) {
      const de = translate(p.name);
      if (p.sku) out[p.sku] = de;
      if (!write && !seen.has(p.name)) { seen.add(p.name); console.log('EN: ' + p.name + '\nDE: ' + de + '\n'); }
    }
    if (write) {
      require('fs').writeFileSync('scripts/karlik-names-de.json', JSON.stringify(out, null, 0), 'utf8');
      console.log('geschrieben: scripts/karlik-names-de.json,', Object.keys(out).length, 'SKUs');
    } else {
      console.log('Benzersiz:', seen.size, '| Ürün:', en.length);
    }
    process.exit(0);
  })();
}
