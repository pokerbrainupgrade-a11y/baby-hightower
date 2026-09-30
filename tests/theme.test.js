// R-1 themes: the household's choice lives in settings/theme; anything unknown reads as 'current'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { store, THEMES } from '../js/store.js';

store.write = async function (coll, key, patch) {
  const id = `${coll}/${key}`;
  const prev = this.docs.get(id) || { id, coll, key, createdAt: Date.now(), createdBy: this.user };
  const doc = { ...prev, ...patch, updatedAt: Date.now(), updatedBy: this.user };
  this.docs.set(id, doc);
  return doc;
};
const fresh = () => { store.docs = new Map(); store.identity = { user: 'Staci', code: 'test' }; };

test('three themes; no doc (or an unknown value) means current', () => {
  fresh();
  assert.deepEqual(THEMES, ['current', 'boy', 'girl']);
  assert.equal(store.theme, 'current');
  store.docs.set('settings/theme', { id: 'settings/theme', coll: 'settings', key: 'theme', theme: 'night' });
  assert.equal(store.theme, 'current');
});

test('setting a theme writes the household doc with who and when; unknown ones are refused', async () => {
  fresh();
  const d = await store.setTheme('girl');
  assert.deepEqual([d.coll, d.key, d.theme, d.setBy, d.setAt > 0], ['settings', 'theme', 'girl', 'Staci', true]);
  assert.equal(store.theme, 'girl');
  assert.equal(await store.setTheme('purple'), null);
  assert.equal(store.theme, 'girl');
});

test('each theme sets the four roles the task names, with the approved values', () => {
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  const block = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
  const val = (b, k) => (b.match(new RegExp(`--${k}:([^;]+);`)) || [])[1];
  const root = block(':root{'), boy = block(':root[data-theme="boy"]{'), girl = block(':root[data-theme="girl"]{');
  assert.deepEqual(['light', 'light-bg', 'deep', 'accent2'].map((k) => val(root, k)), ['#C7D9A0', '#EEF3E2', '#5C7038', '#EBCFD1']);
  assert.deepEqual(['light', 'light-bg', 'deep', 'accent2'].map((k) => val(boy, k)), ['#C9DCEB', '#E6EFF6', '#3F6283', '#E6D9BC']);
  assert.deepEqual(['light', 'light-bg', 'deep', 'accent2'].map((k) => val(girl, k)), ['#FFAAAA', '#FFE9E9', '#B24848', '#C7D9A0']);
  // shared across all three
  assert.deepEqual(['bg', 'ink', 'ink-soft', 'line', 'sand', 'sand-bg', 'sand-deep'].map((k) => val(root, k)), ['#FFF9F2', '#443E36', '#77705F', '#EFE6D8', '#E6D9BC', '#F3EBDA', '#7A6940']);
  for (const b of [boy, girl]) for (const k of ['bg', 'ink', 'ink-soft', 'line', 'sand', 'sand-bg', 'sand-deep', 'warn']) assert.equal(val(b, k), undefined, k);
});
