// Pure logic + seed content for the Visits tab (visit log) and its Results &
// Labs section. No DOM, no store — node-testable (tests/visits.test.js).
//
// Nothing in here is clinical: no ranges, no thresholds, no interpretation.
// Where a provider's guidance belongs, the record has an empty text field.
import { DUE } from './config.js';
import { summary, isISO, formatDate } from './dates.js';

// ---------- visits ----------
export const VISIT_TYPES = ['Prenatal', 'Ultrasound', 'Lab draw', 'Class', 'Other'];
export const VISIT_STATUS = ['Upcoming', 'Completed'];
export const DEFAULT_PROVIDER = 'Wombkeepers';
/** Free text, optional, never validated or compared. */
export const VITALS = [
  { key: 'weight', label: 'Weight' },
  { key: 'bloodPressure', label: 'Blood pressure' },
  { key: 'fundalHeight', label: 'Fundal height' },
  { key: 'fetalHeartRate', label: 'Fetal heart rate' },
];
export const visitType = (v) => (VISIT_TYPES.includes(v?.type) ? v.type : 'Other');
export const visitStatus = (v) => (v?.status === 'Completed' ? 'Completed' : 'Upcoming');

/**
 * Gestational age on a visit's date, from the app's one week-math source
 * (dates.summary — the same call the Today pill makes). Stored on the visit
 * at save time and never recomputed by a due-date change; `due` records the
 * anchor it was counted against so the record can say so.
 */
export function gestFor(date) {
  if (!isISO(date)) return null;
  const s = summary(date);
  return { weeks: s.g.weeks, day: s.g.day, due: s.due };
}
export const gestLabel = (g) => (g && Number.isInteger(g.weeks) ? `${g.weeks}w ${g.day}d` : '');

/** A new visit's status from its date: today or later is Upcoming. */
export const statusForDate = (date, today) => (isISO(date) && date < today ? 'Completed' : 'Upcoming');

/**
 * Split + order for the list view: Upcoming pinned on top (soonest first),
 * then everything else newest first. Undated records sort last in each group.
 */
export function sortVisits(list) {
  const byDate = (dir) => (a, b) => {
    const da = a.date || '', db = b.date || '';
    if (da !== db) { if (!da) return 1; if (!db) return -1; return da < db ? -dir : dir; }
    return (b.createdAt || 0) - (a.createdAt || 0);
  };
  return {
    upcoming: list.filter((v) => visitStatus(v) === 'Upcoming').sort(byDate(1)),
    past: list.filter((v) => visitStatus(v) !== 'Upcoming').sort(byDate(-1)),
  };
}

// ---------- OB questions (extended) ----------
// Stored values stay what they were before 1.5.0 (`to_ask` / `asked` /
// `answered`); `dropped` is new. A question with no status — every one written
// before 1.5.0 — reads as Open. Nothing is rewritten.
export const Q_STATUS = { to_ask: 'Open', asked: 'Asked', answered: 'Answered', dropped: 'No longer relevant' };
export const qStatus = (q) => (Q_STATUS[q?.status] ? q.status : 'to_ask');
export const qLabel = (q) => Q_STATUS[qStatus(q)];
/** Still on the list for a visit: Open or Asked. */
export const isOpenQ = (q) => { const s = qStatus(q); return s === 'to_ask' || s === 'asked'; };
export const Q_FILTERS = ['Open', 'Answered', 'All'];
export function qPasses(q, filter) {
  const s = qStatus(q);
  if (filter === 'Open') return s === 'to_ask' || s === 'asked';
  if (filter === 'Answered') return s === 'answered';
  return true;
}

// ---------- results & labs ----------
export const RESULT_CATEGORIES = ['Ultrasound', 'Bloodwork', 'Genetic screening', 'Other'];
export const RESULT_STATUS = ['Not yet ordered', 'Ordered', 'Scheduled', 'Sample taken', 'Resulted', 'Reviewed with provider'];
export const DATING_ULTRASOUND_ID = 'r-dating-ultrasound';
/** Seeded name-only; everything else on them is empty until someone fills it in. */
export const SEED_RESULTS = [
  { id: 'r-dating-ultrasound', name: 'Dating ultrasound', category: 'Ultrasound' },
  { id: 'r-t1-bloodwork', name: 'First trimester bloodwork', category: 'Bloodwork' },
  { id: 'r-nipt', name: 'NIPT (cell-free DNA)', category: 'Genetic screening' },
  { id: 'r-anatomy-scan', name: 'Anatomy scan', category: 'Ultrasound' },
  { id: 'r-glucose', name: 'Glucose screening', category: 'Bloodwork' },
  { id: 'r-gbs', name: 'Group B strep', category: 'Other' },
];
export const resultStatus = (r) => (RESULT_STATUS.includes(r?.status) ? r.status : RESULT_STATUS[0]);
export const resultCategory = (r) => (RESULT_CATEGORIES.includes(r?.category) ? r.category : 'Other');

/** The patch for a status change: the new status + one more line of history. Null for an unknown status. */
export function statusPatch(rec, status, by, at = Date.now()) {
  if (!RESULT_STATUS.includes(status)) return null;
  return { status, history: [...(rec?.history || []), { status, at, by }] };
}

// ---------- the due-date hook ----------
/**
 * What the Today banner says once the dating ultrasound has a confirmedDueDate.
 *   confirmed  the record's confirmedDueDate ('YYYY-MM-DD' or empty)
 *   appDue     the due date the app is running on (store.due)
 *   base       the config default (2027-05-11)
 * Returns null when there's nothing confirmed. Applying is always the user's
 * tap (confirm-gated in the view); this only decides what to offer.
 */
export function dueBanner(confirmed, appDue, base = DUE) {
  if (!isISO(confirmed)) return null;
  const fmt = (iso) => formatDate(iso, { weekday: false, year: true });
  const revised = confirmed !== base;
  const applied = appDue === confirmed;
  return {
    kind: revised ? 'revised' : 'confirmed',
    confirmed, base, applied,
    title: revised ? `Due date revised from ${fmt(base)} to ${fmt(confirmed)}` : `Due date confirmed as ${fmt(confirmed)}`,
    action: applied ? null : 'update',   // "Update app due date" — the one action
    revert: applied && revised,          // once applied, the way back to the default
  };
}
