// Run: npm test  (node --test)
// "This week" action card: the pre-work check that the pill and the growing
// card agree on the week (date-pinned, America/Phoenix, across a month and
// the 2026→2027 boundary), the seeds, week lookups, the empty-week fallback,
// and that the card follows a due-date anchor change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DUE } from '../js/config.js';
import { setDue, summary, todayISO, noteFor, formatGestation } from '../js/dates.js';
import { CATEGORIES, SHOW, LOOKAHEAD, actionsFor, nextAfter, upcoming, weekRange, linkHash, categoryOf } from '../js/weekactions.js';
import { store } from '../js/store.js';

const DATA = JSON.parse(readFileSync(new URL('../data/week-actions.json', import.meta.url), 'utf8'));
const SEED = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const NOTES = SEED.trimesters.flatMap((t) => t.events).filter((e) => e.category === 'dev').map((e) => ({ week: e.est.week, title: e.title })).sort((a, b) => a.week - b.week);
const fresh = () => { store.docs = new Map(); store.identity = { user: 'Q', code: 'test' }; store.weekActions = DATA; setDue(null); };
store.write = async function (coll, key, patch) {
  const id = `${coll}/${key}`;
  const prev = this.docs.get(id) || { id, coll, key, createdAt: Date.now(), createdBy: this.user };
  const doc = { ...prev, ...patch, updatedAt: Date.now(), updatedBy: this.user };
  this.docs.set(id, doc);
  this.emit();
  return doc;
};
const phx = (iso, hhmm) => new Date(`${iso}T${hhmm}:00-07:00`);

// ---------- pre-work: the pill and the growing card read the same week ----------
// Today's view computes both from one summary(): the pill shows s.g.weeks and the
// card is noteFor(s.g.weeks). This pins that for dates on both sides of a month
// boundary and the year boundary, at Phoenix instants that are already the next
// day in UTC.
test('pill week == growing-card week, pinned across Sep→Oct and 2026→2027 in Phoenix', () => {
  setDue(null);
  const cases = [
    [phx('2026-09-30', '23:45'), '2026-09-30', 8],    // 06:45 UTC Oct 1 — still Sep 30 in Phoenix
    [phx('2026-10-01', '00:15'), '2026-10-01', 8],
    [phx('2026-10-31', '23:59'), '2026-10-31', 12],
    [phx('2026-11-01', '00:00'), '2026-11-01', 12],
    [phx('2026-12-31', '23:30'), '2026-12-31', 21],   // 06:30 UTC Jan 1
    [phx('2027-01-01', '00:30'), '2027-01-01', 21],
    [phx('2027-01-04', '09:00'), '2027-01-04', 22],   // the week rolls on the Monday
  ];
  for (const [now, day, week] of cases) {
    assert.equal(todayISO(now), day);
    const s = summary(todayISO(now));
    const pillWeek = s.weekLabel === '40+' ? 40 : Number(s.weekLabel);
    const card = noteFor(s.g.weeks, NOTES);
    assert.equal(s.g.weeks, week, day);
    assert.equal(pillWeek, s.g.weeks, `pill vs summary on ${day}`);
    assert.equal(card.week, s.g.weeks, `growing card vs pill on ${day}`);
    assert.ok(card.from <= s.g.weeks && s.g.weeks <= card.to, `card range covers the pill week on ${day}`);
  }
});

// ---------- seeds ----------
test('fourteen seeds from the plan timeline, nothing else on them', () => {
  const A = DATA.actions;
  assert.equal(A.length, 14);
  assert.deepEqual(A.map((a) => [a.week, a.title]), [
    [10, 'NIPT draw window opens'], [12, 'First trimester ends — announcement window opens'],
    [14, "Wyoming trip — tell Staci's parents"], [16, "Thanksgiving — tell Q's parents"], [16, 'Insurance / open-enrollment decision window opens'],
    [20, 'Anatomy scan'], [20, 'Doula decision due'], [28, 'Movement pattern awareness begins'],
    [30, 'Pediatrician selected'], [30, 'Birth preferences sheet drafted'], [31, 'Illinois shower'],
    [34, 'Go bag packed'], [36, 'Birth center orientation'], [36, 'Car seat installed'],
  ]);
  for (const a of A) {
    for (const k of Object.keys(a)) assert.ok(['id', 'week', 'title', 'detail', 'category', 'linkTo'].includes(k), `${a.id}: ${k}`);
    assert.ok(CATEGORIES.includes(a.category), a.id);
    assert.equal(categoryOf(a), a.category);
    assert.ok(!/should|feel|symptom|normal/i.test(a.title + ' ' + a.detail), `no clinical copy: ${a.id}`);
  }
  assert.equal(new Set(A.map((a) => a.id)).size, 14);
  assert.deepEqual(DATA.categories, ['Appointment', 'Decision', 'Purchase', 'Logistics', 'Class', 'Prep']);
  // the decision links
  assert.equal(A.find((a) => a.id === 'wa-20-doula').linkTo, 'decision:d-doula');
  assert.equal(A.find((a) => a.id === 'wa-30-pediatrician').linkTo, 'decision:d-pediatrician');
  assert.equal(A.find((a) => a.id === 'wa-16-insurance').linkTo, 'decision:d-insurance');
  assert.equal(linkHash('decision:d-doula'), 'checklists/decisions');
  assert.equal(linkHash('list:gobag'), 'checklists/gobag');
  assert.equal(linkHash('visit:Ultrasound'), 'visits');
  assert.equal(linkHash(''), null);
  assert.equal(SHOW, 3);
  assert.equal(LOOKAHEAD, 4);
});

test('week lookups: this week, the next item for an empty week, the four-week lookahead, the week range', () => {
  setDue(null);
  const A = DATA.actions;
  assert.deepEqual(actionsFor(A, 20).map((a) => a.id), ['wa-20-anatomy', 'wa-20-doula']);
  assert.deepEqual(actionsFor(A, 16).map((a) => a.id), ['wa-16-thanksgiving', 'wa-16-insurance']);
  assert.deepEqual(actionsFor(A, 7), []);
  assert.equal(nextAfter(A, 7).id, 'wa-10-nipt');
  assert.equal(nextAfter(A, 10).id, 'wa-12-t1-ends');
  assert.equal(nextAfter(A, 36), null);
  assert.deepEqual(upcoming(A, 8).map((g) => [g.week, g.items.length]), [[10, 1], [12, 1]]);   // weeks 9–12
  assert.deepEqual(upcoming(A, 12).map((g) => g.week), [14, 16]);
  assert.deepEqual(upcoming(A, 36), []);
  // week 20 is Mon Dec 21 – Sun Dec 27, 2026 under the default anchor
  assert.deepEqual(weekRange(20), { from: '2026-12-21', to: '2026-12-27', label: 'Mon, Dec 21 – Sun, Dec 27' });
  assert.equal(weekRange(21).from, '2026-12-28');
  assert.equal(weekRange(22).from, '2027-01-04');
});

test('the card follows the anchor: Dec 21, 2026 is week 20 by default and week 19 with the due date a week later', async () => {
  fresh();
  const A = store.weekActionList();
  let w = summary('2026-12-21').g.weeks;
  assert.equal(w, 20);
  assert.deepEqual(actionsFor(A, w).map((a) => a.title), ['Anatomy scan', 'Doula decision due']);
  await store.saveResult('r-dating-ultrasound', { confirmedDueDate: '2027-05-18' });
  await store.applyConfirmedDue();
  w = summary('2026-12-21').g.weeks;
  assert.equal(w, 19);
  assert.deepEqual(actionsFor(A, w), []);
  assert.equal(nextAfter(A, w).title, 'Anatomy scan');        // the empty-week fallback points at week 20
  assert.equal(weekRange(20).from, '2026-12-28');              // and week 20 now starts a week later
  assert.equal(summary('2026-12-28').g.weeks, 20);
  await store.revertDue();
  assert.equal(summary('2026-12-21').g.weeks, 20);
  setDue(null);
});
test('store: ticks sync-shaped with who/when, custom items land in their week, seeds untouched', async () => {
  fresh();
  assert.equal(store.weekActionList().length, 14);
  assert.equal(store.docs.size, 0);
  const d = await store.setActionDone('wa-20-doula', true);
  assert.deepEqual([d.done, d.doneBy, d.doneAt > 0], [true, 'Q', true]);
  let doula = store.weekActionList().find((a) => a.id === 'wa-20-doula');
  assert.equal(doula.done, true);
  assert.equal(doula.title, 'Doula decision due');   // content still from the seed
  assert.equal(doula.linkTo, 'decision:d-doula');
  await store.setActionDone('wa-20-doula', false);
  doula = store.weekActionList().find((a) => a.id === 'wa-20-doula');
  assert.deepEqual([doula.done, doula.doneBy, doula.doneAt], [false, null, null]);
  const k = await store.addWeekAction({ week: '20', title: '  Book the hotel  ', category: 'Nope' });
  const custom = store.weekActionList().find((a) => a.id === k);
  assert.deepEqual([custom.week, custom.title, custom.category, custom.custom, custom.seed], [20, 'Book the hotel', 'Prep', true, false]);
  assert.deepEqual(actionsFor(store.weekActionList(), 20).map((a) => a.title), ['Anatomy scan', 'Doula decision due', 'Book the hotel']);
  assert.equal(await store.addWeekAction({ week: 99, title: 'x' }), null);
  assert.equal(await store.addWeekAction({ week: 20, title: '   ' }), null);
});
