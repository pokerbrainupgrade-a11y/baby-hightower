// Pure date math. Everything works on 'YYYY-MM-DD' strings and integer day
// numbers so the phone's local timezone never leaks in; "today" is resolved
// in America/Phoenix explicitly.
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

/** Calendar date "now" in the given zone, as 'YYYY-MM-DD'. */
export function todayISO(now = new Date(), tz = TZ) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Gestational age on a date, counted from LMP (the v1 convention). */
export function gestation(iso, lmp = LMP) {
  const days = dayNumber(iso) - dayNumber(lmp);
  return { days, weeks: Math.floor(days / 7), day: ((days % 7) + 7) % 7 };
}

/** Days from `iso` until the due date (negative once past). */
export function daysUntilDue(iso, due = DUE) {
  return dayNumber(due) - dayNumber(iso);
}

/** 1, 2 or 3 — T1 through 13w6d, T2 14w0d–27w6d, T3 from 28w0d. */
export function trimester(iso, lmp = LMP) {
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

/** epoch ms -> 'Sep 16, 3:42 PM' in Phoenix time */
export function formatStamp(ms, tz = TZ) {
  if (!ms) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

/** The headline numbers for the Today tab. */
export function summary(iso = todayISO()) {
  const g = gestation(iso);
  const left = daysUntilDue(iso);
  return {
    iso, g, left,
    trimester: trimester(iso),
    weeksLeft: Math.floor(Math.max(left, 0) / 7),
    pastDue: left < 0,
    dueToday: left === 0,
  };
}
