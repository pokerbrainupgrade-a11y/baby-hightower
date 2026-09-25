#!/usr/bin/env node
// Extracts the Clothing & Accessories + Nursery Essentials checklists from the
// v1 markdown into data/lists.json. Item names, quantities, priorities and
// notes are carried over verbatim (inline **bold** is kept as-is; the renderer
// understands it). Nothing here invents content.
//
// Usage: node tools/extract-lists.mjs [path/to/lists.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || resolve(here, '../2026-09-25_Baby_Clothing_Nursery_Lists_v1.md');
const md = readFileSync(src, 'utf8');

// ---------- markdown → blocks ----------
// A section is a heading plus everything up to the next heading, split into
// ordered blocks: p (paragraph), ol / ul (list items), table (rows of cells).
const cell = (s) => s.trim().replace(/\\\|/g, '|');
const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell);
const isSep = (line) => /^\|?\s*:?-{2,}/.test(line);

function blocks(lines) {
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push({ type: 'p', text: para.join(' ') }); para = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim() === '---') { flush(); continue; }
    if (line.trim().startsWith('|')) {
      flush();
      if (isSep(line)) continue;
      const last = out[out.length - 1];
      const row = splitRow(line);
      if (last?.type === 'table') last.rows.push(row); else out.push({ type: 'table', rows: [row] });
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    const ul = line.match(/^-\s+(.*)$/);
    if (ol || ul) {
      flush();
      const type = ol ? 'ol' : 'ul';
      const last = out[out.length - 1];
      const text = (ol || ul)[1].trim();
      if (last?.type === type) last.items.push(text); else out.push({ type, items: [text] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

const sections = [];
{
  let cur = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) { cur = { level: h[1].length, title: h[2].trim(), lines: [] }; sections.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  for (const s of sections) s.blocks = blocks(s.lines);
}
const find = (re) => { const s = sections.find((x) => re.test(x.title)); if (!s) throw new Error(`section ${re} not found`); return s; };
const between = (fromRe, toRe) => {
  const a = sections.indexOf(find(fromRe));
  const b = sections.findIndex((s, i) => i > a && s.level === 2);
  return sections.slice(a + 1, b === -1 ? undefined : b).filter((s) => s.level === 3);
};

// ---------- info cards ----------
// A paragraph that opens with a bold lead ("**Prep timing:** …") becomes a
// collapsible read-only card titled by the lead; a list right after it belongs
// to it. Everything is kept word-for-word.
const lead = (p) => p.match(/^\*\*(.+?):\*\*\s*(.*)$/s) || p.match(/^\*\*(.+?)\*\*:\s*(.*)$/s);
function cards(blks, prefix) {
  const out = [];
  for (let i = 0; i < blks.length; i++) {
    const b = blks[i];
    if (b.type !== 'p') continue;
    const m = lead(b.text);
    const card = m
      ? { id: `${prefix}-${slug(m[1])}`, title: m[1], blocks: m[2] ? [{ type: 'p', text: m[2] }] : [] }
      : { id: `${prefix}-${slug(b.text)}`, title: b.text, blocks: [] };
    while (blks[i + 1] && blks[i + 1].type !== 'p' && blks[i + 1].type !== 'table') card.blocks.push(blks[++i]);
    out.push(card);
  }
  return out;
}
const slug = (s) => s.toLowerCase().replace(/\*\*/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

// ---------- items ----------
const PRIORITIES = ['Must', 'Nice', 'Later', 'Skip'];
function itemsFrom(table, listId, secId, secKey) {
  const [head, ...rows] = table.rows;
  const cols = head.map((h) => h.toLowerCase());
  const iItem = cols.indexOf('item'), iPri = cols.indexOf('priority'), iNotes = cols.indexOf('notes'), iQty = cols.indexOf('qty');
  const sizeCols = head.map((h, i) => (i > iItem && i < iPri && i !== iQty ? i : -1)).filter((i) => i >= 0);
  const sizes = iQty === -1 ? sizeCols.map((i) => head[i]) : null;
  const items = rows.map((r, n) => {
    const it = { id: `${listId}-${secKey}-${n + 1}`, section: secId, text: r[iItem] };
    if (/^—\s+/.test(it.text)) { it.child = true; it.text = it.text.replace(/^—\s+/, ''); }
    if (sizes) it.sizes = sizeCols.map((i) => r[i]); else it.qty = r[iQty];
    it.priority = r[iPri];
    if (!PRIORITIES.includes(it.priority)) throw new Error(`bad priority "${it.priority}" on ${it.text}`);
    if (r[iNotes]) it.notes = r[iNotes];
    return it;
  });
  return { sizes, items };
}

function buildList(id, title, sub, headRe, { info = [], extra = [] } = {}) {
  const list = { id, title, sub, guide: null, info, sections: [], items: [] };
  for (const s of between(headRe)) {
    const key = s.title.match(/^(\d[A-Z])\./)[1].toLowerCase();
    const sec = { id: key, title: s.title };
    const ti = s.blocks.findIndex((b) => b.type === 'table');
    const before = s.blocks.slice(0, ti), after = s.blocks.slice(ti + 1);
    const { sizes, items } = itemsFrom(s.blocks[ti], id, key, key);
    if (sizes) sec.sizes = sizes;
    // a plain (non-bold-lead) paragraph before the table is the section's intro line
    const intro = before.filter((b) => b.type === 'p' && !lead(b.text));
    if (intro.length) sec.intro = intro.map((b) => b.text).join(' ');
    const infoBefore = cards(before.filter((b) => !(b.type === 'p' && !lead(b.text))), `${id}-${key}`);
    if (infoBefore.length) sec.infoBefore = infoBefore;
    // "Totals to own at birth" (1A) is a one-liner that should stay in view: a note, not a card
    const notes = after.filter((b) => b.type === 'p' && /^\*\*Totals/.test(b.text));
    if (notes.length) sec.note = notes.map((b) => b.text).join(' ');
    const infoAfter = cards(after.filter((b) => !notes.includes(b)), `${id}-${key}`);
    if (infoAfter.length) sec.infoAfter = infoAfter;
    list.sections.push(sec);
    for (const it of items) list.items.push({ id: it.id, order: list.items.length, group: sec.title, ...it });
  }
  for (const sec of extra) {
    list.sections.push({ id: sec.id, title: sec.title });
    sec.texts.forEach((text, n) => list.items.push({ id: `${id}-${sec.id}-${n + 1}`, order: list.items.length, group: sec.title, section: sec.id, text }));
  }
  return list;
}

// ---------- assemble ----------
const rules = find(/^Buying rules/);
const rulesCard = { id: 'buying-rules', title: rules.title, blocks: rules.blocks };   // the 8 rules + the priority key line

const keyCall = sections[sections.indexOf(find(/^LIST 2/))].blocks;          // "**The key call:** …" sits right under the LIST 2 heading
const decisions = find(/^Decisions to make/);

const clothing = buildList(
  'clothing', 'Baby Clothing & Accessories',
  'Clothing by size (NB / 0–3 / 3–6), sleep, feeding, soothing, bath, on the go',
  /^LIST 1/, { info: [rulesCard] },
);
const nursery = buildList(
  'nursery-essentials', 'Nursery Essentials',
  'Organized by station · nights run from your bedroom, not the nursery',
  /^LIST 2/, {
    info: cards(keyCall, 'nursery-essentials'),
    extra: [{ id: 'decisions', title: decisions.title, texts: decisions.blocks.find((b) => b.type === 'ol').items }],
  },
);

const out = {
  source: basename(src),
  addedAt: new Date().toISOString().slice(0, 10),
  priorities: PRIORITIES,
  lists: [clothing, nursery],
};
writeFileSync(resolve(here, '../data/lists.json'), JSON.stringify(out, null, 2) + '\n');
for (const l of out.lists) console.error(`${l.id}: ${l.sections.length} sections, ${l.items.length} items, ${l.info.length} top info card(s)`);
