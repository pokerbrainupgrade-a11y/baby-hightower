// In-memory state + write-through to IndexedDB, with an optional remote hook
// (sync.js) that mirrors every local write to Firestore. Last-write-wins per
// document via `updatedAt`.
//
// Document shape: { id: 'coll/key', coll, key, updatedAt, updatedBy, ...fields }
// Collections: events (per-timeline-event state: done, notes, confirmed
// date/time), items (checklist items), notes, questions, obcall (first-call
// checklist), resources (listened episodes), settings (the household's due
// date). Deletes are soft (`deleted: true`) so they replicate.
import * as db from './db.js';
import { DUE } from './config.js';
import { setDue, estimateWindow, trimester, isISO } from './dates.js';

const IDENTITY_KEY = 'bh.identity';

export const store = {
  docs: new Map(),
  seed: null,
  resources: null,      // data/resources.json — the Resources tab's content
  identity: null,       // { user: 'Q' | 'Staci', code: 'household-code' }
  remote: null,         // (doc) => Promise — set by sync.js when active
  listeners: new Set(),

  async init() {
    [this.seed, this.resources] = await Promise.all(
      ['./data/seed.json', './data/resources.json'].map((u) => fetch(u).then((r) => r.json())),
    );
    for (const d of await db.getAll()) this.docs.set(d.id, d);
    try { this.identity = JSON.parse(localStorage.getItem(IDENTITY_KEY)); } catch { this.identity = null; }
    setDue(this.due);
    return this;
  },

  setIdentity(identity) {
    this.identity = identity;
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    this.emit();
  },

  get user() { return this.identity?.user || '?'; },

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  // Every change (local or from the other phone) re-anchors the date math
  // first, so a due-date edit is already in effect when the views redraw.
  emit() { setDue(this.due); for (const fn of this.listeners) fn(); },

  // ---------- due date ----------
  /** The household's due date: settings/due if set (and sane), else the config default. */
  get due() {
    const d = this.get('settings', 'due')?.due;
    return isISO(d) ? d : DUE;
  },
  get dueDoc() { return this.get('settings', 'due') || null; },
  /** Set the due date ('YYYY-MM-DD'), or pass null to go back to the default. */
  setDueDate(iso) { return this.write('settings', 'due', { due: isISO(iso) ? iso : null }); },

  get(coll, key) { return this.docs.get(`${coll}/${key}`); },
  list(coll) {
    const out = [];
    for (const d of this.docs.values()) if (d.coll === coll && !d.deleted) out.push(d);
    return out;
  },
  /** Soft-deleted docs in a collection (so deletions reconcile on connect). */
  deletedIn(coll) {
    const out = [];
    for (const d of this.docs.values()) if (d.coll === coll && d.deleted) out.push(d);
    return out;
  },

  /** Merge `patch` into coll/key, stamp author + time, persist, mirror. */
  async write(coll, key, patch) {
    const id = `${coll}/${key}`;
    const prev = this.docs.get(id) || { id, coll, key, createdAt: Date.now(), createdBy: this.user };
    const doc = { ...prev, ...patch, updatedAt: Date.now(), updatedBy: this.user };
    this.docs.set(id, doc);
    await db.put(doc);
    this.emit();
    if (this.remote) this.remote(doc);
    return doc;
  },

  remove(coll, key) { return this.write(coll, key, { deleted: true }); },

  /** A document arriving from the other phone. Newer wins; ties keep local. */
  async applyRemote(doc) {
    if (!doc?.id || !doc.coll || !doc.key) return false;
    const local = this.docs.get(doc.id);
    if (local && (local.updatedAt || 0) >= (doc.updatedAt || 0)) return false;
    this.docs.set(doc.id, doc);
    await db.put(doc);
    this.emit();
    return true;
  },

  uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).replace(/-/g, '').slice(0, 20);
  },

  // ---------- derived views over seed + docs ----------

  /**
   * All timeline events with live state merged in, in date order.
   * Each carries its estimate window (estFrom/estTo — recalculated from the
   * current due date), the confirmed date/time if one was entered, and the
   * effective window (from/to) the app sorts and judges "past" by.
   */
  events() {
    const out = [];
    for (const t of this.seed.trimesters) {
      for (const e of t.events) {
        const state = this.get('events', e.id) || {};
        const { from: estFrom, to: estTo } = estimateWindow(e.est);
        const confirmed = isISO(state.date);
        const from = confirmed ? state.date : estFrom;
        const to = confirmed ? state.date : estTo;
        out.push({ ...e, state, estFrom, estTo, confirmed, from, to, time: confirmed ? state.time || '' : '', trimester: trimester(from) });
      }
    }
    return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.order - b.order));
  },
  /** Confirm an event's date ('YYYY-MM-DD') and optional time ('HH:MM'); stamps who/when. */
  setEventDate(id, date, time) {
    if (!isISO(date)) return Promise.resolve(null);
    return this.write('events', id, { date, time: /^\d{2}:\d{2}$/.test(time || '') ? time : null, dateBy: this.user, dateAt: Date.now() });
  },
  /** Back to the estimate. */
  clearEventDate(id) { return this.write('events', id, { date: null, time: null, dateBy: null, dateAt: null }); },
  event(id) { return this.events().find((e) => e.id === id); },
  guide(id) { return this.seed.guide.find((g) => g.id === id); },

  /** Checklist items for a list: seed items (with overrides) + custom ones, minus deleted. */
  items(listId) {
    const list = this.seed.lists.find((l) => l.id === listId);
    if (!list) return [];
    const out = [];
    for (const it of list.items) {
      const d = this.get('items', it.id);
      if (d?.deleted) continue;
      out.push({ ...it, listId, ...(d || {}), seed: true });
    }
    // seed items keep their v1 order; custom ones follow, oldest first
    const custom = this.list('items').filter((d) => d.custom && d.listId === listId)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const d of custom) out.push({ ...d, seed: false });
    return out;
  },
  listFor(guideId) { return this.seed.lists.find((l) => l.guide === guideId) || null; },
  progress(listId) {
    const items = this.items(listId);
    const done = items.filter((i) => i.done).length;
    return { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
  },

  /** Listened state for one episode/resource: { done, checkedBy, checkedAt }. */
  listened(id) { return this.get('resources', id) || {}; },
  listenProgress(episodes) {
    const done = episodes.filter((e) => this.listened(e.id).done).length;
    return { done, total: episodes.length, pct: episodes.length ? Math.round((done / episodes.length) * 100) : 0 };
  },

  notes() { return this.list('notes').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); },
  questions() { return this.list('questions').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); },

  exportJSON() {
    return JSON.stringify({
      app: 'baby-hightower', exportedAt: new Date().toISOString(), exportedBy: this.user,
      seedSource: this.seed.source, docs: [...this.docs.values()],
    }, null, 2);
  },
};
