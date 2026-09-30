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

/**
 * Questions seeded in 1.10.0 (Q's list after reading the Wombkeepers guide).
 * Content, like the seeded results: they show as Open with no doc behind
 * them, and only an action on one (asked, answered, dropped, deleted) writes
 * a `questions/<id>` doc. Fixed createdAt so they sort in this order.
 */
const Q_SEEDED_AT = Date.parse('2026-09-30T12:00:00-07:00');
export const SEED_QUESTIONS = [
  'Is Staci\'s Banner|Aetna plan specifically in network for the global fee, or only standard Aetna? Is HonorHealth Shea in network under it?',
  'Renewal Center facility fee — cash price, what insurance pays, and when we sign that financial form.',
  'Concierge fee — confirm our $1,000 deposit date and the balance due by week 32; payment-plan terms; will you issue a superbill?',
  'NIPT — can it be drawn at 10 weeks, or 11 at the earliest? Covered for Staci, or the $299 cash option? We want results before Nov 13.',
  'Which doula serves Renewal Center births, and can we meet her before labor?',
  'What moves a patient out of low-risk birth-center care, and at what point is that decided?',
  'Supplements — please check Fertility Support and the mushroom coffee labels against your avoid list (chaste tree berry, dong quai, ginseng, licorice, etc.).',
  'Air-travel note for the Illinois trip Mar 11–15, 2027 (week 31; PHX–Chicago, under 4 hours) — when should we request it?',
  'Heartburn list includes Zantac — what\'s the current recommendation, since ranitidine is off the US market?',
  'Postpartum annual — 6–8 weeks (p.33) or 7–10 weeks (p.5)?',
  'PWFA accommodation paperwork for State Farm — what do you need from us, and is the 2-week turnaround the same?',
  'Vaccines — we want the minimum, spread out. Walk us through flu, COVID, Tdap, RSV timing and what\'s optional.',
].map((text, i) => ({ id: `q-wk-${String(i + 1).padStart(2, '0')}`, text, status: 'to_ask', author: 'Q', createdAt: Q_SEEDED_AT + i, seed: true }));
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
/** Seeded name-only (the 1.10.0 ones also carry their guide page in `notes`); everything else is empty until someone fills it in. */
export const SEED_RESULTS = [
  { id: 'r-dating-ultrasound', name: 'Dating ultrasound', category: 'Ultrasound' },
  { id: 'r-t1-bloodwork', name: 'First trimester bloodwork', category: 'Bloodwork' },
  { id: 'r-nipt', name: 'NIPT (cell-free DNA)', category: 'Genetic screening' },
  { id: 'r-anatomy-scan', name: 'Anatomy scan', category: 'Ultrasound' },
  { id: 'r-glucose', name: 'Glucose screening', category: 'Bloodwork' },
  { id: 'r-gbs', name: 'Group B strep', category: 'Other' },
  // 1.10.0 — named in the Wombkeepers guide; name + page only
  { id: 'res-carrier', name: 'Recessive carrier screening', category: 'Genetic screening', notes: 'Per Wombkeepers guide p.6' },
  { id: 'res-nt', name: 'Nuchal translucency ultrasound', category: 'Ultrasound', notes: 'Per Wombkeepers guide p.6–7' },
  { id: 'res-afp', name: 'AFP bloodwork', category: 'Bloodwork', notes: 'Per Wombkeepers guide p.7' },
  { id: 'res-28wk-labs', name: '28-week bloodwork — HIV/anemia repeat', category: 'Bloodwork', notes: 'Per Wombkeepers guide p.7' },
  { id: 'res-blood-type', name: 'Blood type & Rh', category: 'Bloodwork', notes: 'Per Wombkeepers guide p.6' },
  { id: 'res-pap', name: 'Pap smear', category: 'Other', notes: 'Per Wombkeepers guide p.6' },
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
