const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'imera.db');
const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

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
`);

const defaultSettings = [
  ['site_name', 'Imera Elektro'],
  ['site_tagline', 'Elektrokomponenten 40-60% unter Marktpreis'],
  ['contact_phone', '+43 660 8514467'],
  ['contact_email', 'info@imeragroup.com'],
  ['contact_website', 'www.imeragroup.com'],
  ['shipping_info', '2-5 Werktage'],
  ['free_shipping_threshold', '200'],
  ['company_legal', 'Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG'],
  ['meta_description', 'CE-zertifizierte Elektrokomponenten 40-60% günstiger als der österreichische Markt. Direktimport Türkei. Kabelbinder, Kabelverschraubungen, Reihenklemmen.'],
];

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const row of defaultSettings) insertSetting.run(...row);

module.exports = db;
