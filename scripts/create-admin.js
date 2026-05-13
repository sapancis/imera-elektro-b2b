require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

(async () => {
  const email = await ask('Admin E-Mail: ');
  const password = await ask('Passwort (min. 8 Zeichen): ');
  const name = await ask('Name: ');
  rl.close();

  if (!email || password.length < 8) { console.log('Ungültige Eingabe.'); process.exit(1); }

  const hash = bcrypt.hashSync(password, 12);
  try {
    db.prepare('INSERT OR REPLACE INTO users (email, password_hash, name, role, active) VALUES (?,?,?,?,?)')
      .run(email.toLowerCase().trim(), hash, name || 'Administrator', 'admin', 1);
    console.log(`✓ Admin erstellt: ${email}`);
  } catch (e) { console.error('Fehler:', e.message); }
  process.exit(0);
})();
