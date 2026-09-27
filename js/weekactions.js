// Pure logic for the "This week" action card. No DOM, no store
// (tests/weekactions.test.js). The week always comes in from dates.summary()
// — the same number the pill shows — so a due-date change moves this card
// with everything else. Seeds are plain logistics from the plan timeline.
import { dateAt, formatDate } from './dates.js';

export const CATEGORIES = ['Appointment', 'Decision', 'Purchase', 'Logistics', 'Class', 'Prep'];
export const SHOW = 3;          // items on the card before "show all"
export const LOOKAHEAD = 4;     // weeks in the expander
export const categoryOf = (a) => (CATEGORIES.includes(a?.category) ? a.category : 'Prep');
export const weekOf = (a) => (Number.isInteger(a?.week) && a.week >= 0 && a.week <= 45 ? a.week : null);

/** 'Mon, Oct 5 – Sun, Oct 11' — the calendar span of week W under the live anchor. */
export function weekRange(week) {
  return { from: dateAt(week, 0), to: dateAt(week, 6), label: `${formatDate(dateAt(week, 0))} – ${formatDate(dateAt(week, 6))}` };
}

/** Seed order, then custom items by creation; within a week, undone before done is NOT applied — checked items stay in place, struck. */
const byOrder = (a, b) => (weekOf(a) - weekOf(b)) || ((a.custom ? 1 : 0) - (b.custom ? 1 : 0)) || ((a.order ?? 0) - (b.order ?? 0)) || ((a.createdAt || 0) - (b.createdAt || 0));

/** Everything filed under week W. */
export const actionsFor = (all, week) => all.filter((a) => weekOf(a) === week).sort(byOrder);

/** The first item after week W (for an empty week), or null. */
export function nextAfter(all, week) {
  const later = all.filter((a) => weekOf(a) !== null && weekOf(a) > week).sort(byOrder);
  return later[0] || null;
}

/** Weeks W+1 … W+n that have anything, each with its items — for the expander. */
export function upcoming(all, week, n = LOOKAHEAD) {
  const out = [];
  for (let w = week + 1; w <= week + n; w++) {
    const items = actionsFor(all, w);
    if (items.length) out.push({ week: w, items });
  }
  return out;
}

/** 'decision:d-doula' → '#checklists/decisions' (the view opens that card) · 'list:gobag' → '#checklists/gobag' · 'visit:Ultrasound' → '#visits' */
export function linkHash(linkTo) {
  const [kind, id] = String(linkTo || '').split(':');
  if (kind === 'decision' && id) return `checklists/decisions`;
  if (kind === 'list' && id) return `checklists/${id}`;
  if (kind === 'visit') return 'visits';
  return null;
}
export const linkTarget = (linkTo) => { const [kind, id] = String(linkTo || '').split(':'); return { kind, id }; };
