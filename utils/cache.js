'use strict';

// Basit in-memory cache — TTL'li
// Vercel serverless instance başına çalışır; cold start'tan sonra cache boş olur
// ama warm instance'larda DB çağrısı sayısını ciddi oranda azaltır

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { store.delete(key); return null; }
  return entry.value;
}

function set(key, value, ttlMs = 60_000) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

function del(key) { store.delete(key); }
function clear() { store.clear(); }

module.exports = { get, set, del, clear };
