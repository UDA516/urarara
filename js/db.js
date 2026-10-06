// 端末の保存先（IndexedDB）。
//   kv      … 暗号化したデータ（envelope）・鍵・途中の判別の id・逆算の入力・設定
//   records … 判別とメモの記録（1件1つ。id で引く）
const DB_NAME = 'slot-memo';
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

const asPromise = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = t => new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });

async function store(name, mode) {
  const t = (await open()).transaction(name, mode);
  return { t, s: t.objectStore(name) };
}

export async function kvGet(key) { const { s } = await store('kv', 'readonly'); return asPromise(s.get(key)); }
export async function kvSet(key, value) { const { t, s } = await store('kv', 'readwrite'); s.put(value, key); return done(t); }
export async function kvDel(key) { const { t, s } = await store('kv', 'readwrite'); s.delete(key); return done(t); }

export async function recGet(id) { const { s } = await store('records', 'readonly'); return asPromise(s.get(id)); }
export async function recPut(rec) { const { t, s } = await store('records', 'readwrite'); s.put(rec); return done(t); }
export async function recDel(id) { const { t, s } = await store('records', 'readwrite'); s.delete(id); return done(t); }
/** 全件（新しい順） */
export async function recAll() {
  const { s } = await store('records', 'readonly');
  const all = await asPromise(s.getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt);
}
