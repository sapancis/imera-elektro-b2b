const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const db = require('../database/db');
const { requireAuth, flash } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
    const orders = await db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 5').all(req.session.userId);
    const coupons = await db.prepare('SELECT * FROM coupons WHERE user_id=? ORDER BY created_at DESC').all(req.session.userId);
    res.render('account/dashboard', { title: 'Mein Konto', user, orders, coupons });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.get('/bestellungen', requireAuth, async (req, res) => {
  try {
    const orders = await db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC').all(req.session.userId);
    for (const o of orders) {
      o.items = await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
    }
    res.render('account/orders', { title: 'Meine Bestellungen', orders });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.get('/bestellungen/:number', requireAuth, async (req, res) => {
  try {
    const order = await db.prepare('SELECT * FROM orders WHERE order_number=? AND user_id=?').get(req.params.number, req.session.userId);
    if (!order) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Bestellung nicht gefunden.', code: 404 });
    const items = await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
    res.render('account/order-detail', { title: `Bestellung ${order.order_number}`, order, items });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// "Erneut bestellen" — tüm kalemleri sepete ekle
router.post('/bestellungen/:number/erneut', requireAuth, async (req, res) => {
  try {
    const order = await db.prepare('SELECT * FROM orders WHERE order_number=? AND user_id=?').get(req.params.number, req.session.userId);
    if (!order) return res.redirect('/konto/bestellungen');

    const items = await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
    if (!req.session.cart) req.session.cart = {};

    let added = 0;
    for (const item of items) {
      if (!item.product_id) continue;
      const product = await db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(item.product_id);
      if (!product) continue;
      const current = req.session.cart[item.product_id] || 0;
      req.session.cart[item.product_id] = current + item.quantity;
      added++;
    }

    flash(req, added > 0 ? 'success' : 'error',
      added > 0 ? `${added} Produkt(e) wurden in den Warenkorb gelegt.` : 'Produkte nicht mehr verfügbar.');
    res.redirect('/warenkorb');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// PDF Rechnung Download
router.get('/bestellungen/:number/rechnung.pdf', requireAuth, async (req, res) => {
  try {
    const order = await db.prepare('SELECT * FROM orders WHERE order_number=? AND user_id=?').get(req.params.number, req.session.userId);
    if (!order) return res.status(404).send('Nicht gefunden');
    const items = await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
    const user  = await db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
    const settingsRows = await db.prepare('SELECT key,value FROM settings').all();
    const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Rechnung-${order.order_number}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // Farbe
    const green  = '#34C759';
    const black  = '#1D1D1F';
    const gray   = '#6B7280';
    const border = '#E8E8ED';

    // ── Header ──────────────────────────────────────────────────────
    doc.fontSize(22).fillColor(black).font('Helvetica-Bold').text('IMERA ELEKTRO', 50, 50);
    doc.fontSize(9).font('Helvetica').fillColor(gray)
      .text(settings.contact_email || 'info@imeragroup.com', 50, 78)
      .text(settings.contact_phone || '+43 660 8514467', 50, 91)
      .text(settings.contact_website || 'www.imeragroup.com', 50, 104);

    // Rechnung-Nummer rechts oben
    doc.fontSize(20).font('Helvetica-Bold').fillColor(green)
      .text('RECHNUNG', 350, 50, { align: 'right', width: 195 });
    doc.fontSize(9).font('Helvetica').fillColor(gray)
      .text(`Nr.: ${order.order_number}`, 350, 80, { align: 'right', width: 195 })
      .text(`Datum: ${new Date(order.created_at).toLocaleDateString('de-AT')}`, 350, 93, { align: 'right', width: 195 });

    // Trennlinie
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(border).lineWidth(1).stroke();

    // ── Empfänger ────────────────────────────────────────────────────
    doc.fontSize(8).fillColor(gray).text('RECHNUNGSEMPFÄNGER', 50, 140);
    doc.fontSize(10).fillColor(black).font('Helvetica-Bold').text(user.name || user.email, 50, 154);
    if (user.company) doc.font('Helvetica').text(user.company, 50, 168);
    const addrY = user.company ? 181 : 168;
    if (order.shipping_address) {
      doc.font('Helvetica').fontSize(9).fillColor(gray).text(order.shipping_address, 50, addrY, { lineGap: 2 });
    }

    // Zahlungsmethode rechts
    doc.fontSize(8).fillColor(gray).text('ZAHLUNGSMETHODE', 350, 140, { width: 195, align: 'right' });
    const pmLabel = order.payment_method === 'transfer' ? 'Überweisung' : 'Auf Rechnung';
    doc.fontSize(10).fillColor(black).font('Helvetica-Bold').text(pmLabel, 350, 154, { width: 195, align: 'right' });
    const statusLabel = { pending: 'Offen', processing: 'In Bearbeitung', shipped: 'Versandt', delivered: 'Geliefert', cancelled: 'Storniert' }[order.status] || order.status;
    doc.fontSize(9).font('Helvetica').fillColor(gray).text(`Status: ${statusLabel}`, 350, 168, { width: 195, align: 'right' });

    // ── Tabelle Header ───────────────────────────────────────────────
    const tableTop = 250;
    const colPos  = [50, 270, 360, 430, 490];

    doc.rect(50, tableTop, 495, 22).fill('#F5F5F7');
    doc.fontSize(9).font('Helvetica-Bold').fillColor(black);
    doc.text('BESCHREIBUNG', colPos[0]+5, tableTop+6);
    doc.text('ART.-NR.', colPos[1],    tableTop+6);
    doc.text('MENGE', colPos[2],       tableTop+6, { width: 60, align: 'right' });
    doc.text('PREIS/STK', colPos[3],   tableTop+6, { width: 55, align: 'right' });
    doc.text('GESAMT', colPos[4],      tableTop+6, { width: 55, align: 'right' });

    // ── Tablo satırları ──────────────────────────────────────────────
    let y = tableTop + 28;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowH = 26;
      if (i % 2 === 1) doc.rect(50, y-4, 495, rowH).fill('#FAFAFA');

      doc.fontSize(9).font('Helvetica').fillColor(black);
      doc.text(item.product_name, colPos[0]+5, y, { width: 210 });
      doc.text(item.product_sku || '–',       colPos[1], y, { width: 80 });
      doc.text(String(item.quantity),          colPos[2], y, { width: 60, align: 'right' });
      doc.text(item.unit_price.toFixed(3).replace('.', ',') + ' €', colPos[3], y, { width: 55, align: 'right' });
      doc.fillColor(green).text(item.total_price.toFixed(2).replace('.', ',') + ' €', colPos[4], y, { width: 55, align: 'right' });

      y += rowH;
    }

    // Trennlinie
    doc.moveTo(50, y+4).lineTo(545, y+4).strokeColor(border).lineWidth(0.5).stroke();
    y += 16;

    // ── Summen ──────────────────────────────────────────────────────
    const summaryX = 360;
    doc.fontSize(9).font('Helvetica').fillColor(gray);
    doc.text('Zwischensumme:', summaryX, y, { width: 120 });
    doc.fillColor(black).text(order.subtotal.toFixed(2).replace('.', ',') + ' €', summaryX, y, { width: 185, align: 'right' });
    y += 16;
    doc.fillColor(gray).text('Versandkosten:', summaryX, y, { width: 120 });
    doc.fillColor(black).text(order.shipping > 0 ? order.shipping.toFixed(2).replace('.', ',') + ' €' : 'Kostenlos', summaryX, y, { width: 185, align: 'right' });
    y += 20;

    doc.rect(summaryX, y-4, 185, 26).fill('#1D1D1F');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('white');
    doc.text('GESAMT (NETTO)', summaryX+8, y+3);
    doc.text(order.total.toFixed(2).replace('.', ',') + ' €', summaryX, y+3, { width: 180, align: 'right' });
    y += 38;

    // ── Footer ──────────────────────────────────────────────────────
    doc.fontSize(7.5).font('Helvetica').fillColor(gray)
      .text(settings.company_legal || 'Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG – keine MwSt. ausgewiesen', 50, y+10, { align: 'center', width: 495 });

    if (order.payment_method === 'transfer') {
      doc.moveDown().fontSize(8).fillColor(black).font('Helvetica-Bold')
        .text('Bitte überweisen Sie den Betrag auf folgendes Konto:', 50, y+28);
      doc.font('Helvetica').fillColor(gray)
        .text('IBAN: AT12 3456 7890 1234 5678  ·  BIC: BKAUATWW  ·  Verwendungszweck: ' + order.order_number, 50, y+42, { width: 495 });
    }

    doc.end();
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/profil', requireAuth, async (req, res) => {
  try {
    const { vorname, nachname, company, phone, address } = req.body;
    const firstName = (vorname || '').trim();
    const lastName  = (nachname || '').trim();
    const fullName  = `${firstName} ${lastName}`.trim();
    await db.prepare('UPDATE users SET name=?, first_name=?, last_name=?, company=?, phone=?, address=? WHERE id=?')
      .run(fullName, firstName || null, lastName || null, company, phone, address, req.session.userId);
    req.session.userName = fullName;
    flash(req, 'success', 'Profil wurde aktualisiert.');
    res.redirect('/konto');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

// ── Hesap silme ────────────────────────────────────────────────────────────
router.get('/konto-loeschen', requireAuth, (req, res) => {
  res.render('account/delete-account', { title: 'Konto löschen' });
});

router.post('/konto-loeschen', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      flash(req, 'error', 'Bitte geben Sie Ihr Passwort zur Bestätigung ein.');
      return res.redirect('/konto/konto-loeschen');
    }

    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      flash(req, 'error', 'Passwort ist falsch. Bitte versuchen Sie es erneut.');
      return res.redirect('/konto/konto-loeschen');
    }

    // Siparişleri anonimleştir (sil değil — muhasebe için sakla)
    await db.prepare(`UPDATE orders SET user_id=NULL, guest_name='Gelöschter Nutzer', guest_email=NULL WHERE user_id=?`)
      .run(user.id);

    // Kullanıcıyı sil
    await db.prepare('DELETE FROM users WHERE id=?').run(user.id);

    req.session.destroy(() => {
      res.redirect('/?konto=geloescht');
    });
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

router.post('/passwort', requireAuth, async (req, res) => {
  try {
    const { current, password, password2 } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
    if (!bcrypt.compareSync(current, user.password_hash)) {
      flash(req, 'error', 'Aktuelles Passwort ist falsch.');
      return res.redirect('/konto');
    }
    if (password !== password2 || password.length < 8) {
      flash(req, 'error', 'Neues Passwort ungültig (min. 8 Zeichen, Passwörter müssen übereinstimmen).');
      return res.redirect('/konto');
    }
    await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 12), req.session.userId);
    flash(req, 'success', 'Passwort wurde geändert.');
    res.redirect('/konto');
  } catch { res.status(500).render('error', { title: 'Fehler', message: 'Serverfehler.', code: 500 }); }
});

module.exports = router;
