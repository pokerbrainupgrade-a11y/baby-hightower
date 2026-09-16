// Optional Firestore sync. Activates only if ./firebase-config.js exists
// (it is gitignored — see README). Without it the app is local-only.
//
// Layout in Firestore:  households/{code}/{coll}/{key}  ← same docs as IndexedDB.
// Real-time listeners pull the other phone's writes; every local write is
// pushed with setDoc(merge). On connect, local docs that are newer than (or
// missing from) the server are pushed, so nothing is lost to a force-close.
import { FIREBASE_SDK } from './config.js';

const COLLS = ['events', 'items', 'notes', 'questions', 'obcall'];

export async function startSync(store, code, setStatus) {
  let cfg = null;
  try { cfg = (await import('../firebase-config.js')).firebaseConfig; } catch { /* no config → local only */ }
  if (!cfg || !cfg.projectId) { setStatus('off', 'Not syncing — no firebase-config.js'); return null; }
  if (!code) { setStatus('off', 'Not syncing — no household code'); return null; }

  setStatus('connecting', 'Connecting…');
  let fs;
  try {
    const [{ initializeApp }, firestore] = await Promise.all([
      import(`${FIREBASE_SDK}/firebase-app.js`),
      import(`${FIREBASE_SDK}/firebase-firestore.js`),
    ]);
    fs = firestore;
    const app = initializeApp(cfg);
    const db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
    const ref = (coll, key) => fs.doc(db, 'households', code, coll, key);

    const push = (d) => fs.setDoc(ref(d.coll, d.key), d, { merge: true })
      .catch((e) => setStatus('error', explain(e)));
    store.remote = push;

    // Only a server-confirmed snapshot (not one served from Firestore's local
    // cache) proves the project + rules + code are right, so status turns green
    // only once every collection has heard from the server.
    const live = new Set();
    const report = () => {
      if (live.size === COLLS.length) setStatus('on', 'Syncing');
      else setStatus('connecting', navigator.onLine ? 'Connecting…' : 'Offline — will sync when back online');
    };
    // A wrong projectId or blocked network never errors — it just retries forever.
    setTimeout(() => { if (live.size < COLLS.length && navigator.onLine) setStatus('connecting', 'Still connecting — check firebase-config.js, rules and household code'); }, 20000);
    addEventListener('online', report);
    addEventListener('offline', report);

    for (const coll of COLLS) {
      let reconciled = false;
      fs.onSnapshot(fs.collection(db, 'households', code, coll), { includeMetadataChanges: true }, async (snap) => {
        for (const ch of snap.docChanges()) if (ch.type !== 'removed') await store.applyRemote(ch.doc.data());
        if (!snap.metadata.fromCache && !reconciled) {
          // first word from the server: push anything local that's newer or missing
          reconciled = true;
          const remote = new Map(snap.docs.map((d) => [d.id, d.data().updatedAt || 0]));
          for (const d of store.list(coll).concat(store.deletedIn(coll))) {
            if (!remote.has(d.key) || (d.updatedAt || 0) > remote.get(d.key)) push(d);
          }
        }
        if (snap.metadata.fromCache) live.delete(coll); else live.add(coll);
        report();
      }, (e) => setStatus('error', explain(e)));
    }
    return { db, fs, push };
  } catch (e) {
    setStatus('error', explain(e));
    return null;
  }
}

function explain(e) {
  const code = e?.code || '';
  if (code.includes('permission-denied')) return 'Sync blocked — check Firestore rules + household code';
  if (code.includes('unavailable') || /fetch|network/i.test(e?.message || '')) return 'Offline — will sync when back online';
  return `Sync error: ${e?.message || e}`;
}
