'use strict';
// Banka/havale bilgileri — tek kaynak. Değerler ortam değişkeninden gelir,
// yoksa aşağıdaki gerçek hesap bilgisi kullanılır. Alıcı adı (Empfänger),
// IBAN'ın hesap sahibiyle birebir aynı olmalı; yoksa havale geri döner.
module.exports = {
  BANK_HOLDER: process.env.BANK_HOLDER || 'Irfan Melih Onmaz',
  BANK_IBAN: process.env.BANK_IBAN || 'AT74 2011 1854 5181 9905',
};
