// Pure logic + seed content for the Open Decisions Log — a manual mirror of
// the decision layer in the master plan doc. No DOM, no store
// (tests/decisions.test.js). Seeds carry titles, owners and target weeks; the
// 1.10.0 ones also carry what the Wombkeepers guide settled, as `context`
// (shown only while the record's own context is empty). Everything else is
// typed in by hand. Nothing clinical lives here.
import { dateAt, isISO } from './dates.js';

export const OWNERS = ['Q', 'Staci', 'Both'];
export const DEC_STATUS = ['Open', 'Researching', 'Blocked', 'Closed'];
export const MIRROR_LINE = 'Mirrors the Open Decisions Log in the master plan doc. Update both.';

export const SEED_DECISIONS = [
  { id: 'd-insurance', title: 'Insurance / open-enrollment move', owner: 'Both', blockedBy: 'Banner|Aetna network confirmation (OB Q1); facility fee amount (OB Q2)',
    context: 'Wombkeepers in network: Aetna, BCBS, Cigna, UHC, Oscar. Birth center out of network with all major insurers. First-trimester labs ≈ $3,000, billed by Labcorp/Natera. Pregnancy spans 2026→2027 = two deductibles. Switching to a plan Wombkeepers doesn\'t accept can end care with them. (Guide p.2, 8, 21–22.)' },
  { id: 'd-screening', title: 'Screening scope', owner: 'Both' },
  { id: 'd-supplements', title: 'Supplement confirmation with provider', owner: 'Staci' },
  { id: 'd-doula', title: 'Doula (Wombkeepers in-house option)', owner: 'Both', decideByWeek: 20,
    context: 'Doula/labor support is included in the concierge fee; a specific doula can\'t be guaranteed (p.2, 21, 24–25). Decision is now: in-house doula vs. adding an outside one.' },
  { id: 'd-cord-blood', title: 'Cord blood / stem cell banking', owner: 'Both' },
  { id: 'd-childcare', title: 'Childcare after leave', owner: 'Both' },
  { id: 'd-shower-host', title: 'Shower host confirmation', owner: 'Q' },
  { id: 'd-az-mini-shower', title: 'Possible AZ mini-shower', owner: 'Both' },
  { id: 'd-guardianship', title: 'Guardianship choice', owner: 'Both' },
  { id: 'd-pediatrician', title: 'Pediatrician selection', owner: 'Both', decideByWeek: 30,
    context: 'Wombkeepers list with vaccine posture is in Resources → Wombkeepers → Pediatricians (p.18). Must be named on the birth plan.' },
  { id: 'd-leave', title: 'Leave sequencing', owner: 'Q' },
  { id: 'd-vaccines-prenatal', title: 'Prenatal vaccines (flu / COVID / Tdap / RSV)', owner: 'Both', decideByWeek: 28 },
  { id: 'd-circumcision', title: 'Circumcision (if boy) — $400 cash, at Renewal Center', owner: 'Both', decideByWeek: 30 },
];

/**
 * Seed values that were replaced in a later release. A stored field still
 * holding the old seed text was never really edited, so it reads as the new
 * seed; anything else typed there wins. Nothing is rewritten.
 */
export const RETIRED_SEED = { 'd-insurance': { blockedBy: 'Wombkeepers fee schedule and billing model' } };

/** A seed with its stored state merged in: the doc wins, except over an empty context or a retired seed value. */
export function mergeDecision(seed, doc = {}) {
  const out = { ...seed, ...doc, id: seed.id, key: seed.id, title: seed.title, seed: true };
  if (seed.context && !String(doc.context ?? '').trim()) out.context = seed.context;
  for (const [k, v] of Object.entries(RETIRED_SEED[seed.id] || {})) if (doc[k] === v) out[k] = seed[k];
  return out;
}

export const decStatus = (d) => (DEC_STATUS.includes(d?.status) ? d.status : 'Open');
export const decOwner = (d) => (OWNERS.includes(d?.owner) ? d.owner : 'Both');
/** A stored week is an integer 0–45 or nothing. */
export const weekOf = (d) => (Number.isInteger(d?.decideByWeek) && d.decideByWeek >= 0 && d.decideByWeek <= 45 ? d.decideByWeek : null);

/**
 * When a decision is due. A calendar date wins; otherwise the target week
 * resolves to its first day (Nw0d) under the live anchor — dates.dateAt, the
 * same function the timeline's week estimates use — so it moves if the due
 * date does. Null when neither is set.
 */
export function deadline(d) {
  if (isISO(d?.decideBy)) return { date: d.decideBy, week: null };
  const w = weekOf(d);
  return w === null ? null : { date: dateAt(w, 0), week: w };
}

/**
 * List order: Open with a deadline (nearest first) · Open, undated ·
 * Researching · Blocked · Closed (most recently closed first). Within the
 * Researching and Blocked groups a deadline still sorts first; ties keep
 * the seed / creation order via `index`.
 */
export function sortDecisions(list) {
  const rank = (d) => {
    const s = decStatus(d);
    if (s === 'Open') return deadline(d) ? 0 : 1;
    return { Researching: 2, Blocked: 3, Closed: 4 }[s];
  };
  return list.map((d, index) => ({ d, index, r: rank(d), dl: deadline(d)?.date || '' })).sort((a, b) => {
    if (a.r !== b.r) return a.r - b.r;
    if (a.r === 4) return (b.d.closedAt || 0) - (a.d.closedAt || 0);
    if (a.dl !== b.dl) { if (!a.dl) return 1; if (!b.dl) return -1; return a.dl < b.dl ? -1 : 1; }
    return a.index - b.index;
  }).map((x) => x.d);
}

/** Closing needs a recorded decision. Returns the patch, or null when the text is blank. */
export function closePatch(text, by, at = Date.now()) {
  const decision = String(text ?? '').trim();
  if (!decision) return null;
  return { status: 'Closed', decision, closedAt: at, closedBy: by };
}
