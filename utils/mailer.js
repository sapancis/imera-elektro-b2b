/**
 * Imera Elektro — E-Mail Utility
 * Nodemailer ile sipariş onay ve admin bildirim mailleri
 */
const nodemailer = require('nodemailer');

function createTransport() {
  // .env'den SMTP ayarları okunur
  // Hostinger SMTP: mail.hostinger.com:465 (SSL) veya :587 (TLS)
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'mail.hostinger.com',
    port:   parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE !== 'false', // 465 için true, 587 için false
    auth: {
      user: process.env.SMTP_USER || process.env.MAIL_FROM || '',
      pass: process.env.SMTP_PASS || '',
    },
    tls: { rejectUnauthorized: false },
  });
}

function fmt(n) {
  return typeof n === 'number' ? n.toFixed(3).replace('.', ',') + '€' : String(n || '');
}
function fmt2(n) {
  return typeof n === 'number' ? n.toFixed(2).replace('.', ',') + '€' : String(n || '');
}

/**
 * Müşteriye sipariş onay maili
 */
async function sendOrderConfirmation({ order, items, customerEmail, customerName }) {
  if (!process.env.SMTP_PASS) return; // SMTP ayarlanmamışsa sessizce geç

  const paymentLabel = {
    transfer: 'Banküberweisung',
    invoice:  'Auf Rechnung',
    stripe:   'Kreditkarte (Stripe)',
  }[order.payment_method] || order.payment_method;

  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB">${item.product_name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${item.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right">${fmt(item.unit_price)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;font-weight:600">${fmt2(item.total_price)}</td>
    </tr>`).join('');

  const bankInfo = order.payment_method === 'transfer' ? `
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:16px;margin-top:20px">
      <h3 style="margin:0 0 10px;color:#166534;font-size:15px">Bankverbindung für Ihre Überweisung</h3>
      <table style="font-size:14px;color:#166534">
        <tr><td style="padding:2px 12px 2px 0;font-weight:600">Empfänger:</td><td>Imera Elektro</td></tr>
        <tr><td style="padding:2px 12px 2px 0;font-weight:600">IBAN:</td><td>${process.env.BANK_IBAN || 'Bitte beim Support erfragen'}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;font-weight:600">Verwendungszweck:</td><td>${order.order_number}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;font-weight:600">Betrag:</td><td>${fmt2(order.total)}</td></tr>
      </table>
    </div>` : '';

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

    <!-- Header -->
    <div style="background:#1D1D1F;padding:28px 32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:-0.5px">IMERA ELEKTRO</h1>
      <p style="color:#A1A1A6;margin:4px 0 0;font-size:13px">Elektrokomponenten 40–60% unter Marktpreis</p>
    </div>

    <!-- Body -->
    <div style="padding:32px">
      <div style="background:#F0FDF4;border-left:4px solid #34C759;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px">
        <h2 style="margin:0 0 4px;color:#166534;font-size:18px">✓ Bestellung eingegangen!</h2>
        <p style="margin:0;color:#15803D;font-size:14px">Bestellnummer: <strong>${order.order_number}</strong></p>
      </div>

      <p style="color:#1D1D1F;font-size:15px;margin:0 0 20px">
        Liebe/r ${customerName},<br><br>
        vielen Dank für Ihre Bestellung! Wir haben sie erhalten und werden sie schnellstmöglich bearbeiten.
      </p>

      <!-- Items -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead>
          <tr style="background:#F5F5F7">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6E6E73;font-weight:600;text-transform:uppercase">Produkt</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6E6E73;font-weight:600;text-transform:uppercase">Menge</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6E6E73;font-weight:600;text-transform:uppercase">Einzelpreis</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6E6E73;font-weight:600;text-transform:uppercase">Gesamt</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <!-- Totals -->
      <table style="width:100%;margin-bottom:24px">
        <tr><td style="padding:4px 12px;color:#6E6E73;font-size:14px">Zwischensumme</td><td style="padding:4px 12px;text-align:right;font-size:14px">${fmt2(order.subtotal)}</td></tr>
        <tr><td style="padding:4px 12px;color:#6E6E73;font-size:14px">Versand</td><td style="padding:4px 12px;text-align:right;font-size:14px">${order.shipping === 0 ? '<span style="color:#34C759">Kostenlos</span>' : fmt2(order.shipping)}</td></tr>
        ${order.total < order.subtotal + order.shipping ? `<tr><td style="padding:4px 12px;color:#34C759;font-size:14px">Rabatt</td><td style="padding:4px 12px;text-align:right;font-size:14px;color:#34C759">-${fmt2(order.subtotal + order.shipping - order.total)}</td></tr>` : ''}
        <tr style="border-top:2px solid #1D1D1F">
          <td style="padding:10px 12px;font-weight:700;font-size:16px">Gesamtbetrag</td>
          <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:16px">${fmt2(order.total)}</td>
        </tr>
      </table>

      <!-- Payment -->
      <table style="width:100%;font-size:14px;color:#6E6E73;margin-bottom:4px">
        <tr><td style="padding:4px 0;font-weight:600;color:#1D1D1F">Zahlungsart:</td><td>${paymentLabel}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600;color:#1D1D1F">Lieferadresse:</td><td>${(order.shipping_address || '').replace(/\n/g,'<br>')}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600;color:#1D1D1F">Lieferzeit:</td><td>2–5 Werktage nach Zahlungseingang</td></tr>
      </table>

      ${bankInfo}

      <p style="color:#6E6E73;font-size:13px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">
        Bei Fragen stehen wir Ihnen gerne zur Verfügung:<br>
        📞 <a href="tel:+436608514467" style="color:#1D1D1F">+43 660 8514467</a> &nbsp;|&nbsp;
        ✉ <a href="mailto:info@imeragroup.com" style="color:#1D1D1F">info@imeragroup.com</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#F5F5F7;padding:16px 32px;text-align:center;font-size:12px;color:#6E6E73">
      <p style="margin:0">Imera Elektro · www.imeragroup.com · Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG</p>
    </div>
  </div>
</body>
</html>`;

  const transporter = createTransport();
  await transporter.sendMail({
    from: `"Imera Elektro" <${process.env.SMTP_USER || process.env.MAIL_FROM}>`,
    to:   customerEmail,
    subject: `✓ Bestellbestätigung ${order.order_number} – Imera Elektro`,
    html,
  });
}

/**
 * Admin'e yeni sipariş bildirimi
 */
async function sendAdminOrderNotification({ order, items, customerName, customerEmail }) {
  if (!process.env.SMTP_PASS) return;

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@imeraelektro.at';
  const itemsText = items.map(i =>
    `  • ${i.product_name} × ${i.quantity} = ${fmt2(i.total_price)}`
  ).join('\n');

  const html = `
<!DOCTYPE html>
<html lang="de">
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#F5F5F7;margin:0;padding:20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="background:#FF9500;padding:20px 28px">
      <h2 style="margin:0;color:#fff;font-size:18px">🛒 Neue Bestellung eingegangen!</h2>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:14px">${order.order_number}</p>
    </div>
    <div style="padding:24px 28px">
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6E6E73;width:140px">Kunde:</td><td style="font-weight:600">${customerName}</td></tr>
        <tr><td style="padding:6px 0;color:#6E6E73">E-Mail:</td><td>${customerEmail}</td></tr>
        <tr><td style="padding:6px 0;color:#6E6E73">Betrag:</td><td style="font-weight:700;font-size:16px;color:#34C759">${fmt2(order.total)}</td></tr>
        <tr><td style="padding:6px 0;color:#6E6E73">Zahlung:</td><td>${order.payment_method}</td></tr>
        <tr><td style="padding:6px 0;color:#6E6E73">Adresse:</td><td>${(order.shipping_address || '').replace(/\n/g,'<br>')}</td></tr>
      </table>

      <div style="background:#F5F5F7;border-radius:8px;padding:14px 16px;margin-top:16px">
        <div style="font-size:12px;font-weight:600;color:#6E6E73;text-transform:uppercase;margin-bottom:8px">Bestellte Artikel</div>
        ${items.map(i => `<div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;border-bottom:1px solid #E5E7EB">
          <span>${i.product_name} <span style="color:#6E6E73">×${i.quantity}</span></span>
          <span style="font-weight:600">${fmt2(i.total_price)}</span>
        </div>`).join('')}
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;padding:10px 0 0">
          <span>Gesamt</span><span style="color:#34C759">${fmt2(order.total)}</span>
        </div>
      </div>

      <div style="margin-top:20px;text-align:center">
        <a href="${process.env.SITE_URL || 'https://mediumturquoise-squid-139514.hostingersite.com'}/admin/bestellungen"
           style="display:inline-block;background:#1D1D1F;color:#fff;padding:12px 28px;border-radius:980px;text-decoration:none;font-weight:600;font-size:14px">
          Im Admin öffnen →
        </a>
      </div>
    </div>
  </div>
</body>
</html>`;

  const transporter = createTransport();
  await transporter.sendMail({
    from:    `"Imera Elektro System" <${process.env.SMTP_USER || process.env.MAIL_FROM}>`,
    to:      adminEmail,
    subject: `🛒 Neue Bestellung ${order.order_number} – ${fmt2(order.total)} – ${customerName}`,
    html,
  });
}

/**
 * Müşteriye sipariş durum değişikliği maili (kargoya verildi / teslim / iptal)
 */
async function sendStatusUpdate({ order, items, customerEmail, customerName }) {
  if (!process.env.SMTP_PASS) return;

  const configs = {
    shipped: {
      emoji: '🚚',
      title: 'Ihre Bestellung wurde versendet!',
      color: '#3B82F6',
      bgColor: '#EFF6FF',
      borderColor: '#BFDBFE',
      textColor: '#1E40AF',
      message: 'Ihre Bestellung ist auf dem Weg zu Ihnen. Die Lieferung dauert in der Regel 1–3 Werktage.',
      subject: `🚚 Ihre Bestellung ${order.order_number} wurde versendet`,
    },
    delivered: {
      emoji: '✅',
      title: 'Bestellung erfolgreich geliefert!',
      color: '#34C759',
      bgColor: '#F0FDF4',
      borderColor: '#BBF7D0',
      textColor: '#166534',
      message: 'Wir hoffen, Sie sind mit Ihrer Bestellung zufrieden. Bei Fragen stehen wir jederzeit zur Verfügung.',
      subject: `✅ Ihre Bestellung ${order.order_number} wurde geliefert`,
    },
    cancelled: {
      emoji: '❌',
      title: 'Bestellung storniert',
      color: '#EF4444',
      bgColor: '#FFF5F5',
      borderColor: '#FED7D7',
      textColor: '#991B1B',
      message: 'Ihre Bestellung wurde storniert. Falls Sie Fragen haben oder eine neue Bestellung aufgeben möchten, kontaktieren Sie uns bitte.',
      subject: `❌ Ihre Bestellung ${order.order_number} wurde storniert`,
    },
  };

  const cfg = configs[order.status];
  if (!cfg) return;

  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB">${item.product_name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${item.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;font-weight:600">${fmt2(item.total_price)}</td>
    </tr>`).join('');

  const html = `
<!DOCTYPE html>
<html lang="de">
<body style="margin:0;padding:0;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:#1D1D1F;padding:28px 32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:-0.5px">IMERA ELEKTRO</h1>
      <p style="color:#A1A1A6;margin:4px 0 0;font-size:13px">Elektrokomponenten 40–60% unter Marktpreis</p>
    </div>
    <div style="padding:32px">
      <div style="background:${cfg.bgColor};border-left:4px solid ${cfg.color};padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px">
        <h2 style="margin:0 0 4px;color:${cfg.textColor};font-size:18px">${cfg.emoji} ${cfg.title}</h2>
        <p style="margin:0;color:${cfg.textColor};font-size:14px">Bestellnummer: <strong>${order.order_number}</strong></p>
      </div>

      <p style="color:#1D1D1F;font-size:15px;margin:0 0 20px">
        Liebe/r ${customerName},<br><br>${cfg.message}
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <thead>
          <tr style="background:#F5F5F7">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6E6E73;font-weight:600;text-transform:uppercase">Produkt</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6E6E73;font-weight:600;text-transform:uppercase">Menge</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6E6E73;font-weight:600;text-transform:uppercase">Gesamt</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="text-align:right;padding:8px 12px;font-weight:700;font-size:16px;border-top:2px solid #1D1D1F">
        Gesamtbetrag: ${fmt2(order.total)}
      </div>

      <p style="color:#6E6E73;font-size:13px;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px">
        Bei Fragen stehen wir Ihnen gerne zur Verfügung:<br>
        📞 <a href="tel:+436608514467" style="color:#1D1D1F">+43 660 8514467</a> &nbsp;|&nbsp;
        ✉ <a href="mailto:info@imeragroup.com" style="color:#1D1D1F">info@imeragroup.com</a>
      </p>
    </div>
    <div style="background:#F5F5F7;padding:16px 32px;text-align:center;font-size:12px;color:#6E6E73">
      <p style="margin:0">Imera Elektro · www.imeragroup.com · Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG</p>
    </div>
  </div>
</body>
</html>`;

  const transporter = createTransport();
  await transporter.sendMail({
    from:    `"Imera Elektro" <${process.env.SMTP_USER || process.env.MAIL_FROM}>`,
    to:      customerEmail,
    subject: cfg.subject,
    html,
  });
}

module.exports = { sendOrderConfirmation, sendAdminOrderNotification, sendStatusUpdate };
