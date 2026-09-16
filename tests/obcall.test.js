import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OB_CALL } from '../js/obcall.js';

const isCheck = (b) => b.type === 'item' || b.type === 'quote';
const checks = OB_CALL.sections.flatMap((s) => s.blocks.filter(isCheck));
const fields = OB_CALL.sections.flatMap((s) => s.blocks.flatMap((b) => b.fields || []));

test('every checkbox, field and notes box has a unique store key', () => {
  const keys = [
    ...checks.map((b) => b.id),
    ...fields.map((f) => `f-${f.id}`),
    ...OB_CALL.sections.map((s) => `notes-${s.id}`),
  ];
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.match(k, /^[a-z0-9-]+$/);
});

test('structure mirrors the PDF: four steps, nice-to-haves, ER box', () => {
  const steps = OB_CALL.sections.filter((s) => !s.optional);
  assert.deepEqual(steps.map((s) => s.step), ['STEP 1', 'STEP 2', 'STEP 3', 'STEP 4']);
  assert.equal(steps.flatMap((s) => s.blocks.filter(isCheck)).length, 16);
  assert.equal(OB_CALL.sections.filter((s) => s.optional).length, 1);
  assert.equal(OB_CALL.sections.find((s) => s.optional).blocks.length, 3);
  assert.equal(OB_CALL.er.items.length, 4);
  assert.ok(OB_CALL.er.items.some((t) => t.includes('100.4°F')));
});

test('the fill-in fields the guide asks for all exist', () => {
  const ids = new Set(fields.map((f) => f.id));
  for (const id of ['spot-color', 'spot-amount', 'spot-trend', 'trigger', 'early-slot', 'nurse-line', 'first-visit']) assert.ok(ids.has(id), id);
});

test('script placeholders point at real fields and have blank text', () => {
  const ids = new Set(fields.map((f) => f.id));
  for (const q of checks.filter((b) => b.type === 'quote')) {
    for (const [k, fid] of Object.entries(q.fill || {})) {
      assert.ok(ids.has(fid), `${q.id} → ${fid}`);
      assert.ok(q.blank?.[k], `${q.id} blank for ${k}`);
      assert.ok(q.text.includes(`{${k}}`), `${q.id} uses {${k}}`);
    }
  }
});
