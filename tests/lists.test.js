// Shape + fidelity tests for data/lists.json (Clothing & Accessories, Nursery
// Essentials). Item ids are store keys in the `items` collection, so they must
// stay unique, stable and disjoint from the v1 lists in seed.json. The content
// is checked word-for-word against the markdown it was extracted from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const L = JSON.parse(readFileSync(new URL('../data/lists.json', import.meta.url), 'utf8'));
const S = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const MD = readFileSync(new URL(`../${L.source}`, import.meta.url), 'utf8');
const byId = Object.fromEntries(L.lists.map((l) => [l.id, l]));
const clothing = byId.clothing, nursery = byId['nursery-essentials'];
const PRI = ['Must', 'Nice', 'Later', 'Skip'];

test('two lists, the sections and counts the markdown has', () => {
  assert.deepEqual(L.lists.map((l) => l.id), ['clothing', 'nursery-essentials']);
  assert.deepEqual(clothing.sections.map((s) => s.id), ['1a', '1b', '1c', '1d', '1e', '1f']);
  assert.deepEqual(nursery.sections.map((s) => s.id), ['2a', '2b', '2c', '2d', '2e', '2f', '2g', 'decisions']);
  const count = (l, sec) => l.items.filter((i) => i.section === sec).length;
  assert.deepEqual(clothing.sections.map((s) => count(clothing, s.id)), [15, 4, 11, 3, 10, 5]);
  assert.deepEqual(nursery.sections.map((s) => count(nursery, s.id)), [12, 13, 10, 2, 4, 3, 5, 3]);
  assert.equal(clothing.items.length, 48);
  assert.equal(nursery.items.length, 52);
});

test('every item has a unique, store-safe id that no v1 list uses', () => {
  const ids = L.lists.flatMap((l) => l.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
  const v1 = new Set(S.lists.flatMap((l) => l.items.map((i) => i.id)));
  for (const id of ids) { assert.match(id, /^[a-z0-9-]+$/, id); assert.ok(!v1.has(id), `${id} collides with seed.json`); }
  for (const l of L.lists) assert.ok(!S.lists.some((x) => x.id === l.id), `list id ${l.id} collides with seed.json`);
  for (const l of L.lists) l.items.forEach((it, i) => { assert.equal(it.order, i); assert.ok(l.sections.some((s) => s.id === it.section), it.id); assert.equal(it.group, l.sections.find((s) => s.id === it.section).title); });
});

test('priorities, quantities and per-size quantities are well-formed', () => {
  for (const l of L.lists) for (const it of l.items) {
    if (it.section === 'decisions') { assert.equal(it.priority, undefined); continue; }
    assert.ok(PRI.includes(it.priority), `${it.id} priority ${it.priority}`);
    if (it.section === '1a') { assert.equal(it.sizes.length, 3); assert.equal(it.qty, undefined); }
    else { assert.equal(typeof it.qty, 'string'); assert.ok(it.qty.length, it.id); assert.equal(it.sizes, undefined); }
  }
  assert.deepEqual(clothing.sections[0].sizes, ['NB', '0–3', '3–6']);
  assert.deepEqual(L.priorities, PRI);
});

test('items, quantities, priorities and notes match the markdown tables verbatim', () => {
  // every table row in the source → exactly one item, same cells, in order
  const cell = (s) => s.trim().replace(/\\\|/g, '|');
  const rows = MD.split('\n').filter((l) => l.startsWith('|') && !/^\|\s*Item/.test(l) && !/^\|---/.test(l))
    .map((l) => l.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell));
  const items = L.lists.flatMap((l) => l.items).filter((i) => i.section !== 'decisions');
  assert.equal(rows.length, items.length);
  rows.forEach((r, n) => {
    const it = items[n];
    const name = r[0].replace(/^—\s+/, '');
    assert.equal(it.text, name);
    assert.equal(!!it.child, r[0].startsWith('— '), it.id);
    if (r.length === 6) { assert.deepEqual(it.sizes, r.slice(1, 4)); assert.equal(it.priority, r[4]); assert.equal(it.notes ?? '', r[5]); }
    else { assert.equal(it.qty, r[1]); assert.equal(it.priority, r[2]); assert.equal(it.notes ?? '', r[3]); }
  });
});

test('the night caddy contents are the six indented items under it', () => {
  const a = nursery.items.filter((i) => i.section === '2a');
  assert.equal(a[5].text, 'Night caddy');
  assert.deepEqual(a.map((i) => !!i.child), [false, false, false, false, false, false, true, true, true, true, true, true]);
});

test('info cards and the decisions carry the prose over', () => {
  assert.equal(clothing.info[0].title, 'Buying rules (apply to both lists)');
  assert.equal(clothing.info[0].blocks[0].items.length, 8);
  assert.match(clothing.info[0].blocks[1].text, /^Priority key: \*\*Must\*\* = have before birth/);
  assert.equal(nursery.info[0].title, 'The key call');
  assert.match(nursery.info[0].blocks[0].text, /^The AAP recommends baby sleep in \*\*your room\*\*/);
  const c = nursery.sections.find((s) => s.id === '2c'), d = nursery.sections.find((s) => s.id === '2d');
  assert.equal(c.intro, 'Newborns change 10–12×/day. With washing every 2 days:');
  assert.deepEqual(c.infoAfter.map((x) => x.title), ['Material honesty', 'Prep timing', 'Rough cost']);
  assert.deepEqual(d.infoBefore.map((x) => x.title), ['Mechanism first']);
  assert.equal(d.infoAfter[0].title, 'Homemade balm — why a balm, not a lotion');
  assert.equal(d.infoAfter[0].blocks[1].items.length, 5);
  assert.match(clothing.sections[0].note, /^\*\*Totals to own at birth:\*\* ~20 NB pieces/);
  const dec = nursery.items.filter((i) => i.section === 'decisions').map((i) => i.text);
  assert.equal(dec.length, 3);
  assert.match(dec[0], /^\*\*Cloth from day one, or a 1–2 week disposable bridge\?\*\*/);
  assert.match(dec[2], /Illinois-shower registry items \(Mar 13\)\.$/);
});
