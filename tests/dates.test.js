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

// ---------- the growth card ----------
// Bug (1.4.0): the Today card picked the latest dev note dated on or before
// today, and the notes are sparse (weeks 6, 9, 15, 24, 33, 37), so from 7w0d
// to 8w6d it read "This week: about 6 weeks" under a 7w pill. The card now
// takes its week from summary() like the pill, and labels the note's range.
import { noteFor } from '../js/dates.js';
import { readFileSync } from 'node:fs';
const SEED = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const NOTES = SEED.trimesters.flatMap((t) => t.events).filter((e) => e.category === 'dev').map((e) => ({ week: e.est.week, title: e.title })).sort((a, b) => a.week - b.week);
const card = (iso) => { const s = summary(iso); return { pill: formatGestation(s.g), weekLabel: s.weekLabel, ...noteFor(s.g.weeks, NOTES) }; };

test('the six notes and the ranges each one is current for', () => {
  assert.deepEqual(NOTES.map((n) => n.week), [6, 9, 15, 24, 33, 37]);
  assert.deepEqual([6, 9, 15, 24, 33, 37].map((w) => noteFor(w, NOTES).label), ['Weeks 6–8', 'Weeks 9–14', 'Weeks 15–23', 'Weeks 24–32', 'Weeks 33–36', 'Weeks 37–40']);
  assert.equal(noteFor(5, NOTES), null);          // nothing before the first note — the card stays blank rather than guessing
  assert.equal(noteFor(41, NOTES).from, 37);      // past due still shows the last note
});

test('Sep 25, 2026 (Phoenix): pill 7w 4d and the card covers week 7', () => {
  const c = card('2026-09-25');
  assert.equal(c.pill, '7w 4d');
  assert.equal(c.weekLabel, '7');
  assert.ok(c.from <= 7 && 7 <= c.to, c.label);
  assert.equal(c.label, 'Weeks 6–8');
  assert.match(c.note.title, /^This week: about 6 weeks/);   // the v1 text, unchanged — the range label is what keeps it honest
});

test('the week boundary rolls the card: Sep 27 → 7w 6d, Sep 28 → 8w 0d', () => {
  assert.deepEqual([card('2026-09-27').pill, card('2026-09-27').weekLabel, card('2026-09-27').week], ['7w 6d', '7', 7]);
  assert.deepEqual([card('2026-09-28').pill, card('2026-09-28').weekLabel, card('2026-09-28').week], ['8w 0d', '8', 8]);
  // and the note itself rolls at the next note's week: 8w 6d still note 6, 9w 0d is note 9
  assert.equal(card('2026-10-04').from, 6);
  assert.equal(card('2026-10-04').pill, '8w 6d');
  assert.equal(card('2026-10-05').from, 9);
  assert.equal(card('2026-10-05').pill, '9w 0d');
  assert.match(card('2026-10-05').note.title, /^Week 9–10/);
});

test('anchors: Aug 3, 2026 → 0w 0d; May 11, 2027 → 40w 1d (281 days from LMP, the v1 convention)', () => {
  assert.equal(ga('2026-08-03'), '0w 0d');
  assert.equal(noteFor(gestation('2026-08-03').weeks, NOTES), null);
  // Naegele (LMP + 280) is May 10; the care team's May 11 is therefore 40w1d, and every
  // "WEEK N" label in the app is Nw1d. 40w0d would need LMP Aug 4 — not this app's anchor.
  assert.equal(ga('2027-05-11'), '40w 1d');
  assert.equal(ga('2027-05-10'), '40w 0d');
  assert.equal(summary('2027-05-11').weekLabel, '40+');
});

test('a Phoenix late evening does not roll the card to the next day early', () => {
  // 11:30 PM Sep 27 in Phoenix (UTC-7) is 06:30 UTC Sep 28 — still 7w 6d, not 8w 0d
  const late = new Date('2026-09-28T06:30:00Z');
  assert.equal(todayISO(late), '2026-09-27');
  assert.equal(card(todayISO(late)).pill, '7w 6d');
  assert.equal(card(todayISO(late)).week, 7);
  // midnight Phoenix = 07:00 UTC: now it's 8w 0d
  assert.equal(todayISO(new Date('2026-09-28T07:00:00Z')), '2026-09-28');
  assert.equal(card(todayISO(new Date('2026-09-28T07:00:00Z'))).week, 8);
});
