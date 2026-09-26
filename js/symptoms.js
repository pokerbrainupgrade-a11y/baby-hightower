// Pure logic for the Symptom Log. No DOM, no store (tests/symptoms.test.js).
// A record, not an instrument: nothing here interprets, ranks, or flags.
// Counts, lists and grouped totals are the ceiling.
import { summary, todayISO, isISO, formatDate, formatClock } from './dates.js';

export const SEVERITY = { 1: 'Mild', 2: 'Moderate', 3: 'Rough' };
export const DEFAULT_SEVERITY = 2;
/** 1, 2 or 3 — anything else becomes the default. */
export const severityOf = (n) => (SEVERITY[n] ? Number(n) : DEFAULT_SEVERITY);
export const severityLabel = (n) => SEVERITY[severityOf(n)];
export const QUICK_COUNT = 6;
export const RECENT_DAYS = 30;

/** The day (America/Phoenix) and gestational stamp for an entry logged at `now` — the stamp never changes afterwards. */
export function stampFor(now = Date.now()) {
  const day = todayISO(new Date(now));
  const s = summary(day);
  return { day, at: now, gest: { weeks: s.g.weeks, day: s.g.day, due: s.due } };
}

/**
 * The quick-log row: the six tags this user has logged most in the last
 * 30 days, most-used first; ties and the rest fall back to the tag order.
 */
export function rankTags(tags, entries, user, { now = Date.now(), n = QUICK_COUNT, days = RECENT_DAYS } = {}) {
  const since = now - days * 86400000;
  const counts = new Map();
  for (const e of entries) {
    if (e.createdBy !== user || (e.at || 0) < since) continue;
    counts.set(e.type, (counts.get(e.type) || 0) + 1);
  }
  const order = new Map(tags.map((t, i) => [t, i]));
  const used = [...counts.keys()].filter((t) => order.has(t)).sort((a, b) => counts.get(b) - counts.get(a) || order.get(a) - order.get(b));
  const rest = tags.filter((t) => !counts.has(t));
  return [...used, ...rest].slice(0, n);
}

/** Newest first, then grouped by day (newest day first). */
export function byDay(entries) {
  const sorted = [...entries].sort((a, b) => (b.at || 0) - (a.at || 0));
  const groups = [];
  for (const e of sorted) {
    let g = groups[groups.length - 1];
    if (!g || g.day !== e.day) groups.push((g = { day: e.day, entries: [] }));
    g.entries.push(e);
  }
  return groups;
}

/**
 * The most recent Completed visit with a date — the one "since last visit"
 * keys off. Upcoming visits never count, whatever their date.
 */
export function lastCompletedVisit(visits) {
  return visits.filter((v) => v.status === 'Completed' && isISO(v.date))
    .sort((a, b) => (a.date === b.date ? (b.time || '') < (a.time || '') ? -1 : 1 : a.date < b.date ? 1 : -1))[0] || null;
}

/**
 * Everything logged after that visit. A visit with a time is the cutoff at
 * that time; one without counts from the start of its day, so a symptom
 * logged that evening is included. Without any completed visit: everything.
 */
export function sinceVisit(entries, visit) {
  if (!visit) return { visit: null, entries: [...entries].sort((a, b) => (b.at || 0) - (a.at || 0)) };
  const time = /^\d{2}:\d{2}$/.test(visit.time || '') ? visit.time : null;
  const keep = entries.filter((e) => e.day > visit.date || (e.day === visit.date && (!time || clock(e.at) > time)));
  return { visit, entries: keep.sort((a, b) => (b.at || 0) - (a.at || 0)) };
}
const clock = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Phoenix', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms || 0));

/** Grouped by tag: count, a count per severity, the entries — most-logged tag first, ties by tag order. */
export function byTag(entries, tags = []) {
  const order = new Map(tags.map((t, i) => [t, i]));
  const m = new Map();
  for (const e of entries) {
    let g = m.get(e.type);
    if (!g) m.set(e.type, (g = { type: e.type, count: 0, sev: { 1: 0, 2: 0, 3: 0 }, entries: [] }));
    g.count++; g.sev[severityOf(e.severity)]++; g.entries.push(e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99) || a.type.localeCompare(b.type));
}

/** Day entries (sleep / mood / appetite) that fall in the same window, newest first. */
export function daysSince(dayDocs, visit) {
  return dayDocs.filter((d) => isISO(d.key) && (!visit || d.key >= visit.date) && (d.sleepHours != null || d.mood || d.appetite))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** The plain-text version of the "since last visit" view — for a message or reading aloud. */
export function sinceText({ visit, entries, tags = [], days = [] }) {
  const lines = [];
  const n = entries.length, dayCount = new Set(entries.map((e) => e.day)).size;
  lines.push(visit
    ? `Since the ${formatDate(visit.date)} visit${visit.type ? ` (${visit.type})` : ''} — ${n} ${n === 1 ? 'entry' : 'entries'}${n ? ` over ${dayCount} ${dayCount === 1 ? 'day' : 'days'}` : ''}`
    : `All symptoms logged — ${n} ${n === 1 ? 'entry' : 'entries'}${n ? ` over ${dayCount} ${dayCount === 1 ? 'day' : 'days'}` : ''}`);
  for (const g of byTag(entries, tags)) {
    const parts = [1, 2, 3].filter((s) => g.sev[s]).map((s) => `${g.sev[s]} ${SEVERITY[s].toLowerCase()}`);
    lines.push(`${g.type} ×${g.count}${parts.length ? ` (${parts.join(', ')})` : ''}`);
    for (const e of g.entries) lines.push(`  ${formatDate(e.day, { weekday: false })} ${formatClock(e.at)} · ${severityLabel(e.severity)}${e.note ? ` · ${e.note}` : ''}`);
  }
  if (days.length) {
    lines.push('Day notes');
    for (const d of days) {
      const bits = [];
      if (d.sleepHours != null && d.sleepHours !== '') bits.push(`sleep ${d.sleepHours}h`);
      if (d.mood) bits.push(d.mood);
      if (d.appetite) bits.push(d.appetite);
      lines.push(`  ${formatDate(d.key, { weekday: false })} · ${bits.join(' · ')}`);
    }
  }
  return lines.join('\n');
}
