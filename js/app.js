// Boot, hash router, identity gate, sync status, SW registration + update flow.
import { store } from './store.js';
import { startSync } from './sync.js';
import { views } from './views.js';
import { summary } from './dates.js';

const $ = (s, r = document) => r.querySelector(s);
const TABS = ['today', 'timeline', 'checklists', 'notes', 'resources'];
// Routes from before 1.2.0, when OB Questions and OB Call were their own tabs.
// Anything still pointing at them (bookmarks, the remembered tab, an old
// linkrow) lands on the right segment / sub-page of the tab that absorbed them.
const LEGACY = { questions: 'notes/questions', obcall: 'resources/obcall' };
let current = null;   // active view object
let currentKey = '';  // "tab/params" of what's rendered
let pendingUpdate = false;

// ---------- toast ----------
let toastTimer;
window.toast = function toast(msg, { action, onAction, sticky } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${msg}</span>${action ? `<button type="button">${action}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; onAction?.(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
};

// ---------- sync status ----------
function setStatus(state, msg) {
  store.syncStatus = { state, msg };
  const dot = $('#syncDot');
  dot.dataset.state = state;
  dot.title = msg;
  if (current === views.settings) current.update();
}
$('#syncDot').addEventListener('click', () => window.toast(store.syncStatus?.msg || 'Not syncing'));
addEventListener('online', () => { if (store.syncStatus?.state === 'on') window.toast('Back online'); });
addEventListener('offline', () => window.toast('Offline — changes are saved on this phone'));

// ---------- router ----------
function route() {
  let hash = location.hash.slice(1);
  if (!hash) hash = localStorage.getItem('bh.tab') || 'today';
  let [tab, ...params] = hash.split('/');
  if (LEGACY[tab]) {
    [tab, ...params] = LEGACY[tab].split('/').concat(params);
    history.replaceState(null, '', `#${[tab, ...params].join('/')}`);
  }
  const name = tab === 'settings' ? 'settings' : TABS.includes(tab) ? tab : 'today';
  if (TABS.includes(name)) localStorage.setItem('bh.tab', name);
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  const key = `${name}/${params.join('/')}`;
  if (key === currentKey) return;
  currentKey = key;
  if (current === views[name] && current.navigate) {
    // same view, new params (e.g. a segment switch): move within the frame
    // instead of rebuilding it, so half-typed inputs survive
    current.navigate(params);
  } else {
    current = views[name];
    current.render($('#view'), params);
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go],[data-tab]');
  if (!t) return;
  const target = t.dataset.go ?? t.dataset.tab;
  if (`#${target}` === location.hash) window.scrollTo({ top: 0, behavior: 'smooth' });
  location.hash = `#${target}`;
});
addEventListener('hashchange', route);

// Re-render on data changes, but never yank an in-progress edit out from under a thumb.
store.subscribe(() => {
  const a = document.activeElement;
  if (a && a.hasAttribute('data-hold') && $('#view').contains(a)) { pendingUpdate = true; return; }
  updateMini();
  current?.update?.();
});
$('#view').addEventListener('focusout', () => {
  if (pendingUpdate) { pendingUpdate = false; setTimeout(() => current?.update?.(), 50); }
});

function updateMini() {
  const s = summary();
  $('#weekMini').textContent = s.pastDue || s.dueToday ? '40+ wks' : `${s.g.weeks}w ${s.g.day}d`;
}

// ---------- identity ----------
function showIdentity() {
  const m = $('#identity');
  m.hidden = false;
  if (store.identity?.code) m.querySelector('[name=code]').value = store.identity.code;
}
$('#identityForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  store.setIdentity({ user: fd.get('user'), code: String(fd.get('code')).trim() });
  $('#identity').hidden = true;
  startSync(store, store.identity.code, setStatus);
});
$('#btnSettings').addEventListener('click', () => { location.hash = '#settings'; });

// ---------- service worker + update flow ----------
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    const offerUpdate = (worker) => window.toast('Update ready', {
      action: 'Reload', sticky: true,
      onAction: () => worker.postMessage('SKIP_WAITING'),
    });
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return; reloading = true; location.reload();
    });
    // look for a new version whenever the app is foregrounded
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  } catch (e) { console.warn('SW registration failed', e); }
}

// ---------- boot ----------
(async function boot() {
  try {
    await store.init();
  } catch (e) {
    document.body.innerHTML = `<div class="empty" style="padding:60px 20px"><b>Couldn't start</b>${e.message}</div>`;
    return;
  }
  $('#app').hidden = false;
  updateMini();
  route();
  if (!store.identity?.user || !store.identity?.code) showIdentity();
  else startSync(store, store.identity.code, setStatus);
  registerSW();
  // keep the counter honest across midnight / long-lived standalone sessions
  setInterval(() => { updateMini(); if (current === views.today) current.update(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { updateMini(); current?.update?.(); } });
})();
