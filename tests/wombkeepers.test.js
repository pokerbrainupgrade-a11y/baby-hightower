// Shape tests for data/wombkeepers.json — provider content copied byte-for-byte
// from the Wombkeepers guide extract. The app only displays it; these tests
// pin the shape the renderer relies on, never the wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { telHref, smsHref, mapsHref, bandFor, sortContacts, attribution } from '../js/wombkeepers.js';

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

// ---------- helpers (js/wombkeepers.js) ----------
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

test('pager links: sms body is &body= on iPhone, ?body= elsewhere, encoded with its newlines', () => {
  const p = W.emergencyPager;
  assert.equal(smsHref(p.tel, p.smsTemplate, IPHONE), 'sms:+16022010865&body=Name%3A%20%0ADOB%3A%20%0ACallback%3A%20%0AConcern%3A%20');
  assert.match(smsHref(p.tel, p.smsTemplate, ANDROID), /^sms:\+16022010865\?body=Name%3A/);
  assert.equal(smsHref(p.tel, '', IPHONE), 'sms:+16022010865');
});

test('tel links from every contact phone; maps per platform', () => {
  assert.equal(telHref('602-201-0865'), 'tel:+16022010865');
  assert.equal(telHref('+16022010865'), 'tel:+16022010865');
  assert.equal(telHref(''), null);
  for (const c of W.contacts) if (c.phone) assert.match(telHref(c.phone), /^tel:\+1\d{10}$/, c.label);
  assert.match(mapsHref('16700 N. Thompson Peak Pkwy', IPHONE), /^https:\/\/maps\.apple\.com\/\?q=16700/);
  assert.match(mapsHref('16700 N. Thompson Peak Pkwy', ANDROID), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=16700/);
  assert.equal(mapsHref(''), null);
});

test('the open "When to call" band follows the week (display only)', () => {
  const B = W.whenToCall;
  assert.deepEqual([0, 8, 15, 16, 27, 28, 33, 34, 40, 41, 43].map((w) => bandFor(w, B)), [0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 3]);
  assert.equal(bandFor(NaN, B), -1);
});

test('pinned contacts first, file order kept; attribution line', () => {
  const s = sortContacts(W.contacts);
  const firstUnpinned = s.findIndex((c) => !c.pinned);
  assert.ok(s.slice(firstUnpinned).every((c) => !c.pinned));
  assert.equal(s[0].label, 'Wombkeepers main office');
  assert.equal(attribution('p.14'), 'Wombkeepers Pregnancy Guide 2025–26, p.14');
});
