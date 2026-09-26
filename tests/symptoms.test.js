// Run: npm test  (node --test)
// Symptom log: the tag set, the Phoenix day + week stamp, the quick row's
// ordering, "since last visit" keyed off the latest Completed visit, and the
// plain-text copy. Nothing here interprets anything — it counts and lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DUE } from '../js/config.js';
import { setDue, todayISO, summary, formatGestation } from '../js/dates.js';
import { SEVERITY, severityOf, severityLabel, stampFor, rankTags, byDay, byTag, lastCompletedVisit, sinceVisit, daysSince, sinceText } from '../js/symptoms.js';
import { store } from '../js/store.js';

const DATA = JSON.parse(readFileSync(new URL('../data/symptoms.json', import.meta.url), 'utf8'));
const TAGS = DATA.tags;
const fresh = () => { store.docs = new Map(); store.identity = { user: 'Staci', code: 'test' }; store.symptoms = DATA; store.seed = { source: 'test' }; setDue(null); };
store.write = async function (coll, key, patch) {
  const id = `${coll}/${key}`;
  const prev = this.docs.get(id) || { id, coll, key, createdAt: Date.now(), createdBy: this.user };
  const doc = { ...prev, ...patch, updatedAt: Date.now(), updatedBy: this.user };
  this.docs.set(id, doc);
  this.emit();
  return doc;
};
// Phoenix instants (UTC-7, no DST)
const phx = (iso, hhmm) => Date.parse(`${iso}T${hhmm}:00-07:00`);

test('the tag set is the fifteen agreed tags, in order, with nothing attached to them', () => {
  assert.deepEqual(TAGS, ['Nausea', 'Vomiting', 'Fatigue', 'Headache', 'Cramping', 'Back pain', 'Heartburn', 'Dizziness', 'Food aversion', 'Food craving', 'Constipation', 'Insomnia', 'Braxton Hicks', 'Swelling', 'Other']);
  assert.deepEqual(Object.keys(DATA), ['tags', 'moods']);   // strings only — no copy, no descriptions
  assert.deepEqual(DATA.moods, ['Low', 'Okay', 'Good']);
  assert.deepEqual(SEVERITY, { 1: 'Mild', 2: 'Moderate', 3: 'Rough' });
  assert.deepEqual([0, 1, 2, 3, 4, 10, '3', 'x', undefined].map(severityOf), [2, 1, 2, 3, 2, 2, 3, 2, 2]);
  assert.equal(severityLabel(7), 'Moderate');
});

test('an entry is stamped with its Phoenix day and the week from summary(); a late evening stays on its day', () => {
  setDue(null);
  const late = phx('2026-12-31', '23:30');   // 06:30 UTC Jan 1
  assert.equal(todayISO(new Date(late)), '2026-12-31');
  const s = stampFor(late);
  assert.equal(s.day, '2026-12-31');
  assert.deepEqual(s.gest, { weeks: 21, day: 3, due: DUE });
  assert.equal(`${s.gest.weeks}w ${s.gest.day}d`, formatGestation(summary('2026-12-31').g));
  const s2 = stampFor(phx('2027-01-01', '00:10'));
  assert.equal(s2.day, '2027-01-01');
  assert.deepEqual(s2.gest, { weeks: 21, day: 4, due: DUE });
});

test('the stamp is historical: moving the due date changes live weeks, not logged entries', async () => {
  fresh();
  const k = await store.logSymptom({ type: 'Nausea', now: phx('2026-12-31', '23:30') });
  assert.deepEqual(store.symptom(k).gest, { weeks: 21, day: 3, due: DUE });
  assert.equal(store.symptom(k).day, '2026-12-31');
  assert.equal(store.symptom(k).severity, 2);
  await store.saveResult('r-dating-ultrasound', { confirmedDueDate: '2027-05-18' });
  await store.applyConfirmedDue();
  assert.equal(formatGestation(summary('2026-12-31').g), '20w 3d');
  assert.deepEqual(store.symptom(k).gest, { weeks: 21, day: 3, due: DUE });
  const k2 = await store.logSymptom({ type: 'Fatigue', severity: 3, note: '  late  ', now: phx('2027-01-01', '07:00') });
  assert.deepEqual(store.symptom(k2).gest, { weeks: 20, day: 4, due: '2027-05-18' });
  assert.equal(store.symptom(k2).note, 'late');
  assert.equal(store.symptom(k2).createdBy, 'Staci');
  assert.equal(await store.logSymptom({ type: '   ' }), null);
  setDue(null);
});

test('quick row: this user\'s most-logged tags in the last 30 days first, the rest in tag order, six total', () => {
  const now = phx('2026-10-10', '12:00');
  const e = (type, by, daysAgo) => ({ type, createdBy: by, at: now - daysAgo * 86400000 });
  const entries = [
    e('Fatigue', 'Staci', 1), e('Fatigue', 'Staci', 2), e('Fatigue', 'Staci', 3),
    e('Heartburn', 'Staci', 1), e('Heartburn', 'Staci', 5),
    e('Nausea', 'Staci', 2),
    e('Swelling', 'Staci', 40),          // too old
    e('Cramping', 'Q', 1), e('Cramping', 'Q', 1), e('Cramping', 'Q', 1),   // someone else's
  ];
  assert.deepEqual(rankTags(TAGS, entries, 'Staci', { now }), ['Fatigue', 'Heartburn', 'Nausea', 'Vomiting', 'Headache', 'Cramping']);
  assert.deepEqual(rankTags(TAGS, entries, 'Q', { now }), ['Cramping', 'Nausea', 'Vomiting', 'Fatigue', 'Headache', 'Back pain']);
  assert.deepEqual(rankTags(TAGS, [], 'Staci', { now }), TAGS.slice(0, 6));
  // a free-text type never takes a slot in the row
  assert.equal(rankTags(TAGS, [e('sore hips', 'Staci', 1)], 'Staci', { now }).includes('sore hips'), false);
});

test('"since last visit" keys off the latest Completed visit, never an Upcoming one', () => {
  const visits = [
    { key: 'a', date: '2026-09-16', status: 'Completed' },
    { key: 'b', date: '2026-10-06', status: 'Completed', time: '10:30', type: 'Prenatal' },
    { key: 'c', date: '2026-11-03', status: 'Upcoming' },    // later, but not yet happened
    { key: 'd', date: '', status: 'Completed' },              // undated
  ];
  assert.equal(lastCompletedVisit(visits).key, 'b');
  assert.equal(lastCompletedVisit(visits.filter((v) => v.status !== 'Completed')), null);
  const at = (iso, hhmm) => ({ day: iso, at: phx(iso, hhmm), type: 'Nausea' });
  const entries = [at('2026-10-05', '09:00'), at('2026-10-06', '08:00'), at('2026-10-06', '11:00'), at('2026-10-07', '07:00')];
  // a timed visit: same-day entries after 10:30 count, earlier ones don't
  assert.deepEqual(sinceVisit(entries, visits[1]).entries.map((e) => e.at), [entries[3].at, entries[2].at]);
  // an untimed visit counts from the start of its day
  assert.equal(sinceVisit(entries, { date: '2026-10-06', status: 'Completed' }).entries.length, 3);
  // no completed visit at all: everything, newest first
  assert.equal(sinceVisit(entries, null).entries.length, 4);
  assert.equal(sinceVisit(entries, null).visit, null);
});

test('grouping: by day (newest first) and by tag (most logged first, ties by tag order) with counts per severity', () => {
  const e = (day, hhmm, type, severity) => ({ key: `${day}${hhmm}`, day, at: phx(day, hhmm), type, severity });
  const entries = [e('2026-10-06', '08:00', 'Nausea', 3), e('2026-10-07', '07:00', 'Fatigue', 1), e('2026-10-06', '21:00', 'Nausea', 2), e('2026-10-07', '09:00', 'Nausea', 2), e('2026-10-05', '12:00', 'Headache', 2)];
  const days = byDay(entries);
  assert.deepEqual(days.map((g) => [g.day, g.entries.length]), [['2026-10-07', 2], ['2026-10-06', 2], ['2026-10-05', 1]]);
  assert.deepEqual(days[0].entries.map((x) => x.key), ['2026-10-0709:00', '2026-10-0707:00']);
  const tags = byTag(entries, TAGS);
  assert.deepEqual(tags.map((g) => [g.type, g.count]), [['Nausea', 3], ['Fatigue', 1], ['Headache', 1]]);
  assert.deepEqual(tags[0].sev, { 1: 0, 2: 2, 3: 1 });
});

test('the copy text: a header, one line per tag with counts, the entries, then the day notes', () => {
  const visit = { date: '2026-10-06', type: 'Prenatal', status: 'Completed' };
  const entries = [
    { day: '2026-10-07', at: phx('2026-10-07', '08:10'), type: 'Nausea', severity: 3, note: 'after breakfast' },
    { day: '2026-10-08', at: phx('2026-10-08', '21:00'), type: 'Nausea', severity: 2 },
    { day: '2026-10-08', at: phx('2026-10-08', '22:30'), type: 'Insomnia', severity: 1 },
  ];
  const days = [{ key: '2026-10-08', sleepHours: 5.5, mood: 'Low', appetite: 'no eggs' }, { key: '2026-10-07', mood: 'Okay' }];
  assert.equal(sinceText({ visit, entries: sinceVisit(entries, visit).entries, tags: TAGS, days }), [
    'Since the Tue, Oct 6 visit (Prenatal) — 3 entries over 2 days',
    'Nausea ×2 (1 moderate, 1 rough)',
    '  Oct 8 9:00 PM · Moderate',
    '  Oct 7 8:10 AM · Rough · after breakfast',
    'Insomnia ×1 (1 mild)',
    '  Oct 8 10:30 PM · Mild',
    'Day notes',
    '  Oct 8 · sleep 5.5h · Low · no eggs',
    '  Oct 7 · Okay',
  ].join('\n'));
  assert.equal(sinceText({ visit: null, entries: [], tags: TAGS, days: [] }), 'All symptoms logged — 0 entries');
});

test('store: since-last-visit end to end, day entries validated, delete is soft and undoable', async () => {
  fresh();
  const v1 = await store.addVisit({ date: '2026-09-16' }); await store.saveVisit(v1, { status: 'Completed' });
  const v2 = await store.addVisit({ date: '2026-10-06', time: '10:30' }); await store.saveVisit(v2, { status: 'Completed' });
  await store.addVisit({ date: '2026-11-03' });   // Upcoming
  await store.logSymptom({ type: 'Nausea', now: phx('2026-10-06', '09:00') });
  const k = await store.logSymptom({ type: 'Nausea', severity: 3, now: phx('2026-10-06', '14:00') });
  await store.logSymptom({ type: 'Headache', now: phx('2026-10-08', '14:00') });
  await store.saveDay('2026-10-08', { sleepHours: '6.5', mood: 'Good', appetite: 'toast only' });
  await store.saveDay('2026-10-01', { sleepHours: '99', mood: 'Meh' });   // before the window, and invalid values
  assert.equal(store.lastCompletedVisit().key, v2);
  let r = store.sinceLastVisit();
  assert.equal(r.entries.length, 2);
  assert.deepEqual(byTag(r.entries, TAGS).map((g) => [g.type, g.count]), [['Nausea', 1], ['Headache', 1]]);
  assert.deepEqual(r.days.map((d) => [d.key, d.sleepHours, d.mood, d.appetite]), [['2026-10-08', 6.5, 'Good', 'toast only']]);
  assert.deepEqual([store.dayEntry('2026-10-01').sleepHours, store.dayEntry('2026-10-01').mood], [null, null]);
  await store.updateSymptom(k, { severity: 9, note: 'x' });
  assert.equal(store.symptom(k).severity, 2);
  await store.remove('symptoms', k);
  assert.equal(store.symptom(k), null);
  assert.equal(store.get('symptoms', k).deleted, true);   // soft — it replicates
  r = store.sinceLastVisit();
  assert.equal(r.entries.length, 1);
  assert.deepEqual(store.quickTags().slice(0, 2), ['Nausea', 'Headache']);
  // the export carries every symptom + day doc
  assert.ok(JSON.parse(store.exportJSON()).docs.some((d) => d.coll === 'days' && d.key === '2026-10-08'));
});
