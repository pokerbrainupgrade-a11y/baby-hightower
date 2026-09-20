#!/usr/bin/env node
// Extracts structured seed data from the static v1 companion HTML.
// Usage: node tools/extract-seed.mjs [path/to/v1.html] > data/seed.json
// Content is carried over verbatim; nothing here invents medical content.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || resolve(here, '../../2026-09-14_BabyHightower_Companion_v1.html');
const html = readFileSync(src, 'utf8');

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const text = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const slug = (s) => text(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// ---------- date estimates ----------
// v1 hard-coded every date. The app now treats those as *estimates* that are
// either tied to the pregnancy week (they move when the due date moves) or
// tied to the calendar (holidays, booked trips, enrollment season — they
// don't). `est` on each event says which; the original `date` is kept
// verbatim as the v1 reference (and it's what the stable id is built from).
const dn = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
const LMP = dn('2026-08-03');
// Calendar-bound events: id → { date, span (days, for a multi-day window), pre ('by' | 'from') }
const FIXED = {
  '2026-11-01-pin-down-open-enrollment-both-employers': { date: '2026-11-01' },
  '2026-11-13-wyoming-tell-staci-s-parents-in-person': { date: '2026-11-13', span: 2 },
  '2026-11-26-thanksgiving-tell-q-s-parents-az': { date: '2026-11-26' },
  '2027-02-01-shower-invites-out-registry-linked': { date: '2027-02-06', pre: 'by' },
  '2027-03-11-illinois-baby-shower-saturday-mar-13': { date: '2027-03-11', span: 4 },
};
// Week-based windows that v1 wrote as ranges ("SEP 29 – OCT 19"): id → days from first to last day
const SPAN = {
  '2026-09-29-first-prenatal-visit-dating-ultrasound': 20,
  '2026-12-08-anatomy-scan-the-big-one': 34,
  '2027-01-19-glucose-screening': 27,
};
const PRE = { '2026-10-13-nipt-blood-draw-screening-the-sex': 'from' };
const estimate = (id, date) => {
  if (FIXED[id]) return { kind: 'fixed', ...FIXED[id] };
  const days = dn(date) - LMP;
  const est = { kind: 'week', week: Math.floor(days / 7), day: days % 7 };
  if (SPAN[id]) est.span = SPAN[id];
  if (PRE[id]) est.pre = PRE[id];
  return est;
};

// ---------- timeline ----------
const timelineHtml = html.slice(html.indexOf('<section id="timeline">'), html.indexOf('<section id="guide">'));
const trimesters = [];
const triRe = /<div class="tri"><div class="tri-head"><h2 class="serif">(.*?)<\/h2><small>(.*?)<\/small><\/div>\s*<p class="tri-sub">(.*?)<\/p>\s*<div class="spine">([\s\S]*?)<\/div><\/div>\s*(?=<div class="tri">|<\/section>)/g;
let m;
let order = 0;
while ((m = triRe.exec(timelineHtml))) {
  const [, title, range, sub, spine] = m;
  const tri = { id: 't' + (trimesters.length + 1), title: text(title), range: text(range), sub: text(sub), events: [] };
  // Split on event openers (card events close with </a></div>, dev events with </div></div></div>)
  const chunks = spine.split(/(?=<div class="ev[ "])/).filter((c) => c.startsWith('<div class="ev'));
  for (const chunk of chunks) {
    const e = chunk.match(/^<div class="ev([^"]*)" data-date="([^"]+)">([\s\S]*)$/);
    const cls = e[1].trim();
    const date = e[2];
    const body = e[3];
    const category = cls.includes('dev') ? 'dev' : cls.includes('family') ? 'family' : cls.includes('money') ? 'money' : cls.includes('star') ? 'star' : 'medical';
    const title = text((body.match(/<div class="ev-title">([\s\S]*?)<\/div>/) || [])[1] || '');
    const id = `${date}-${slug(title)}`;
    const ev = { id, order: order++, date, est: estimate(id, date), category, title };
    if (category !== 'dev') {
      ev.dateLabel = text((body.match(/<div class="ev-date">([\s\S]*?)<\/div>/) || [])[1] || '');
      ev.note = text((body.match(/<div class="ev-note">([\s\S]*?)<\/div>/) || [])[1] || '');
      ev.linkLabel = text((body.match(/<span class="ev-link">([\s\S]*?)<\/span>/) || [])[1] || '');
      ev.guide = (body.match(/href="#(g-[a-z]+)"/) || [])[1] || null;
    }
    tri.events.push(ev);
  }
  trimesters.push(tri);
}

// ---------- guide ----------
const guideHtml = html.slice(html.indexOf('<section id="guide">'), html.indexOf('</main>'));
const guide = [];
const secRe = /<div class="gsec" id="(g-[a-z]+)">([\s\S]*?)<a class="back"[^>]*>[^<]*<\/a>\s*<\/div>/g;
while ((m = secRe.exec(guideHtml))) {
  const [, id, inner] = m;
  const tagM = inner.match(/<span class="tag (\w+)">(.*?)<\/span>/);
  const h2 = text((inner.match(/<h2 class="serif">([\s\S]*?)<\/h2>/) || [])[1] || '');
  const sub = text((inner.match(/<div class="gsub">([\s\S]*?)<\/div>/) || [])[1] || '');
  // body = everything after the gsub line, verbatim HTML (kept for rendering)
  const bodyStart = inner.indexOf('</div>', inner.indexOf('class="gsub"')) + 6;
  const body = inner.slice(bodyStart).trim().replace(/\n\s+/g, '\n');
  guide.push({ id, tagKind: tagM ? tagM[1] : 'med', tag: text(tagM ? tagM[2] : ''), title: h2, sub, html: body });
}
const section = (id) => guide.find((g) => g.id === id);

// ---------- checklists ----------
const liItems = (ulHtml) => [...ulHtml.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => text(x[1]));
const checksLists = (secId) => [...section(secId).html.matchAll(/<ul class="checks">([\s\S]*?)<\/ul>/g)].map((x) => liItems(x[1]));
const h3s = (secId) => [...section(secId).html.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((x) => text(x[1]));

const lists = [];
const addList = (id, title, sub, guideId, groups) => {
  const items = [];
  groups.forEach(([group, arr]) => arr.forEach((t, i) => items.push({ id: `${id}-${items.length + 1}`, order: items.length, group, text: t })));
  lists.push({ id, title, sub, guide: guideId, items });
};

// Go bag: two checks lists, headed by the two h3s
{
  const [main, transfer] = checksLists('g-gobag');
  const [h1, h2] = h3s('g-gobag');
  addList('gobag', 'Go Bag', section('g-gobag').sub, 'g-gobag', [[h1, main], [h2, transfer]]);
}
// Purchases: the budget table rows (skip the Total row)
{
  const rows = [...section('g-buying').html.matchAll(/<tr><td>(.*?)<\/td><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)]
    .map((r) => r.slice(1).map(text)).filter((r) => r[0] !== '' && !/Total/.test(r[1]));
  const items = rows.map(([when, what, budget]) => `${what} — ${when} · ${budget}`);
  addList('purchases', 'Purchases · $4K budget', section('g-buying').sub, 'g-buying', [['Spend schedule', items]]);
}
// Legal
addList('legal', 'Legal', section('g-legal').sub, 'g-legal', [['The legal block', checksLists('g-legal')[0]]]);
// Nursery build sequence (plain ul after the h3)
{
  const ul = section('g-nursery').html.match(/<h3>Build sequence<\/h3>\s*<ul>([\s\S]*?)<\/ul>/)[1];
  addList('nursery', 'Nursery Build', section('g-nursery').sub, 'g-nursery', [['Build sequence', liItems(ul)]]);
}
// First 30 days (admin checks)
addList('first30', 'First 30 Days', section('g-fourth').sub, 'g-fourth', [[h3s('g-fourth')[0], checksLists('g-fourth')[0]]]);
// Classes
addList('classes', 'Classes', section('g-classes').sub, 'g-classes', [['The skills schedule', checksLists('g-classes')[0]]]);

const seed = {
  source: '2026-09-14_BabyHightower_Companion_v1.html',
  extractedAt: new Date().toISOString().slice(0, 10),
  meta: {
    eyebrow: text((html.match(/<div class="hdr-eyebrow">(.*?)<\/div>/) || [])[1]),
    due: text((html.match(/<div class="hdr-due">(.*?)<\/div>/) || [])[1]),
    footer: text((html.match(/<footer>\s*<div class="serif">(.*?)<\/div>/) || [])[1]),
    legend: [...timelineHtml.matchAll(/<span><i[^>]*><\/i>(.*?)<\/span>/g)].map((x) => text(x[1])),
  },
  trimesters,
  guide,
  lists,
};

const out = resolve(here, '../data/seed.json');
writeFileSync(out, JSON.stringify(seed, null, 2) + '\n');
const nEvents = trimesters.reduce((n, t) => n + t.events.length, 0);
console.error(`seed.json: ${trimesters.length} trimesters, ${nEvents} events, ${guide.length} guide sections, ${lists.length} lists (${lists.reduce((n, l) => n + l.items.length, 0)} items)`);
