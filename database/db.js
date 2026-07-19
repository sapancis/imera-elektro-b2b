if (process.env.TURSO_DATABASE_URL) {
  module.exports = require('./turso');
  return;
}

const path = require('path');

// Try native better-sqlite3 first; fall back to pure-WASM shim on hosts
// where the native binary is incompatible (e.g. old glibc on shared hosting).
let Database;
try {
  Database = require('better-sqlite3');
} catch (_) {
  Database = require('./bs3-compat');
}

const DB_PATH = path.join(__dirname, 'imera.db');
let db;
try {
  db = new Database(DB_PATH);
} catch (_) {
  // Native module loaded but failed at runtime (glibc mismatch etc.)
  Database = require('./bs3-compat');
  db = new Database(DB_PATH);
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    icon TEXT DEFAULT '📦',
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    sku TEXT UNIQUE,
    category_id INTEGER REFERENCES categories(id),
    description TEXT,
    specs TEXT,
    applications TEXT,
    market_price_min REAL,
    market_price_max REAL,
    stock INTEGER DEFAULT 0,
    image TEXT,
    images TEXT DEFAULT '[]',
    active INTEGER DEFAULT 1,
    featured INTEGER DEFAULT 0,
    badge TEXT,
    sell_as_pack INTEGER DEFAULT 0,
    pack_size INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    min_qty INTEGER NOT NULL,
    max_qty INTEGER,
    price REAL NOT NULL,
    label TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    first_name TEXT,
    last_name TEXT,
    company TEXT,
    phone TEXT,
    address TEXT,
    role TEXT DEFAULT 'customer',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    guest_email TEXT,
    guest_name TEXT,
    guest_company TEXT,
    status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'transfer',
    subtotal REAL NOT NULL,
    shipping REAL DEFAULT 0,
    total REAL NOT NULL,
    notes TEXT,
    shipping_address TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    product_name TEXT NOT NULL,
    product_sku TEXT,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS price_list_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    sent INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved_carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    items TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL DEFAULT 'percent',
    value REAL NOT NULL,
    min_order REAL DEFAULT 0,
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    user_id INTEGER REFERENCES users(id),
    expires_at TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS merkliste (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, product_id)
  );
`);

// ── first_name / last_name kolonları (eski DB'lerde yoksa ekle) + eski 'name'i böl ──
for (const col of ['first_name', 'last_name']) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`); } catch (_) { /* zaten var */ }
}
try {
  const rows = db.prepare("SELECT id, name FROM users WHERE (first_name IS NULL OR first_name = '') AND name IS NOT NULL AND TRIM(name) != ''").all();
  const upd = db.prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?');
  for (const u of rows) {
    const parts = String(u.name).trim().split(/\s+/);
    const fn = parts.shift() || '';
    upd.run(fn, parts.join(' '), u.id);
  }
} catch (_) {}

// ── Paket satışı kolonları (eski DB'lerde yoksa ekle) ──
try { db.exec('ALTER TABLE products ADD COLUMN sell_as_pack INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE products ADD COLUMN pack_size INTEGER DEFAULT 1'); } catch (_) {}

const defaultSettings = [
  ['site_name', 'Imera Elektro'],
  ['site_tagline', 'Elektrokomponenten 40-60% unter Marktpreis'],
  ['tawkto_property_id', ''],
  ['welcome_discount_percent', '10'],
  ['stripe_publishable_key', ''],
  ['google_analytics_id', ''],
  ['contact_phone', '+43 660 8514467'],
  ['contact_email', 'info@imeragroup.com'],
  ['contact_website', 'www.imeragroup.com'],
  ['shipping_info', '2-5 Werktage'],
  ['free_shipping_threshold', '200'],
  ['company_legal', 'Imera Elektro unterliegt der Regelbesteuerung · UID: ATU82785639 · Alle Preise netto zzgl. 20% MwSt.'],
  ['meta_description', 'CE-zertifizierte Elektrokomponenten 40-60% günstiger als der österreichische Markt. Direktimport. Kabelbinder, Kabelverschraubungen, Reihenklemmen.'],
];

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const row of defaultSettings) insertSetting.run(...row);

module.exports = db;
