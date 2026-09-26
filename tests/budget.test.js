// Run: npm test  (node --test)
// Spend tracker: the three header numbers against a hand-checked example,
// the bar tones, the breakdowns, the unpriced filter, the breast-pump seed,
// and the guarantee that untouched items are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUDGET_LISTS, DEFAULT_CEILING, COVERAGE, COVERAGE_LABEL, SEED_COSTS, parseMoney, fmtMoney, isPurchased, countsToward, isUnpriced, barTone, totals, summarize, coverageLabel } from '../js/budget.js';
import { store } from '../js/store.js';

const SEED = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const LISTS = JSON.parse(readFileSync(new URL('../data/lists.json', import.meta.url), 'utf8'));
const fresh = () => {
  store.docs = new Map(); store.identity = { user: 'Q', code: 'test' };
  store.seed = { ...SEED, lists: [...SEED.lists, ...LISTS.lists] }; store.lists = LISTS;
};
store.write = async function (coll, key, patch) {
  const id = `${coll}/${key}`;
  const prev = this.docs.get(id) || { id, coll, key, createdAt: Date.now(), createdBy: this.user };
  const doc = { ...prev, ...patch, updatedAt: Date.now(), updatedBy: this.user };
  this.docs.set(id, doc);
  this.emit();
  return doc;
};

// The hand-checked example (also used for the live check):
//   A  est 200, actual 185, Must         → spent 185
//   B  est 900, unpurchased, Must        → committed +900
//   C  est 50,  unpurchased, Later       → excluded
//   D  est 30,  unpurchased, Skip        → excluded
//   E  actual 40, no estimate, Gift      → spent +40
//   F  est 100, purchasedAt set, no actual → still committed at its estimate (a date alone isn't a purchase)
//   G  no money at all, Nice             → nothing, and it is "unpriced"
//   spent 225 · committed 1,225 · remaining 2,775 · 30.63% of 4,000
const EXAMPLE = [
  { id: 'A', listId: 'purchases', listTitle: 'Purchases', priority: 'Must', estimatedCost: 200, actualCost: 185, purchasedBy: 'Q' },
  { id: 'B', listId: 'nursery', listTitle: 'Nursery Build', priority: 'Must', estimatedCost: 900 },
  { id: 'C', listId: 'clothing', listTitle: 'Clothing', priority: 'Later', estimatedCost: 50 },
  { id: 'D', listId: 'clothing', listTitle: 'Clothing', priority: 'Skip', estimatedCost: 30 },
  { id: 'E', listId: 'gobag', listTitle: 'Go Bag', actualCost: 40, coverage: 'Gift', purchasedBy: 'Gift' },
  { id: 'F', listId: 'nursery-essentials', listTitle: 'Nursery Essentials', priority: 'Must', estimatedCost: 100, purchasedAt: '2026-10-01', coverage: 'HSA' },
  { id: 'G', listId: 'purchases', listTitle: 'Purchases', priority: 'Nice' },
];

test('the three header numbers, hand-checked', () => {
  const s = summarize(EXAMPLE, 4000);
  assert.equal(s.spent, 225);
  assert.equal(s.committed, 1225);
  assert.equal(s.remaining, 2775);
  assert.equal(s.pct, 30.63);
  assert.equal(s.tone, 'ok');
  assert.equal(s.unpriced, 1);   // G only — D is Skip, so it never asks for a price
  assert.deepEqual(totals([]), { spent: 0, committed: 0 });
  // an untagged item (the v1 lists carry no priority) counts like Must / Nice
  assert.equal(countsToward({}), true);
  assert.equal(countsToward({ priority: 'Later' }), false);
  assert.equal(isPurchased({ purchasedAt: '2026-10-01' }), false);
  assert.equal(isPurchased({ actualCost: 0 }), true);   // a free thing, bought
});

test('bar tones: sage under 75%, sand 75–100%, blush-deep over — and nothing else', () => {
  assert.equal(barTone(0), 'ok');
  assert.equal(barTone(74.99), 'ok');
  assert.equal(barTone(75), 'warm');
  assert.equal(barTone(100), 'warm');
  assert.equal(barTone(100.01), 'over');
  const over = summarize([{ listId: 'purchases', actualCost: 4500 }], 4000);
  assert.equal(over.remaining, -500);
  assert.equal(over.tone, 'over');
  assert.equal(summarize(EXAMPLE, 1500).tone, 'warm');   // 1225 / 1500 = 81.7%
});

test('breakdowns by coverage and by list', () => {
  const s = summarize(EXAMPLE, 4000);
  const cov = Object.fromEntries(s.byCoverage.map((c) => [c.coverage, [c.spent, c.committed, c.n]]));
  assert.deepEqual(cov, {
    'Out of pocket': [185, 1085, 4],   // A (185) + B (900); C and D are priced but excluded from the total; G unpriced
    Insurance: [0, 0, 0],
    HSA: [0, 100, 1],                  // F
    Gift: [40, 40, 1],                 // E
    Registry: [0, 0, 0],
  });
  assert.equal(s.byCoverage.find((c) => c.coverage === 'HSA').label, 'marked HSA by us');
  assert.equal(coverageLabel('HSA'), 'marked HSA by us');
  assert.equal(coverageLabel('nope'), 'Out of pocket');
  const lists = s.byList.map((g) => [g.listId, g.spent, g.committed, g.n, g.unpriced]);
  assert.deepEqual(lists, [['purchases', 185, 185, 2, 1], ['nursery', 0, 900, 1, 0], ['clothing', 0, 0, 2, 0], ['gobag', 40, 40, 1, 0], ['nursery-essentials', 0, 100, 1, 0]]);
  assert.deepEqual(BUDGET_LISTS, ['purchases', 'nursery', 'clothing', 'nursery-essentials', 'gobag']);
  assert.deepEqual(COVERAGE, ['Out of pocket', 'Insurance', 'HSA', 'Gift', 'Registry']);
  assert.equal(Object.values(COVERAGE_LABEL).some((l) => /eligible/i.test(l)), false);   // a label, never a ruling
});

test('money parsing and formatting', () => {
  assert.equal(parseMoney('$1,200.50'), 1200.5);
  assert.equal(parseMoney('200'), 200);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(-5), null);
  assert.equal(parseMoney(0), 0);
  assert.equal(fmtMoney(1234.5), '$1,234.50');
  assert.equal(fmtMoney(200), '$200');
  assert.equal(fmtMoney(0), '$0');
  assert.equal(fmtMoney(null), '—');
  assert.equal(fmtMoney(-500), '-$500');
});

test('the breast pump: already in the Clothing list, so it gets its fields from the overlay — no duplicate', () => {
  fresh();
  const pumps = store.seed.lists.flatMap((l) => l.items.map((it) => ({ ...it, listId: l.id }))).filter((it) => /breast pump/i.test(it.text));
  assert.equal(pumps.length, 1);
  assert.equal(pumps[0].id, 'clothing-1c-7');
  assert.deepEqual(SEED_COSTS['clothing-1c-7'], { coverage: 'Insurance', estimatedCost: 0 });
  const pump = store.items('clothing').find((it) => it.id === 'clothing-1c-7');
  assert.equal(pump.coverage, 'Insurance');
  assert.equal(pump.estimatedCost, 0);
  assert.equal(store.docs.size, 0);   // nothing written
  // and a real entry on the pump wins over the overlay
  store.docs.set('items/clothing-1c-7', { id: 'items/clothing-1c-7', coll: 'items', key: 'clothing-1c-7', listId: 'clothing', actualCost: 0, purchasedBy: 'Staci' });
  const p2 = store.items('clothing').find((it) => it.id === 'clothing-1c-7');
  assert.deepEqual([p2.coverage, p2.estimatedCost, p2.actualCost, p2.purchasedBy], ['Insurance', 0, 0, 'Staci']);
});

test('untouched items are untouched: no cost keys appear on them, and their state docs are not changed', () => {
  fresh();
  store.docs.set('items/purchases-1', { id: 'items/purchases-1', coll: 'items', key: 'purchases-1', listId: 'purchases', done: true, checkedBy: 'Q', checkedAt: 5 });
  const it = store.items('purchases').find((x) => x.id === 'purchases-1');
  assert.equal(it.done, true);
  assert.equal(it.checkedBy, 'Q');
  for (const k of ['estimatedCost', 'actualCost', 'purchasedAt', 'purchasedBy', 'coverage', 'vendor', 'link']) assert.equal(k in it, false, k);
  const all = store.budgetItems();
  assert.ok(all.length > 100);
  assert.equal(all.filter((x) => x.id !== 'clothing-1c-7' && ('estimatedCost' in x || 'coverage' in x)).length, 0);
  assert.equal(store.ceiling, DEFAULT_CEILING);
  assert.equal(summarize(all, store.ceiling).committed, 0);
});

test('store: cost fields are cleaned on save, the ceiling is a setting, unpriced counts follow', async () => {
  fresh();
  await store.saveItemCost('purchases-1', 'purchases', { estimatedCost: '$200', actualCost: '185', purchasedAt: '2026-10-01', purchasedBy: 'Q', coverage: 'HSA', vendor: '  Target ', link: 'https://example.com/x' });
  let it = store.items('purchases').find((x) => x.id === 'purchases-1');
  assert.deepEqual([it.estimatedCost, it.actualCost, it.purchasedAt, it.purchasedBy, it.coverage, it.vendor, it.link], [200, 185, '2026-10-01', 'Q', 'HSA', 'Target', 'https://example.com/x']);
  assert.equal(it.done, undefined);   // the tick is untouched by a cost save
  await store.saveItemCost('purchases-1', 'purchases', { actualCost: '', purchasedBy: 'Nobody', coverage: 'Maybe', purchasedAt: 'not a date', link: 'javascript:alert(1)' });
  it = store.items('purchases').find((x) => x.id === 'purchases-1');
  assert.deepEqual([it.actualCost, it.purchasedBy, it.coverage, it.purchasedAt, it.link], [null, null, 'Out of pocket', null, null]);
  assert.ok(!Object.values(store.get('items', 'purchases-1')).includes(undefined));
  const before = summarize(store.budgetItems(), store.ceiling).unpriced;
  await store.saveItemCost('nursery-1', 'nursery', { estimatedCost: '900' });
  const s = summarize(store.budgetItems(), store.ceiling);
  assert.equal(s.unpriced, before - 1);
  assert.equal(s.committed, 1100);   // 200 (purchases-1, no actual any more) + 900
  await store.setCeiling('5,000');
  assert.equal(store.ceiling, 5000);
  assert.equal(store.get('settings', 'budget').setBy, 'Q');
  await store.setCeiling('');
  assert.equal(store.ceiling, DEFAULT_CEILING);
});
