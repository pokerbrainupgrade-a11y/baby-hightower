// Run: npm test  (node --test)
// Visit log + results & labs: seeds, statuses, the gestational stamp on a
// visit, and the due-date hook — all pinned to America/Phoenix dates,
// including across the 2026 → 2027 boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUE, LMP } from '../js/config.js';
import { setDue, summary, todayISO, currentLMP, currentDue, formatGestation } from '../js/dates.js';
import {
  SEED_RESULTS, RESULT_STATUS, RESULT_CATEGORIES, DATING_ULTRASOUND_ID, VISIT_TYPES, VITALS,
  gestFor, gestLabel, statusForDate, sortVisits, statusPatch, dueBanner,
  qStatus, qLabel, isOpenQ, qPasses, resultStatus,
} from '../js/visits.js';
import { store } from '../js/store.js';

const REVISED = '2027-05-18';   // a week later than the default
const fresh = () => { store.docs = new Map(); store.identity = { user: 'Q', code: 'test' }; setDue(null); };
// The store's write() goes through IndexedDB; here it is the same merge + stamp, in memory.
store.write = async function (coll, key, patch) {
  const id = `${coll}/${key}`;
  const prev = this.docs.get(id) || { id, coll, key, createdAt: Date.now(), createdBy: this.user };
  const doc = { ...prev, ...patch, updatedAt: Date.now(), updatedBy: this.user };
  this.docs.set(id, doc);
  this.emit();
  return doc;
};

// ---------- seeds + vocab ----------
test('six results are seeded as "Not yet ordered", name only', () => {
  assert.deepEqual(SEED_RESULTS.map((r) => r.name), ['Dating ultrasound', 'First trimester bloodwork', 'NIPT (cell-free DNA)', 'Anatomy scan', 'Glucose screening', 'Group B strep']);
  for (const r of SEED_RESULTS) {
    assert.deepEqual(Object.keys(r).sort(), ['category', 'id', 'name']);   // no dates, no descriptions, no status text
    assert.ok(RESULT_CATEGORIES.includes(r.category));
    assert.equal(resultStatus(r), 'Not yet ordered');
  }
  assert.equal(new Set(SEED_RESULTS.map((r) => r.id)).size, 6);
  assert.equal(SEED_RESULTS[0].id, DATING_ULTRASOUND_ID);
  assert.deepEqual(RESULT_STATUS, ['Not yet ordered', 'Ordered', 'Scheduled', 'Sample taken', 'Resulted', 'Reviewed with provider']);
  assert.deepEqual(VISIT_TYPES, ['Prenatal', 'Ultrasound', 'Lab draw', 'Class', 'Other']);
  assert.deepEqual(VITALS.map((v) => v.key), ['weight', 'bloodPressure', 'fundalHeight', 'fetalHeartRate']);
});

test('seeded results are content: store.results() shows all six with no docs, and a doc only adds state', () => {
  fresh();
  assert.equal(store.results().length, 6);
  assert.equal(store.docs.size, 0);
  store.docs.set('results/r-nipt', { id: 'results/r-nipt', coll: 'results', key: 'r-nipt', status: 'Ordered', notes: 'x' });
  const nipt = store.result('r-nipt');
  assert.equal(nipt.name, 'NIPT (cell-free DNA)');   // name still from the seed
  assert.equal(nipt.status, 'Ordered');
  assert.equal(store.results().length, 6);
});

test('a status change appends to history with who and when; unknown statuses are refused', () => {
  const p1 = statusPatch({ history: [] }, 'Ordered', 'Q', 1000);
  assert.deepEqual(p1, { status: 'Ordered', history: [{ status: 'Ordered', at: 1000, by: 'Q' }] });
  const p2 = statusPatch(p1, 'Scheduled', 'Staci', 2000);
  assert.equal(p2.history.length, 2);
  assert.deepEqual(p2.history[1], { status: 'Scheduled', at: 2000, by: 'Staci' });
  assert.equal(statusPatch(p2, 'Normal', 'Q'), null);
});

test('question statuses: old docs read as Open, nothing else is assumed', () => {
  assert.equal(qStatus({ text: 'pre-1.5.0, no status' }), 'to_ask');
  assert.equal(qLabel({ status: 'to_ask' }), 'Open');
  assert.equal(qLabel({ status: 'asked' }), 'Asked');
  assert.equal(qLabel({ status: 'answered' }), 'Answered');
  assert.equal(qLabel({ status: 'dropped' }), 'No longer relevant');
  assert.equal(qLabel({ status: 'weird' }), 'Open');
  assert.deepEqual([{ status: 'to_ask' }, { status: 'asked' }, { status: 'answered' }, { status: 'dropped' }, {}].map(isOpenQ), [true, true, false, false, true]);
  const qs = [{ status: 'to_ask' }, { status: 'asked' }, { status: 'answered' }, { status: 'dropped' }];
  assert.deepEqual(qs.map((q) => qPasses(q, 'Open')), [true, true, false, false]);
  assert.deepEqual(qs.map((q) => qPasses(q, 'Answered')), [false, false, true, false]);
  assert.deepEqual(qs.map((q) => qPasses(q, 'All')), [true, true, true, true]);
});

test('visit list order: Upcoming pinned (soonest first), then newest first', () => {
  const { upcoming, past } = sortVisits([
    { key: 'a', date: '2026-10-06', status: 'Completed' },
    { key: 'b', date: '2026-11-03', status: 'Upcoming' },
    { key: 'c', date: '2026-09-16', status: 'Completed' },
    { key: 'd', date: '2026-10-20', status: 'Upcoming' },
    { key: 'e', date: '', status: 'Upcoming' },
  ]);
  assert.deepEqual(upcoming.map((v) => v.key), ['d', 'b', 'e']);
  assert.deepEqual(past.map((v) => v.key), ['a', 'c']);
  assert.equal(statusForDate('2026-09-26', '2026-09-26'), 'Upcoming');
  assert.equal(statusForDate('2026-09-25', '2026-09-26'), 'Completed');
  assert.equal(statusForDate('', '2026-09-26'), 'Upcoming');
});

// ---------- the gestational stamp comes from summary() ----------
test('gestFor uses the same week math as the Today pill', () => {
  setDue(null);
  assert.deepEqual(gestFor('2026-09-25'), { weeks: 7, day: 4, due: DUE });
  assert.equal(gestLabel(gestFor('2026-09-25')), '7w 4d');
  assert.equal(gestLabel(gestFor('2026-09-25')), formatGestation(summary('2026-09-25').g));
  assert.equal(gestFor(''), null);
  assert.equal(gestFor('2026-13-40'), null);
});

// ---------- the due-date hook ----------
test('banner: nothing confirmed → no banner', () => {
  assert.equal(dueBanner('', DUE), null);
  assert.equal(dueBanner(undefined, DUE), null);
  assert.equal(dueBanner('not a date', DUE), null);
});

test('banner: confirmed as the default → "confirmed", no action while the app already matches', () => {
  const b = dueBanner(DUE, DUE);
  assert.equal(b.kind, 'confirmed');
  assert.equal(b.title, 'Due date confirmed as May 11, 2027');
  assert.equal(b.action, null);
  assert.equal(b.revert, false);
  // …but if Settings had moved the app off the default, the one action brings it back
  const b2 = dueBanner(DUE, REVISED);
  assert.equal(b2.action, 'update');
  assert.equal(b2.revert, false);
});

test('banner: revised → offers "Update app due date"; once applied, offers the way back', () => {
  const b = dueBanner(REVISED, DUE);
  assert.equal(b.kind, 'revised');
  assert.equal(b.title, 'Due date revised from May 11, 2027 to May 18, 2027');
  assert.equal(b.action, 'update');
  assert.equal(b.applied, false);
  const applied = dueBanner(REVISED, REVISED);
  assert.equal(applied.action, null);
  assert.equal(applied.applied, true);
  assert.equal(applied.revert, true);
});

test('Phoenix, across New Year: applying the confirmed due date re-derives live weeks but leaves stored visits alone', async () => {
  fresh();
  // A late Phoenix evening on Dec 31, 2026 is already Jan 1 in UTC — "today" must still be Dec 31.
  const lateNYE = new Date('2027-01-01T06:59:59Z');
  assert.equal(todayISO(lateNYE), '2026-12-31');
  assert.equal(todayISO(new Date('2027-01-01T07:00:00Z')), '2027-01-01');

  // A visit logged that evening, under the default due date
  const key = await store.addVisit({ date: todayISO(lateNYE), type: 'Prenatal' });
  const before = store.visit(key);
  assert.deepEqual(before.gest, { weeks: 21, day: 3, due: DUE });
  assert.equal(before.provider, 'Wombkeepers');
  assert.equal(before.status, 'Upcoming');   // status is judged against the real today (Sep 2026); Dec 31 is still ahead
  assert.equal(formatGestation(summary('2026-12-31').g), '21w 3d');
  assert.equal(formatGestation(summary('2027-01-01').g), '21w 4d');

  // The dating ultrasound comes back with May 18 — recorded on the result, nothing moves yet
  await store.saveResult(DATING_ULTRASOUND_ID, { confirmedDueDate: REVISED, confirmedDueBy: 'Staci', confirmedDueAt: 1 });
  assert.equal(store.due, DUE);
  assert.equal(store.dueBanner().action, 'update');
  assert.equal(formatGestation(summary('2027-01-01').g), '21w 4d');

  // The one action, taken: who + when + where from are on settings/due
  const doc = await store.applyConfirmedDue();
  assert.equal(doc.due, REVISED);
  assert.equal(doc.setBy, 'Q');
  assert.ok(doc.setAt > 0);
  assert.equal(doc.source, 'dating-ultrasound');
  assert.equal(store.due, REVISED);
  assert.equal(currentDue(), REVISED);
  assert.equal(currentLMP(), '2026-08-10');   // due stays 40w1d, so the LMP moved a week too

  // Live math follows on both sides of the year boundary…
  assert.equal(formatGestation(summary('2026-12-31').g), '20w 3d');
  assert.equal(formatGestation(summary('2027-01-01').g), '20w 4d');
  assert.equal(summary('2027-01-01').left, 137);
  assert.equal(store.dueBanner().action, null);
  assert.equal(store.dueBanner().revert, true);

  // …but the visit keeps the weeks it was stamped with, and says what it was counted against
  const after = store.visit(key);
  assert.deepEqual(after.gest, { weeks: 21, day: 3, due: DUE });
  assert.equal(after.updatedAt, before.updatedAt);   // the visit doc was not even touched

  // A visit logged after the change is stamped against the new anchor
  const k2 = await store.addVisit({ date: '2027-01-01', type: 'Ultrasound' });
  assert.deepEqual(store.visit(k2).gest, { weeks: 20, day: 4, due: REVISED });

  // Reversible: back to May 11, stamped the same way; old stamps still untouched
  const rev = await store.revertDue();
  assert.equal(rev.due, null);
  assert.equal(rev.source, 'revert');
  assert.equal(rev.setBy, 'Q');
  assert.equal(store.due, DUE);
  assert.equal(currentLMP(), LMP);
  assert.equal(formatGestation(summary('2027-01-01').g), '21w 4d');
  assert.deepEqual(store.visit(key).gest, { weeks: 21, day: 3, due: DUE });
  assert.deepEqual(store.visit(k2).gest, { weeks: 20, day: 4, due: REVISED });
  assert.equal(store.dueBanner().action, 'update');   // the banner offers the update again
  setDue(null);
});

test('an earlier confirmed date (May 4) across the boundary, and a second apply is a no-op', async () => {
  fresh();
  const EARLY = '2027-05-04';
  const key = await store.addVisit({ date: '2026-12-29' });
  assert.equal(gestLabel(store.visit(key).gest), '21w 1d');
  await store.saveResult(DATING_ULTRASOUND_ID, { confirmedDueDate: EARLY });
  assert.equal(store.dueBanner().title, 'Due date revised from May 11, 2027 to May 4, 2027');
  await store.applyConfirmedDue();
  assert.equal(currentLMP(), '2026-07-27');
  assert.equal(formatGestation(summary('2026-12-31').g), '22w 3d');
  assert.equal(formatGestation(summary('2027-01-01').g), '22w 4d');
  assert.equal(summary('2027-05-04').dueToday, true);
  assert.equal(gestLabel(store.visit(key).gest), '21w 1d');
  assert.equal(await store.applyConfirmedDue(), null);   // already applied — nothing written
  // re-dating the visit itself is the only thing that re-stamps it, and it uses the live anchor
  await store.saveVisit(key, { date: '2026-12-29' });
  assert.deepEqual(store.visit(key).gest, { weeks: 22, day: 1, due: EARLY });
  setDue(null);
});

test('clearing the confirmed date removes the banner but leaves the app due date where it is', async () => {
  fresh();
  await store.saveResult(DATING_ULTRASOUND_ID, { confirmedDueDate: REVISED });
  await store.applyConfirmedDue();
  await store.saveResult(DATING_ULTRASOUND_ID, { confirmedDueDate: null });
  assert.equal(store.dueBanner(), null);
  assert.equal(store.due, REVISED);   // Settings → Reset (or the record again) is the way back
  setDue(null);
});

test('saveVisit never writes undefined (Firestore rejects it) and merges vitals', async () => {
  fresh();
  const key = await store.addVisit({ date: '2026-10-06' });
  await store.saveVisit(key, { vitals: { weight: '140' } });
  await store.saveVisit(key, { vitals: { bloodPressure: '110/70' }, seenBy: undefined });
  const v = store.visit(key);
  assert.deepEqual(v.vitals, { weight: '140', bloodPressure: '110/70', fundalHeight: '', fetalHeartRate: '' });
  assert.equal(v.seenBy, null);
  assert.ok(!Object.values(v).includes(undefined));
});
