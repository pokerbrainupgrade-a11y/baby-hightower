// Thin IndexedDB wrapper. One object store, `docs`, keyed by `id`
// ("<coll>/<key>"), with an index on `coll`. That is the local source of
// truth; Firestore (when configured) mirrors the same documents.
const NAME = 'baby-hightower';
const VERSION = 1;
const STORE = 'docs';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('coll', 'coll', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function getAll() {
  const db = await open();
  return wrap(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
}

export async function put(doc) {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(doc);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(doc);
    tx.onerror = () => reject(tx.error);
  });
}

export async function putMany(docs) {
  if (!docs.length) return;
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const s = tx.objectStore(STORE);
  docs.forEach((d) => s.put(d));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll() {
  const db = await open();
  return wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
}
