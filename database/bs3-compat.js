/**
 * better-sqlite3 compatibility shim using node-sqlite3-wasm
 * Used as a fallback on servers where better-sqlite3's native binary
 * is not compatible (e.g., old glibc on shared hosting).
 */
'use strict';

const { Database: WasmDB } = require('node-sqlite3-wasm');

/**
 * Normalize variadic or single-array params to an array.
 * Handles:
 *   stmt.run(1, 2, 3)      → [1, 2, 3]
 *   stmt.run([1, 2, 3])    → [1, 2, 3]
 *   stmt.run()             → []
 */
function normalizeParams(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object') return args[0];
  return Array.from(args);
}

class Statement {
  constructor(wasmStmt) {
    this._s = wasmStmt;
  }

  run(...args) {
    return this._s.run(normalizeParams(args));
  }

  get(...args) {
    return this._s.get(normalizeParams(args));
  }

  all(...args) {
    return this._s.all(normalizeParams(args));
  }

  iterate(...args) {
    // Fall back to all() and return a plain iterator
    const rows = this._s.all(normalizeParams(args));
    return rows[Symbol.iterator]();
  }

  finalize() {
    if (typeof this._s.finalize === 'function') this._s.finalize();
  }
}

class Database {
  constructor(filePath, _options) {
    this._db = new WasmDB(filePath);
  }

  pragma(str) {
    try {
      const rows = this._db.all(`PRAGMA ${str}`);
      if (rows && rows.length === 1) {
        const keys = Object.keys(rows[0]);
        if (keys.length === 1) return rows[0][keys[0]];
      }
      return rows;
    } catch (_) {
      // Write-only pragma — ignore return
      try { this._db.run(`PRAGMA ${str}`); } catch (_2) { /* ignore */ }
    }
  }

  exec(sql) {
    this._db.exec(sql);
    return this;
  }

  prepare(sql) {
    return new Statement(this._db.prepare(sql));
  }

  run(sql, ...args) {
    return this._db.run(sql, normalizeParams(args));
  }

  get(sql, ...args) {
    return this._db.get(sql, normalizeParams(args));
  }

  all(sql, ...args) {
    return this._db.all(sql, normalizeParams(args));
  }

  transaction(fn) {
    const db = this._db;
    return function (...args) {
      db.run('BEGIN');
      try {
        const result = fn(...args);
        db.run('COMMIT');
        return result;
      } catch (e) {
        try { db.run('ROLLBACK'); } catch (_) { /* ignore */ }
        throw e;
      }
    };
  }

  close() {
    this._db.close();
  }
}

module.exports = Database;
