// In-memory state + write-through to IndexedDB, with an optional remote hook
// (sync.js) that mirrors every local write to Firestore. Last-write-wins per
// document via `updatedAt`.
//
// Document shape: { id: 'coll/key', coll, key, updatedAt, updatedBy, ...fields }
// Collections: events (per-timeline-event state: done, notes, confirmed
// date/time), items (checklist items), notes, questions, obcall (first-call
// checklist), resources (listened episodes), settings (the household's due
// date), visits (the visit log), results (results & labs — seeded records are
// content, only what's filled in becomes a doc), decisions (the Open Decisions
// Log mirror — seeded the same way; never deleted), symptoms (one doc per
// logged symptom), days (one doc per calendar day: sleep, mood, appetite),
// weekactions (done state on the "This week" seeds + items added by hand).
// Deletes are soft (`deleted: true`) so they replicate.
//
// Checklist *content* (the lists and their seed items) is not stored: it comes
// from data/seed.json plus data/lists.json and is merged in at boot. Only
// state (a tick, an edit, a custom item) becomes an `items/<id>` doc, so
// adding a list to the data files never touches what's already checked.
import * as db from './db.js';
import { DUE } from './config.js';
import { setDue, estimateWindow, trimester, isISO, todayISO } from './dates.js';
import { SEED_RESULTS, DATING_ULTRASOUND_ID, DEFAULT_PROVIDER, gestFor, statusForDate, statusPatch, isOpenQ, dueBanner, resultStatus } from './visits.js';
import { SEED_DECISIONS, DEC_STATUS, decStatus, closePatch } from './decisions.js';
import { stampFor, severityOf, rankTags, lastCompletedVisit, sinceVisit, daysSince } from './symptoms.js';
import { BUDGET_LISTS, DEFAULT_CEILING, SEED_COSTS, PURCHASERS, COVERAGE, DEFAULT_COVERAGE, parseMoney } from './budget.js';
import { CATEGORIES as WA_CATEGORIES, weekOf as waWeek } from './weekactions.js';

const IDENTITY_KEY = 'bh.identity';

export const store = {
  docs: new Map(),
  seed: null,
  lists: null,          // data/lists.json — the sectioned lists (Clothing, Nursery Essentials); merged into seed.lists
  resources: null,      // data/resources.json — the Resources tab's content
  symptoms: null,       // data/symptoms.json — the symptom tag set + moods (editable content, no copy attached)
  weekActions: null,    // data/week-actions.json — the "This week" seeds (plan logistics); state lives in `weekactions` docs
  wombkeepers: null,    // data/wombkeepers.json — provider content from the Wombkeepers guide; display only, never read into logic
  identity: null,       // { user: 'Q' | 'Staci', code: 'household-code' }
  remote: null,         // (doc) => Promise — set by sync.js when active
  listeners: new Set(),

  async init() {
    [this.seed, this.lists, this.resources, this.symptoms, this.weekActions, this.wombkeepers] = await Promise.all(
      ['./data/seed.json', './data/lists.json', './data/resources.json', './data/symptoms.json', './data/week-actions.json', './data/wombkeepers.json'].map((u) => fetch(u).then((r) => r.json())),
    );
    // v1 lists first, then the sectioned lists — ids are disjoint (tests/lists.test.js pins that)
    this.seed.lists = [...this.seed.lists, ...this.lists.lists];
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
  /** The "Baby is growing" notes as { week, title }, in week order (dev events are week-anchored). */
  devNotes() {
    return this.seed.trimesters.flatMap((t) => t.events)
      .filter((e) => e.category === 'dev' && e.est.kind === 'week')
      .map((e) => ({ id: e.id, week: e.est.week, title: e.title }))
      .sort((a, b) => a.week - b.week);
  },
  guide(id) { return this.seed.guide.find((g) => g.id === id); },

  /** Checklist items for a list: seed items (with overrides) + custom ones, minus deleted. */
  items(listId) {
    const list = this.seed.lists.find((l) => l.id === listId);
    if (!list) return [];
    const out = [];
    // A state doc's own `id` is 'items/<key>'; the item keeps its plain key as
    // `id` (that's what the checkbox writes back to), so the doc's id must not
    // win the spread — before 1.4.0 it did, and un-checking wrote a stray
    // 'items/items/<key>' doc while the tick stayed put.
    for (const it of list.items) {
      const d = this.get('items', it.id);
      if (d?.deleted) continue;
      // SEED_COSTS: cost fields seeded on a few existing items (the breast pump); any real entry wins
      out.push({ ...it, ...(SEED_COSTS[it.id] || {}), listId, ...(d || {}), id: it.id, seed: true });
    }
    // seed items keep their v1 order; custom ones follow, oldest first
    const custom = this.list('items').filter((d) => d.custom && d.listId === listId)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const d of custom) out.push({ ...d, id: d.key, seed: false });
    return out;
  },
  listFor(guideId) { return this.seed.lists.find((l) => l.guide === guideId) || null; },
  /** { done, total, pct } over any set of checkable things. */
  tally(items) {
    const done = items.filter((i) => i.done).length;
    return { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
  },
  /** List progress. "Skip" items are don't-buy guidance, so they don't count toward the total. */
  progress(listId) { return this.tally(this.items(listId).filter((i) => i.priority !== 'Skip')); },

  /** Listened state for one episode/resource: { done, checkedBy, checkedAt }. */
  listened(id) { return this.get('resources', id) || {}; },
  listenProgress(episodes) { return this.tally(episodes.map((e) => this.listened(e.id))); },

  notes() { return this.list('notes').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); },
  questions() { return this.list('questions').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); },
  /** Questions still waiting on a visit: Open or Asked (no status at all — pre-1.5.0 — counts as Open). */
  openQuestions() { return this.questions().filter(isOpenQ); },
  /** Questions attached to a visit (asked or answered there). */
  questionsForVisit(visitKey) { return this.questions().filter((q) => q.askedAtVisitId === visitKey); },

  // ---------- visits ----------
  visits() { return this.list('visits'); },
  visit(key) { const d = this.get('visits', key); return d && !d.deleted ? d : null; },
  /**
   * One tap: a visit for today, Prenatal, at the default provider. The
   * gestational age is stamped from the app's week math at save time and
   * stays on the record even if the due date later moves.
   */
  addVisit({ date = todayISO(), type = 'Prenatal', time = null } = {}) {
    const key = 'v-' + this.uid();
    return this.write('visits', key, {
      date, time, type, gest: gestFor(date), provider: DEFAULT_PROVIDER, seenBy: '', attendees: '',
      status: statusForDate(date, todayISO()),
      vitals: { weight: '', bloodPressure: '', fundalHeight: '', fetalHeartRate: '' },
      summary: '', nextSteps: '',
    }).then(() => key);
  },
  /** Merge a patch into a visit. A new date re-stamps the gestational age (that's the only time it changes). */
  saveVisit(key, patch) {
    const clean = {};
    for (const [k, v] of Object.entries(patch)) clean[k] = v === undefined ? null : v;
    if ('date' in clean) clean.gest = gestFor(clean.date);
    if ('vitals' in clean) clean.vitals = { ...(this.visit(key)?.vitals || {}), ...clean.vitals };
    return this.write('visits', key, clean);
  },

  // ---------- results & labs ----------
  /** The six seeded records (content) + anything filled in on them (state) + custom ones, minus deleted. */
  results() {
    const out = [];
    for (const r of SEED_RESULTS) {
      const d = this.get('results', r.id);
      if (d?.deleted) continue;
      out.push({ ...r, ...(d || {}), id: r.id, key: r.id, name: r.name, seed: true });
    }
    const custom = this.list('results').filter((d) => d.custom).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const d of custom) out.push({ ...d, id: d.key, seed: false });
    return out;
  },
  result(key) { return this.results().find((r) => r.key === key) || null; },
  resultsForVisit(visitKey) { return this.results().filter((r) => r.linkedVisitId === visitKey); },
  addResult({ name, category }) {
    const key = 'r-' + this.uid();
    return this.write('results', key, { custom: true, name, category, status: 'Not yet ordered', history: [] }).then(() => key);
  },
  saveResult(key, patch) {
    const clean = {};
    for (const [k, v] of Object.entries(patch)) clean[k] = v === undefined ? null : v;
    return this.write('results', key, clean);
  },
  /** Move a record to a status and add the line to its history (who, when). */
  setResultStatus(key, status) {
    const rec = this.result(key);
    if (!rec || resultStatus(rec) === status) return Promise.resolve(null);
    const patch = statusPatch(rec, status, this.user);
    return patch ? this.write('results', key, patch) : Promise.resolve(null);
  },

  // ---------- open decisions log ----------
  /** The eleven seeded decisions (content) + what's been typed on them (state) + custom ones. Nothing is ever removed. */
  decisions() {
    const out = [];
    for (const d of SEED_DECISIONS) out.push({ ...d, ...(this.get('decisions', d.id) || {}), id: d.id, key: d.id, title: d.title, seed: true });
    const custom = this.list('decisions').filter((d) => d.custom).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const d of custom) out.push({ ...d, id: d.key, seed: false });
    return out;
  },
  decision(key) { return this.decisions().find((d) => d.key === key) || null; },
  addDecision({ title, owner }) {
    const key = 'd-' + this.uid();
    return this.write('decisions', key, { custom: true, title, owner, status: 'Open' }).then(() => key);
  },
  /** Merge a patch; the target week is stored as an integer or null, and nothing is ever undefined. */
  saveDecision(key, patch) {
    const clean = {};
    for (const [k, v] of Object.entries(patch)) clean[k] = v === undefined ? null : v;
    if ('decideByWeek' in clean) { const w = parseInt(clean.decideByWeek, 10); clean.decideByWeek = Number.isInteger(w) && w >= 0 && w <= 45 ? w : null; }
    return this.write('decisions', key, clean);
  },
  /** Close with a recorded decision — refused (null) when the text is blank. */
  closeDecision(key, text) {
    const patch = closePatch(text, this.user);
    return patch ? this.write('decisions', key, patch) : Promise.resolve(null);
  },
  /** Move to a status. Closing this way needs a decision already on the record; leaving Closed clears the close stamp. */
  setDecisionStatus(key, status) {
    const d = this.decision(key);
    if (!d || !DEC_STATUS.includes(status) || decStatus(d) === status) return Promise.resolve(null);
    if (status === 'Closed') return this.closeDecision(key, d.decision);
    return this.write('decisions', key, { status, closedAt: null, closedBy: null });
  },

  // ---------- spend tracker ----------
  /** Every live item of the five budget lists, each tagged with its list id + title. */
  budgetItems() {
    const out = [];
    for (const id of BUDGET_LISTS) {
      const list = this.seed.lists.find((l) => l.id === id);
      if (!list) continue;
      for (const it of this.items(id)) out.push({ ...it, listTitle: list.title });
    }
    return out;
  },
  /** The household's ceiling: settings/budget if set (and sane), else the default. */
  get ceiling() {
    const c = this.get('settings', 'budget')?.ceiling;
    return typeof c === 'number' && c > 0 ? c : DEFAULT_CEILING;
  },
  get ceilingDoc() { return this.get('settings', 'budget') || null; },
  setCeiling(v) {
    const n = parseMoney(v);
    return this.write('settings', 'budget', { ceiling: n && n > 0 ? n : null, setBy: this.user, setAt: Date.now() });
  },
  /** Save an item's money fields, cleaned: amounts → numbers or null, dates checked, choices validated, no undefined. */
  saveItemCost(id, listId, patch) {
    const clean = { listId };
    if ('estimatedCost' in patch) clean.estimatedCost = parseMoney(patch.estimatedCost);
    if ('actualCost' in patch) clean.actualCost = parseMoney(patch.actualCost);
    if ('purchasedAt' in patch) clean.purchasedAt = isISO(patch.purchasedAt) ? patch.purchasedAt : null;
    if ('purchasedBy' in patch) clean.purchasedBy = PURCHASERS.includes(patch.purchasedBy) ? patch.purchasedBy : null;
    if ('coverage' in patch) clean.coverage = COVERAGE.includes(patch.coverage) ? patch.coverage : DEFAULT_COVERAGE;
    if ('vendor' in patch) clean.vendor = String(patch.vendor || '').trim() || null;
    if ('link' in patch) { const l = String(patch.link || '').trim(); clean.link = /^https?:\/\/\S+$/i.test(l) ? l : null; }
    return this.write('items', id, clean);
  },

  // ---------- "this week" actions ----------
  /** Seeds (content) with their done state merged in, plus custom items, minus deleted. */
  weekActionList() {
    const out = [];
    for (const [order, a] of (this.weekActions?.actions || []).entries()) {
      const d = this.get('weekactions', a.id);
      if (d?.deleted) continue;
      out.push({ ...a, order, ...(d || {}), id: a.id, key: a.id, week: a.week, title: a.title, seed: true });
    }
    for (const d of this.list('weekactions').filter((d) => d.custom)) out.push({ ...d, id: d.key, seed: false });
    return out;
  },
  setActionDone(id, done) { return this.write('weekactions', id, { done: !!done, doneBy: done ? this.user : null, doneAt: done ? Date.now() : null }); },
  addWeekAction({ week, title, category = 'Prep', detail = '' }) {
    const t = String(title || '').trim();
    const w = waWeek({ week: parseInt(week, 10) });
    if (!t || w === null) return Promise.resolve(null);
    const key = 'wa-' + this.uid();
    return this.write('weekactions', key, { custom: true, week: w, title: t, detail: String(detail || '').trim(), category: WA_CATEGORIES.includes(category) ? category : 'Prep', done: false }).then(() => key);
  },

  // ---------- symptom log ----------
  get symptomTags() { return this.symptoms?.tags || []; },
  /** Every logged symptom, newest first. */
  symptomList() { return this.list('symptoms').sort((a, b) => (b.at || 0) - (a.at || 0)); },
  symptom(key) { const d = this.get('symptoms', key); return d && !d.deleted ? d : null; },
  /**
   * Log one. The day and gestational week are stamped now (Phoenix) from the
   * app's week math and stay put if the due date later moves.
   */
  logSymptom({ type, severity = 2, note = '', now = Date.now() }) {
    const t = String(type || '').trim();
    if (!t) return Promise.resolve(null);
    const key = 's-' + this.uid();
    return this.write('symptoms', key, { type: t, severity: severityOf(severity), note: String(note || '').trim(), ...stampFor(now) }).then(() => key);
  },
  updateSymptom(key, { type, severity, note }) {
    const patch = {};
    if (type !== undefined) { const t = String(type || '').trim(); if (t) patch.type = t; }
    if (severity !== undefined) patch.severity = severityOf(severity);
    if (note !== undefined) patch.note = String(note || '').trim();
    return this.write('symptoms', key, patch);
  },
  /** The six tags for the quick row, by this user's own recent use. */
  quickTags(n) { return rankTags(this.symptomTags, this.list('symptoms'), this.user, { n }); },
  /** The day-level entry for 'YYYY-MM-DD' (sleepHours, mood, appetite), or {}. */
  dayEntry(day) { return this.get('days', day) || {}; },
  saveDay(day, patch) {
    const clean = {};
    for (const [k, v] of Object.entries(patch)) clean[k] = v === undefined ? null : v;
    if ('sleepHours' in clean) { const h = parseFloat(clean.sleepHours); clean.sleepHours = Number.isFinite(h) && h >= 0 && h <= 24 ? h : null; }
    if ('mood' in clean && !(this.symptoms?.moods || []).includes(clean.mood)) clean.mood = null;
    return this.write('days', day, clean);
  },
  lastCompletedVisit() { return lastCompletedVisit(this.visits()); },
  /** The waiting-room view: everything logged after the latest Completed visit, plus that window's day entries. */
  sinceLastVisit() {
    const r = sinceVisit(this.list('symptoms'), this.lastCompletedVisit());
    return { ...r, days: daysSince(this.list('days'), r.visit), tags: this.symptomTags };
  },

  // ---------- the due-date hook (dating ultrasound → app due date) ----------
  /** The Today banner, or null. Reads the dating ultrasound's confirmedDueDate against the live due date. */
  dueBanner() { return dueBanner(this.result(DATING_ULTRASOUND_ID)?.confirmedDueDate, this.due); },
  /**
   * Make the confirmed due date the app's due date. Stamps who/when/where it
   * came from on settings/due. Live week math re-anchors on the emit; nothing
   * already stored on a visit (its `gest`) is touched.
   */
  applyConfirmedDue() {
    const b = this.dueBanner();
    if (!b || b.applied) return Promise.resolve(null);
    return this.write('settings', 'due', { due: b.confirmed, source: 'dating-ultrasound', sourceKey: DATING_ULTRASOUND_ID, setBy: this.user, setAt: Date.now() });
  },
  /** Back to the config default (2027-05-11), stamped the same way. */
  revertDue() { return this.write('settings', 'due', { due: null, source: 'revert', sourceKey: null, setBy: this.user, setAt: Date.now() }); },

  exportJSON() {
    return JSON.stringify({
      app: 'baby-hightower', exportedAt: new Date().toISOString(), exportedBy: this.user,
      seedSource: this.seed.source, docs: [...this.docs.values()],
    }, null, 2);
  },
};
