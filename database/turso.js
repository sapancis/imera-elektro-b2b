'use strict';
const { createClient } = require('@libsql/client');

let client;
function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

function toPlainObj(row) {
  if (!row) return undefined;
  return Object.fromEntries(Object.entries(row));
}

function normalize(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object') return args[0];
  return Array.from(args);
}

class Statement {
  constructor(sql) { this.sql = sql; }
  async run(...args) {
    const r = await getClient().execute({ sql: this.sql, args: normalize(args) });
    return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid };
  }
  async get(...args) {
    const r = await getClient().execute({ sql: this.sql, args: normalize(args) });
    return r.rows.length ? toPlainObj(r.rows[0]) : undefined;
  }
  async all(...args) {
    const r = await getClient().execute({ sql: this.sql, args: normalize(args) });
    return r.rows.map(toPlainObj);
  }
}

const db = {
  prepare(sql) { return new Statement(sql); },
  async exec(sql) { await getClient().executeMultiple(sql); },
  pragma() { return null; },
  transaction(fn) {
    return async (...args) => {
      await getClient().execute('BEGIN');
      try { const r = await fn(...args); await getClient().execute('COMMIT'); return r; }
      catch(e) { try { await getClient().execute('ROLLBACK'); } catch(_) {} throw e; }
    };
  }
};

module.exports = db;
