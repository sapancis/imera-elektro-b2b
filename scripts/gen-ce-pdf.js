const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '../public/files');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const doc = new PDFDocument({ margin: 60, size: 'A4' });
doc.pipe(fs.createWriteStream(path.join(outDir, 'CE-Konformitaetserklaerung.pdf')));

const black = '#1D1D1F';
const gray  = '#6B7280';
const euBlue = '#003399';
const border = '#E8E8ED';

// EU Sterne
doc.fontSize(22).fillColor(euBlue).text('★  ★  ★  ★  ★  ★  ★', { align: 'center' });
doc.moveDown(0.5);

// Titel
doc.fontSize(20).font('Helvetica-Bold').fillColor(black).text('EU-KONFORMITÄTSERKLÄRUNG', { align: 'center' });
doc.fontSize(11).font('Helvetica').fillColor(gray).text('EU Declaration of Conformity', { align: 'center' });
doc.moveDown(0.8);

// Linie
doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor(euBlue).lineWidth(2).stroke();
doc.moveDown(0.8);

// Aussteller
doc.fontSize(9).fillColor(gray).text('Aussteller / Issuer:');
doc.fontSize(13).font('Helvetica-Bold').fillColor(black).text('Imera Elektro');
doc.fontSize(9).font('Helvetica').fillColor(gray).text('Oesterreich / Austria  ·  info@imeragroup.com');
doc.moveDown(0.8);

// Hersteller 1
doc.fontSize(9).fillColor(gray).text('Hersteller 1 / Manufacturer 1:');
doc.fontSize(11).font('Helvetica-Bold').fillColor(black).text('ONKA Elektrik Malzemeleri San. ve Tic. A.S.');
doc.fontSize(9).font('Helvetica').fillColor(gray).text('Tuerkei / Turkey');
doc.moveDown(0.5);

// Hersteller 2
doc.fontSize(9).fillColor(gray).text('Hersteller 2 / Manufacturer 2:');
doc.fontSize(11).font('Helvetica-Bold').fillColor(black).text('TORK Elektrik Malzemeleri');
doc.fontSize(9).font('Helvetica').fillColor(gray).text('Tuerkei / Turkey');
doc.moveDown(0.8);

// Trennlinie
doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor(border).lineWidth(1).stroke();
doc.moveDown(0.5);

// Produktkategorien
doc.fontSize(11).font('Helvetica-Bold').fillColor(black).text('Betroffene Produktkategorien / Product Categories:');
doc.moveDown(0.3);

const products = [
  ['Kabelbinder (Cable Ties)', 'PA 6.6 UV-bestaendig / UV-resistant', 'EN 61914'],
  ['Kabelverschraubungen (Cable Glands)', 'Polyamid PA66, IP68', 'EN 50262'],
  ['Reihenklemmen (Terminal Blocks)', 'Push-in Anschluss, 2,5-6mm2', 'IEC 60947-7-1'],
  ['DIN-Schienen (DIN Rails)', 'Stahl galvanisiert / Galvanized steel', 'EN 60715'],
];

for (const prod of products) {
  doc.fontSize(10).font('Helvetica-Bold').fillColor(black).text('  ' + prod[0]);
  doc.fontSize(9).font('Helvetica').fillColor(gray).text('    Material: ' + prod[1] + '   Norm: ' + prod[2]);
  doc.moveDown(0.2);
}
doc.moveDown(0.5);

// Richtlinien
doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor(border).lineWidth(1).stroke();
doc.moveDown(0.5);
doc.fontSize(11).font('Helvetica-Bold').fillColor(black).text('Angewandte Richtlinien / Applied Directives:');
doc.moveDown(0.3);

const directives = [
  'Niederspannungsrichtlinie 2014/35/EU (Low Voltage Directive)',
  'EMV-Richtlinie 2014/30/EU (EMC Directive)',
  'RoHS-Richtlinie 2011/65/EU (RoHS Directive)',
];
for (const d of directives) {
  doc.fontSize(9).font('Helvetica').fillColor(gray).text('  v  ' + d);
}
doc.moveDown(1);

// CE Box
const boxY = doc.y;
doc.rect(60, boxY, 515, 44).fill(euBlue);
doc.fontSize(28).font('Helvetica-Bold').fillColor('white').text('CE', 60, boxY + 7, { width: 515, align: 'center' });
doc.moveDown(0.8);

doc.fontSize(8).font('Helvetica').fillColor(gray)
  .text('Dieses Dokument bestaetigt die Uebereinstimmung der oben genannten Produkte mit den anwendbaren europaeischen Richtlinien und Normen.', { align: 'center', width: 515 });
doc.moveDown(1);

// Unterschrift Bereich
doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor(border).lineWidth(1).stroke();
doc.moveDown(0.5);
doc.fontSize(9).font('Helvetica').fillColor(gray)
  .text('Datum / Date: ' + new Date().toLocaleDateString('de-AT') + '     Dok.-Nr. / Doc. No.: IE-CE-2025-001');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica-Bold').fillColor(black).text('Imera Elektro');
doc.fontSize(9).font('Helvetica').fillColor(gray).text('Geschaeftsfuehrung / Management');

doc.end();
doc.on('end', () => console.log('CE-Konformitaetserklaerung.pdf erstellt.'));
