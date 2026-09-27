'use strict';

// Basit in-memory cache — TTL'li
// Vercel serverless instance başına çalışır; cold start'tan sonra cache boş olur
// ama warm instance'larda DB çağrısı sayısını ciddi oranda azaltır

const store = new Map();
const MAX_ENTRIES = 500; // botların ürettiği sınırsız URL kombinasyonu belleği şişirmesin

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { store.delete(key); return null; }
  return entry.value;
}

function set(key, value, ttlMs = 60_000) {
  store.delete(key);
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // en eski girdi
  store.set(key, { value, expires: Date.now() + ttlMs });
}

function del(key) { store.delete(key); }
function clear() { store.clear(); }

// Sonucu cache'le; aynı anda gelen istekler aynı Promise'i paylaşır
// (N paralel istek = 1 DB sorgusu). Hata olursa cache'e yazılmaz.
function memo(key, ttlMs, fn) {
  const hit = get(key);
  if (hit) return hit;
  const p = Promise.resolve().then(fn);
  set(key, p, ttlMs);
  p.catch(() => del(key));
  return p;
}

module.exports = { get, set, del, clear, memo };
