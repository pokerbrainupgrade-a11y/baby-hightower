// Pure date math. Everything works on 'YYYY-MM-DD' strings and integer day
// numbers so the phone's local timezone never leaks in; "today" is resolved
// in America/Phoenix explicitly.
//
// The due date is a live anchor: config.js holds the default (May 11), and
// setDue() moves it when the household's Firestore setting changes. Weeks
// count from LMP exactly as v1 did (due = 40w1d), so a moved due date moves
// the LMP with it and every week-based number in the app follows.
import { LMP, DUE, TZ } from './config.js';

/** 'YYYY-MM-DD' -> integer day count (UTC-anchored, so no DST drift). */
export function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** integer day count -> 'YYYY-MM-DD' */
export function fromDayNumber(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return fromDayNumber(dayNumber(iso) + n);
}

// ---------- the anchor ----------
/** Days from LMP to the due date under the v1 convention (281 → due is 40w1d). */
export const DUE_OFFSET = dayNumber(DUE) - dayNumber(LMP);
const anchor = { due: DUE, lmp: LMP };

/** Move the due date (null/undefined → back to the config default). */
export function setDue(iso) {
  anchor.due = isISO(iso) ? iso : DUE;
  anchor.lmp = addDays(anchor.due, -DUE_OFFSET);
  return anchor.due;
}
export const currentDue = () => anchor.due;
export const currentLMP = () => anchor.lmp;
/** A real 'YYYY-MM-DD' (Date.UTC would happily roll '2027-13-40' over, so round-trip it). */
export const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromDayNumber(dayNumber(s)) === s;

/** Calendar date "now" in the given zone, as 'YYYY-MM-DD'. */
export function todayISO(now = new Date(), tz = TZ) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Gestational age on a date, counted from LMP (the v1 convention). */
export function gestation(iso, lmp = anchor.lmp) {
  const days = dayNumber(iso) - dayNumber(lmp);
  return { days, weeks: Math.floor(days / 7), day: ((days % 7) + 7) % 7 };
}

/** The calendar date of week W day D of the pregnancy. */
export function dateAt(weeks, day = 0, lmp = anchor.lmp) {
  return addDays(lmp, weeks * 7 + day);
}

/** Days from `iso` until the due date (negative once past). */
export function daysUntilDue(iso, due = anchor.due) {
  return dayNumber(due) - dayNumber(iso);
}

/** 1, 2 or 3 — T1 through 13w6d, T2 14w0d–27w6d, T3 from 28w0d. */
export function trimester(iso, lmp = anchor.lmp) {
  const w = gestation(iso, lmp).weeks;
  return w < 14 ? 1 : w < 28 ? 2 : 3;
}

export function formatGestation(g) {
  return `${g.weeks}w ${g.day}d`;
}

/** 'YYYY-MM-DD' -> 'Tue, Sep 16' (weekday optional) */
export function formatDate(iso, { weekday = true, year = false } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric',
    ...(weekday ? { weekday: 'short' } : {}), ...(year ? { year: 'numeric' } : {}),
  }).format(dt);
}

/** 'HH:MM' -> '3:30 PM' */
export function formatTime(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** epoch ms -> 'Sep 16, 3:42 PM' in Phoenix time */
export function formatStamp(ms, tz = TZ) {
  if (!ms) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

// ---------- estimates ----------
/**
 * A seed event's estimate → its calendar window under the current anchor.
 *   { kind: 'week', week, day, span?, pre? }  → moves with the due date
 *   { kind: 'fixed', date, span?, pre? }      → calendar-bound, never moves
 * Returns { from, to } ('YYYY-MM-DD'; to === from for a single day).
 */
export function estimateWindow(est) {
  const from = est.kind === 'fixed' ? est.date : dateAt(est.week, est.day);
  return { from, to: est.span ? addDays(from, est.span) : from };
}

/**
 * The v1-style date line, e.g. 'WED SEP 16 · WEEK 6', 'SEP 29 – OCT 19 · WEEKS 8–10',
 * 'FROM TUE OCT 13 · WEEK 10', 'BY SAT FEB 6'. Pass { time } for a confirmed time.
 */
export function windowLabel(from, to = from, { pre = '', week = true, time = '', caps = true } = {}) {
  const c = (t) => (caps ? t.toUpperCase() : t);
  const up = (iso, wd) => c(formatDate(iso, { weekday: wd }).replace(',', ''));
  const w1 = gestation(from).weeks, w2 = gestation(to === from ? to : addDays(to, -1)).weeks;
  let s;
  if (to === from) s = up(from, true);
  else if (from.slice(0, 7) === to.slice(0, 7)) s = `${up(from, false)}–${Number(to.slice(8))}`;   // NOV 13–15
  else s = `${up(from, false)} – ${up(to, false)}`;                                            // SEP 29 – OCT 19
  if (pre) s = `${c(pre)} ${s}`;
  if (week && w1 >= 0) s += w1 === w2 ? ` · ${c('week')} ${w1}` : ` · ${c('weeks')} ${w1}–${w2}`;
  if (time) s += ` · ${formatTime(time)}`;
  return s;
}

/** The headline numbers for the Today tab. */
export function summary(iso = todayISO()) {
  const g = gestation(iso);
  const left = daysUntilDue(iso);
  return {
    iso, g, left,
    due: anchor.due,
    trimester: trimester(iso),
    weeksLeft: Math.floor(Math.max(left, 0) / 7),
    pastDue: left < 0,
    dueToday: left === 0,
  };
}
