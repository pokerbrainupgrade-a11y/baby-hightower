// Run: npm test  (node --test)
// Week math must be exact against LMP 2026-08-03 with due date 2027-05-11.
// The v1 companion counted weeks from LMP; every "WEEK N" label on the
// timeline is a Tuesday one day past a week boundary (Aug 3, 2026 is a Monday).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LMP, DUE } from '../js/config.js';
import { gestation, daysUntilDue, trimester, todayISO, addDays, dayNumber, formatGestation, summary, formatDate } from '../js/dates.js';

const ga = (iso) => formatGestation(gestation(iso));

test('anchors', () => {
  assert.equal(LMP, '2026-08-03');
  assert.equal(DUE, '2027-05-11');
  // Naegele's rule (LMP + 280d) lands on May 10; May 11 is what the care team
  // gave, so the due date is 40w1d by LMP counting. Both are pinned on purpose.
  assert.equal(dayNumber(DUE) - dayNumber(LMP), 281);
  assert.equal(addDays(LMP, 280), '2027-05-10');
});

test('gestational age matches the v1 timeline labels', () => {
  assert.equal(ga('2026-08-03'), '0w 0d');
  assert.equal(ga('2026-09-14'), '6w 0d');   // "This week: about 6 weeks"
  assert.equal(ga('2026-09-16'), '6w 2d');   // WED SEP 16 · WEEK 6
  assert.equal(ga('2026-10-13'), '10w 1d');  // WEEK 10
  assert.equal(ga('2026-11-03'), '13w 1d');  // WEEK 13 · first trimester complete
  assert.equal(ga('2026-11-13'), '14w 4d');  // WEEK 14
  assert.equal(ga('2026-11-26'), '16w 3d');  // WEEK 16
  assert.equal(ga('2026-12-22'), '20w 1d');  // WEEK 20 · halfway
  assert.equal(ga('2027-02-16'), '28w 1d');  // WEEK 28
  assert.equal(ga('2027-03-02'), '30w 1d');  // WEEK 30
  assert.equal(ga('2027-03-11'), '31w 3d');  // WEEK 31
  assert.equal(ga('2027-03-16'), '32w 1d');  // WEEK 32
  assert.equal(ga('2027-04-13'), '36w 1d');  // WEEK 36
  assert.equal(ga('2027-05-03'), '39w 0d');  // "Week 39 (May 3): full term"
  assert.equal(ga('2027-05-11'), '40w 1d');  // WEEK 40 · due date
});

test('trimester boundaries match the v1 guide', () => {
  // T1 through Nov 8 (wk 13) · T2 Nov 9 – Feb 15 (wks 14–27) · T3 Feb 16 → birth
  assert.equal(trimester('2026-11-08'), 1);
  assert.equal(ga('2026-11-08'), '13w 6d');
  assert.equal(trimester('2026-11-09'), 2);
  assert.equal(ga('2026-11-09'), '14w 0d');
  // By strict LMP counting 28w0d falls on Mon Feb 15 (v1 drew the T3 line at
  // Tue Feb 16, the week-28 timeline card). The app follows the math.
  assert.equal(trimester('2027-02-14'), 2);
  assert.equal(ga('2027-02-14'), '27w 6d');
  assert.equal(trimester('2027-02-15'), 3);
  assert.equal(ga('2027-02-15'), '28w 0d');
});

test('countdown to May 11', () => {
  assert.equal(daysUntilDue('2026-09-15'), 238);
  assert.equal(daysUntilDue('2027-05-10'), 1);
  assert.equal(daysUntilDue('2027-05-11'), 0);
  assert.equal(daysUntilDue('2027-05-12'), -1);
  const s = summary('2026-09-15');
  assert.deepEqual([s.g.weeks, s.g.day, s.left, s.weeksLeft, s.trimester], [6, 1, 238, 34, 1]);
  assert.equal(summary('2027-05-11').dueToday, true);
  assert.equal(summary('2027-05-12').pastDue, true);
});

test('"today" is resolved in America/Phoenix, not the device zone', () => {
  // 2026-09-16 06:30 UTC is still Sep 15 in Phoenix (UTC-7, no DST)
  assert.equal(todayISO(new Date('2026-09-16T06:30:00Z')), '2026-09-15');
  assert.equal(todayISO(new Date('2026-09-16T07:00:00Z')), '2026-09-16');
  // A Phoenix midnight in the depth of what would be DST elsewhere
  assert.equal(todayISO(new Date('2027-03-15T06:59:59Z')), '2027-03-14');
  assert.equal(todayISO(new Date('2027-03-15T07:00:00Z')), '2027-03-15');
});

test('day arithmetic has no DST drift', () => {
  // walk every day from LMP to due date; each step must be exactly one day
  let iso = LMP, n = 0;
  while (iso !== DUE) { iso = addDays(iso, 1); n++; }
  assert.equal(n, 281);
  assert.equal(formatDate('2026-09-16'), 'Wed, Sep 16');
});
