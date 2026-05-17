'use strict';
const session = require('express-session');

class TursoSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this._init();
    // Her saat süresi dolmuş sessionları temizle
    setInterval(() => this._cleanup(), 60 * 60 * 1000);
  }

  async _init() {
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          sess TEXT NOT NULL,
          expired_at INTEGER NOT NULL
        )
      `);
    } catch (e) { /* tablo zaten varsa sorun değil */ }
  }

  get(sid, cb) {
    this.db.prepare('SELECT sess, expired_at FROM sessions WHERE sid=?').get(sid)
      .then(row => {
        if (!row || row.expired_at < Date.now()) return cb(null, null);
        try { cb(null, JSON.parse(row.sess)); } catch { cb(null, null); }
      })
      .catch(e => cb(e));
  }

  set(sid, sess, cb) {
    const maxAge = (sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : 7 * 24 * 60 * 60 * 1000;
    const expiredAt = Date.now() + maxAge;
    this.db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?,?,?)')
      .run(sid, JSON.stringify(sess), expiredAt)
      .then(() => cb(null))
      .catch(e => cb(e));
  }

  destroy(sid, cb) {
    this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid)
      .then(() => cb(null))
      .catch(e => cb(e));
  }

  touch(sid, sess, cb) {
    const maxAge = (sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : 7 * 24 * 60 * 60 * 1000;
    const expiredAt = Date.now() + maxAge;
    this.db.prepare('UPDATE sessions SET expired_at=? WHERE sid=?').run(expiredAt, sid)
      .then(() => cb(null))
      .catch(e => cb(e));
  }

  async _cleanup() {
    try {
      await this.db.prepare('DELETE FROM sessions WHERE expired_at < ?').run(Date.now());
    } catch (_) {}
  }
}

module.exports = TursoSessionStore;
