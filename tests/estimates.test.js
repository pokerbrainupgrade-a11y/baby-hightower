// Run: npm test  (node --test)
// Every timeline event carries an estimate that is either week-based (moves
// with the due date) or calendar-fixed. With the default due date the
// estimates must reproduce v1's hard-coded dates exactly; with a moved due
// date only the week-based ones move. Ids are pinned because confirmed dates
// in Firestore are keyed by them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DUE } from '../js/config.js';
import { setDue, currentDue, currentLMP, estimateWindow, windowLabel, gestation, formatGestation, addDays, summary, trimester, dateAt, formatTime, isISO } from '../js/dates.js';

const seed = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const events = seed.trimesters.flatMap((t) => t.events);

const IDS = [
  '2026-09-14-this-week-about-6-weeks-the-heart-has-ju', '2026-09-16-call-wombkeepers-book-the-first-visit',
  '2026-09-29-first-prenatal-visit-dating-ultrasound', '2026-10-05-week-9-10-every-major-organ-has-formed-f',
  '2026-10-13-nipt-blood-draw-screening-the-sex', '2026-11-01-pin-down-open-enrollment-both-employers',
  '2026-11-03-first-trimester-complete', '2026-11-13-wyoming-tell-staci-s-parents-in-person',
  '2026-11-20-weeks-16-22-staci-may-feel-the-first-mov', '2026-11-26-thanksgiving-tell-q-s-parents-az',
  '2026-12-01-book-the-anatomy-scan-class-series', '2026-12-08-anatomy-scan-the-big-one',
  '2026-12-22-halfway-decision-day', '2027-01-05-file-leave-paperwork-both-jobs', '2027-01-12-legal-block-done',
  '2027-01-19-glucose-screening', '2027-01-19-week-24-viability-milestone-week-26-eyes',
  '2027-02-01-shower-invites-out-registry-linked', '2027-02-16-third-trimester-visits-go-biweekly',
  '2027-03-02-pediatrician-locked-go-bag-shopping', '2027-03-11-illinois-baby-shower-saturday-mar-13',
  '2027-03-16-home-stretch-nursery-month', '2027-03-23-weeks-32-34-practicing-breathing-gaining',
  '2027-04-13-everything-ready', '2027-04-20-week-37-early-term-week-39-may-3-full-te', '2027-05-11-due-date',
];

test('event ids are stable (confirmed dates in Firestore are keyed by them)', () => {
  assert.deepEqual(events.map((e) => e.id), IDS);
});

test('every event has an estimate', () => {
  for (const e of events) {
    assert.ok(e.est && ['week', 'fixed'].includes(e.est.kind), e.id);
    if (e.est.kind === 'week') assert.ok(Number.isInteger(e.est.week) && e.est.day >= 0 && e.est.day < 7, e.id);
    else assert.ok(isISO(e.est.date), e.id);
  }
});

test('with the default due date, estimates reproduce the v1 dates', () => {
  setDue(null);
  assert.equal(currentDue(), DUE);
  for (const e of events) {
    const { from } = estimateWindow(e.est);
    // the one exception: "Shower invites out" was dated Feb 1 in v1 but its label says BY SAT FEB 6
    const expected = e.id === '2027-02-01-shower-invites-out-registry-linked' ? '2027-02-06' : e.date;
    assert.equal(from, expected, e.id);
  }
});

test('the v1 window ranges are preserved', () => {
  setDue(null);
  const win = (id) => estimateWindow(events.find((e) => e.id === id).est);
  assert.deepEqual(win('2026-09-29-first-prenatal-visit-dating-ultrasound'), { from: '2026-09-29', to: '2026-10-19' });
  assert.deepEqual(win('2026-12-08-anatomy-scan-the-big-one'), { from: '2026-12-08', to: '2027-01-11' });
  assert.deepEqual(win('2027-01-19-glucose-screening'), { from: '2027-01-19', to: '2027-02-15' });
  assert.deepEqual(win('2026-11-13-wyoming-tell-staci-s-parents-in-person'), { from: '2026-11-13', to: '2026-11-15' });
  assert.deepEqual(win('2027-03-11-illinois-baby-shower-saturday-mar-13'), { from: '2027-03-11', to: '2027-03-15' });
});

test('labels match the v1 wording', () => {
  setDue(null);
  const lbl = (id, opts) => { const e = events.find((x) => x.id === id); const w = estimateWindow(e.est); return windowLabel(w.from, w.to, { pre: e.est.pre, ...opts }); };
  assert.equal(lbl('2026-09-16-call-wombkeepers-book-the-first-visit'), 'WED SEP 16 · WEEK 6');
  assert.equal(lbl('2026-09-29-first-prenatal-visit-dating-ultrasound'), 'SEP 29 – OCT 19 · WEEKS 8–10');
  assert.equal(lbl('2026-10-13-nipt-blood-draw-screening-the-sex'), 'FROM TUE OCT 13 · WEEK 10');
  assert.equal(lbl('2026-11-13-wyoming-tell-staci-s-parents-in-person'), 'NOV 13–15 · WEEK 14');
  assert.equal(lbl('2026-11-26-thanksgiving-tell-q-s-parents-az'), 'THU NOV 26 · WEEK 16');
  assert.equal(lbl('2027-02-01-shower-invites-out-registry-linked', { week: false }), 'BY SAT FEB 6');
  assert.equal(lbl('2027-05-11-due-date'), 'TUE MAY 11 · WEEK 40');
  assert.equal(windowLabel('2026-09-29', '2026-09-29', { time: '10:30' }), 'TUE SEP 29 · WEEK 8 · 10:30 AM');
  assert.equal(formatTime('00:05'), '12:05 AM');
  assert.equal(formatTime('12:00'), '12:00 PM');
  assert.equal(formatTime('15:45'), '3:45 PM');
  assert.equal(formatTime(''), '');
});

test('moving the due date moves week-based estimates, not fixed ones', () => {
  setDue('2027-05-14'); // +3 days
  assert.equal(currentDue(), '2027-05-14');
  assert.equal(currentLMP(), '2026-08-06');
  assert.equal(formatGestation(gestation('2027-05-14')), '40w 1d');
  assert.equal(formatGestation(gestation('2026-09-19')), '6w 2d');       // was 6w 5d under May 11
  for (const e of events) {
    const { from, to } = estimateWindow(e.est);
    if (e.est.kind === 'week') {
      assert.equal(from, addDays(e.id.startsWith('2027-02-01') ? '2027-02-06' : e.date, 3), e.id);
      assert.equal(to, addDays(from, e.est.span || 0), e.id);
    } else {
      assert.equal(from, e.est.date, e.id);
    }
  }
  assert.equal(estimateWindow(events.at(-1).est).from, '2027-05-14'); // the due date card is the due date
  assert.equal(summary('2027-05-14').dueToday, true);
  assert.equal(summary('2027-05-14').due, '2027-05-14');
  // trimester boundaries shift with it
  assert.equal(trimester('2027-02-15'), 2);
  assert.equal(trimester('2027-02-18'), 3);
  assert.equal(dateAt(28, 1), '2027-02-19');
  // and back
  setDue(null);
  assert.equal(currentDue(), DUE);
  assert.equal(currentLMP(), '2026-08-03');
  assert.equal(formatGestation(gestation('2026-09-19')), '6w 5d');
});

test('garbage never becomes the due date', () => {
  setDue('not a date'); assert.equal(currentDue(), DUE);
  setDue('2027-13-40'); assert.equal(currentDue(), DUE);
  setDue(undefined); assert.equal(currentDue(), DUE);
  assert.equal(isISO('2027-05-11'), true);
  assert.equal(isISO('2027-5-11'), false);
});
