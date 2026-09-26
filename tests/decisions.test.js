// Run: npm test  (node --test)
// Open Decisions Log: seeds, the sort order, week → date under the live
// anchor (America/Phoenix, across 2026 → 2027), and the close gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUE } from '../js/config.js';
import { setDue, dateAt, formatDate, todayISO } from '../js/dates.js';
import { SEED_DECISIONS, OWNERS, DEC_STATUS, MIRROR_LINE, decStatus, decOwner, weekOf, deadline, sortDecisions, closePatch } from '../js/decisions.js';
import { store } from '../js/store.js';

const fresh = () => { store.docs = new Map(); store.identity = { user: 'Q', code: 'test' }; setDue(null); };
store.write = async function (coll, key, patch) {
  const id = `${coll}/${key}`;
  const prev = this.docs.get(id) || { id, coll, key, createdAt: Date.now(), createdBy: this.user };
  const doc = { ...prev, ...patch, updatedAt: Date.now(), updatedBy: this.user };
  this.docs.set(id, doc);
  this.emit();
  return doc;
};

test('eleven seeds: titles, owners and the two target weeks only — no context, no status text', () => {
  assert.equal(SEED_DECISIONS.length, 11);
  assert.deepEqual(SEED_DECISIONS.map((d) => d.title), [
    'Insurance / open-enrollment move', 'Screening scope', 'Supplement confirmation with provider',
    'Doula (Wombkeepers in-house option)', 'Cord blood / stem cell banking', 'Childcare after leave',
    'Shower host confirmation', 'Possible AZ mini-shower', 'Guardianship choice', 'Pediatrician selection', 'Leave sequencing',
  ]);
  assert.deepEqual(SEED_DECISIONS.map((d) => d.owner), ['Both', 'Both', 'Staci', 'Both', 'Both', 'Both', 'Q', 'Both', 'Both', 'Both', 'Q']);
  for (const d of SEED_DECISIONS) {
    assert.ok(OWNERS.includes(d.owner));
    assert.equal(decStatus(d), 'Open');
    for (const k of Object.keys(d)) assert.ok(['id', 'title', 'owner', 'decideByWeek', 'blockedBy'].includes(k), `${d.id}: unexpected seed field ${k}`);
  }
  assert.equal(new Set(SEED_DECISIONS.map((d) => d.id)).size, 11);
  assert.deepEqual(SEED_DECISIONS.filter((d) => d.decideByWeek).map((d) => [d.title, d.decideByWeek]), [['Doula (Wombkeepers in-house option)', 20], ['Pediatrician selection', 30]]);
  assert.deepEqual(SEED_DECISIONS.filter((d) => d.blockedBy).map((d) => [d.id, d.blockedBy]), [['d-insurance', 'Wombkeepers fee schedule and billing model']]);
  assert.deepEqual(DEC_STATUS, ['Open', 'Researching', 'Blocked', 'Closed']);
  assert.equal(MIRROR_LINE, 'Mirrors the Open Decisions Log in the master plan doc. Update both.');
});

test('seeds are content: store.decisions() shows all eleven with no docs; a doc only adds state', () => {
  fresh();
  assert.equal(store.decisions().length, 11);
  assert.equal(store.docs.size, 0);
  store.docs.set('decisions/d-doula', { id: 'decisions/d-doula', coll: 'decisions', key: 'd-doula', status: 'Researching', context: 'notes' });
  const d = store.decision('d-doula');
  assert.equal(d.title, 'Doula (Wombkeepers in-house option)');
  assert.equal(d.decideByWeek, 20);
  assert.equal(d.status, 'Researching');
  assert.equal(store.decisions().length, 11);
});

test('a target week resolves to a date under the live anchor, and moves with it', () => {
  setDue(null);
  assert.deepEqual(deadline({ decideByWeek: 20 }), { date: '2026-12-21', week: 20 });   // 20w0d, Mon Dec 21, 2026
  assert.deepEqual(deadline({ decideByWeek: 30 }), { date: '2027-03-01', week: 30 });   // 30w0d, Mon Mar 1, 2027 — across the year boundary
  assert.equal(deadline({ decideByWeek: 20 }).date, dateAt(20, 0));
  assert.equal(formatDate(deadline({ decideByWeek: 30 }).date), 'Mon, Mar 1');
  // a calendar date wins over a week
  assert.deepEqual(deadline({ decideBy: '2026-11-15', decideByWeek: 20 }), { date: '2026-11-15', week: null });
  assert.equal(deadline({}), null);
  assert.equal(deadline({ decideByWeek: '20' }), null);   // strings never sneak in
  assert.equal(weekOf({ decideByWeek: 99 }), null);
  // due date revised a week later → week 20 lands a week later too
  setDue('2027-05-18');
  assert.deepEqual(deadline({ decideByWeek: 20 }), { date: '2026-12-28', week: 20 });
  assert.deepEqual(deadline({ decideByWeek: 30 }), { date: '2027-03-08', week: 30 });
  setDue(null);
  assert.equal(todayISO(new Date('2026-12-21T06:59:59Z')), '2026-12-20');   // Phoenix: week 20 has not started yet
  assert.equal(todayISO(new Date('2026-12-21T07:00:00Z')), '2026-12-21');
});

test('sort: Open by nearest deadline, undated Open, Researching, Blocked, Closed (latest first)', () => {
  const list = [
    { key: 'a', status: 'Closed', closedAt: 100 },
    { key: 'b' },                                        // Open, undated (no status at all)
    { key: 'c', status: 'Blocked' },
    { key: 'd', status: 'Open', decideByWeek: 30 },
    { key: 'e', status: 'Researching', decideBy: '2026-10-01' },
    { key: 'f', status: 'Open', decideBy: '2026-11-15' },
    { key: 'g', status: 'Closed', closedAt: 200 },
    { key: 'h', status: 'Open' },
    { key: 'i', status: 'Researching' },
    { key: 'j', status: 'Open', decideByWeek: 20 },
  ];
  assert.deepEqual(sortDecisions(list).map((d) => d.key), ['f', 'j', 'd', 'b', 'h', 'e', 'i', 'c', 'g', 'a']);
  // the seeds themselves: the two week-targeted ones first (20 then 30), then the rest in doc order
  assert.deepEqual(sortDecisions(SEED_DECISIONS).map((d) => d.id).slice(0, 3), ['d-doula', 'd-pediatrician', 'd-insurance']);
});

test('closing requires a recorded decision; reopening keeps the text but clears the close stamp', async () => {
  fresh();
  assert.equal(closePatch('', 'Q'), null);
  assert.equal(closePatch('   ', 'Q'), null);
  assert.deepEqual(closePatch(' Yes — in-house. ', 'Staci', 5), { status: 'Closed', decision: 'Yes — in-house.', closedAt: 5, closedBy: 'Staci' });

  assert.equal(await store.closeDecision('d-doula', ''), null);
  assert.equal(await store.setDecisionStatus('d-doula', 'Closed'), null);   // no decision on the record → refused
  assert.equal(decStatus(store.decision('d-doula')), 'Open');

  const doc = await store.closeDecision('d-doula', 'Book the in-house doula.');
  assert.equal(doc.status, 'Closed');
  assert.equal(doc.closedBy, 'Q');
  assert.ok(doc.closedAt > 0);
  assert.equal(doc.updatedBy, 'Q');
  assert.equal(store.decisions().filter((d) => decStatus(d) === 'Closed').length, 1);

  // with a decision on the record, the status chip can close it too
  await store.saveDecision('d-leave', { decision: 'Q takes weeks 1–4, then alternates.' });
  assert.equal((await store.setDecisionStatus('d-leave', 'Closed')).status, 'Closed');

  const re = await store.setDecisionStatus('d-doula', 'Researching');
  assert.equal(re.status, 'Researching');
  assert.equal(re.decision, 'Book the in-house doula.');
  assert.equal(re.closedAt, null);
  assert.equal(re.closedBy, null);
  // no delete path exists for decisions
  assert.equal(typeof store.removeDecision, 'undefined');
});

test('saveDecision keeps the week an integer (or null) and never writes undefined', async () => {
  fresh();
  await store.saveDecision('d-screening', { decideByWeek: '16' });
  assert.equal(store.decision('d-screening').decideByWeek, 16);
  await store.saveDecision('d-screening', { decideByWeek: '' });
  assert.equal(store.decision('d-screening').decideByWeek, null);
  await store.saveDecision('d-screening', { decideBy: '2026-11-01', context: undefined });
  const d = store.decision('d-screening');
  assert.equal(d.context, null);
  assert.ok(!Object.values(d).includes(undefined));
  assert.equal(decOwner(d), 'Both');
  const k = await store.addDecision({ title: 'A new one', owner: 'Q' });
  assert.equal(store.decisions().length, 12);
  assert.equal(store.decision(k).seed, false);
  assert.equal(decStatus(store.decision(k)), 'Open');
});
