// Shape tests for data/wombkeepers.json — provider content copied byte-for-byte
// from the Wombkeepers guide extract. The app only displays it; these tests
// pin the shape the renderer relies on, never the wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const W = JSON.parse(readFileSync(new URL('../data/wombkeepers.json', import.meta.url), 'utf8'));

const SECTIONS = ['source', 'emergencyPager', 'contacts', 'whenToCall', 'earlyPregnancyNote', 'visitSchedule', 'screening', 'medications', 'food', 'exercise', 'vaccines', 'travel', 'holidayCoverage', 'birthCenter', 'fees', 'paperwork', 'packing', 'pediatricians', 'wellnessServices', 'postpartum', 'newborn'];

test('every top-level section is present', () => {
  for (const k of SECTIONS) assert.ok(W[k], k);
});

test('every whenToCall band has fromWeek, toWeek, items and pages', () => {
  assert.equal(W.whenToCall.length, 4);
  for (const b of W.whenToCall) {
    assert.ok(Number.isInteger(b.fromWeek) && Number.isInteger(b.toWeek) && b.fromWeek < b.toWeek, b.band);
    assert.ok(Array.isArray(b.items) && b.items.length, b.band);
    assert.ok(b.pages, b.band);
  }
});

test('every contact has a label and a category', () => {
  assert.ok(W.contacts.length);
  for (const c of W.contacts) assert.ok(c.label && c.category, JSON.stringify(c));
});

test('the pager number, its tel and its text template', () => {
  assert.equal(W.emergencyPager.tel, '+16022010865');
  assert.equal(W.emergencyPager.number, '602-201-0865');
  for (const k of ['use', 'responseTime', 'beforeHospital', 'dialInstructions', 'smsTemplate', 'pages']) assert.ok(W.emergencyPager[k], k);
});
