// Shape tests for data/resources.json (the Resources tab's seed content).
// Episode ids are store keys in the `resources` collection, so they must stay
// unique and stable — renaming one orphans whoever already ticked it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const R = JSON.parse(readFileSync(new URL('../data/resources.json', import.meta.url), 'utf8'));
const episodes = R.listen.groups.flatMap((g) => g.episodes);

test('three hosts, fifteen episodes, in the guide order', () => {
  assert.deepEqual(R.listen.groups.map((g) => g.episodes.length), [5, 6, 4]);
  assert.equal(episodes.length, 15);
  assert.match(R.listen.groups[0].host, /Rhonda Patrick/);
  assert.match(R.listen.groups[1].host, /Ben Greenfield/);
  assert.match(R.listen.groups[2].host, /Diary Of A CEO/);
});

test('every episode has a unique, store-safe id, a title, a description and an https url', () => {
  const ids = episodes.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of episodes) {
    assert.match(e.id, /^[a-z0-9-]+$/, e.id);
    assert.ok(e.title && e.desc, e.id);
    assert.doesNotThrow(() => new URL(e.url), e.id);
    assert.equal(new URL(e.url).protocol, 'https:', e.id);
    if (e.tag !== undefined) assert.ok(e.tag.length, `${e.id} tag`);
  }
});

test('the trust note and group notes are present', () => {
  for (const g of R.listen.groups) assert.ok(g.note, g.id);
  assert.match(R.listen.footer, /^Trust levels vary\./);
  assert.match(R.listen.footer, /goes to the OB\.$/);
});
