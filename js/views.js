// The five tabs + detail pages + settings. Each view is { render(root, params), update() }.
// A view may also expose navigate(params): the router calls it instead of
// render() when only the params change (segment switch, sub-page), so the
// frame and its inputs are kept.
// render() builds the static frame once and binds listeners on it; update()
// re-renders only the live containers, so the frame's inputs keep focus.
import { store } from './store.js';
import { summary, todayISO, formatGestation, formatStamp, formatDate, formatTime, windowLabel, dateAt, currentLMP, noteFor } from './dates.js';
import { APP_VERSION, DUE, USERS } from './config.js';
import { OB_CALL } from './obcall.js';
import { esc, rich, stamp, progressBar, uiState } from './ui.js';
import { visits } from './visitsview.js';
import { decisions } from './decisionsview.js';
import { quickRow, bindQuickRow } from './symptomsview.js';
import { budget, costEditor, costFoot, readCostEditor } from './budgetview.js';
import { BUDGET_LISTS, summarize, fmtMoney } from './budget.js';
import { SHOW, actionsFor, nextAfter, upcoming, weekRange, linkHash, linkTarget, categoryOf } from './weekactions.js';
import { decStatus } from './decisions.js';
import { Q_FILTERS, qStatus, qPasses, sortVisits, visitType } from './visits.js';
export { uiState };

// ---------- shared pieces ----------
/** v1 wording for an event's estimate window ('SEP 29 – OCT 19 · WEEKS 8–10'). */
const estLabel = (e, caps = true) => windowLabel(e.estFrom, e.estTo, { pre: e.est.pre, week: e.category !== 'money', caps });

/**
 * An event's date line — the estimate, muted with a '~', or the confirmed
 * date in full weight with a '✓'. Tapping it opens the date editor.
 */
function dateLine(e) {
  const text = e.confirmed ? windowLabel(e.from, e.to, { week: e.category !== 'money', time: e.time }) : estLabel(e);
  const hint = e.confirmed ? 'Confirmed — tap to change' : 'Estimated — tap to set the date';
  return `<span class="ev-date ${e.confirmed ? 'confirmed' : 'est'}" data-edit-date="${esc(e.id)}" role="button" title="${hint}" aria-label="${hint}: ${esc(text)}"><i class="mark">${e.confirmed ? '✓' : '~'}</i>${esc(text)}</span>`;
}

function eventCard(e, today) {
  const done = !!e.state.done;
  return `<div class="ev ${e.category}${e.to < today ? ' past' : ''}${done ? ' done' : ''}">
    <button class="card" data-go="timeline/ev/${esc(e.id)}">
      ${e.category !== 'dev' ? `<div>${dateLine(e)}</div>` : ''}
      <div class="ev-title">${done ? '<span class="tick">✓</span>' : ''}${esc(e.title)}</div>
      ${e.note ? `<div class="ev-note">${esc(e.note)}</div>` : ''}
      ${e.linkLabel ? `<span class="ev-link">${esc(e.linkLabel)}</span>` : ''}
    </button></div>`;
}

/** Checklist block (used on the Lists page and inside event/guide detail). */
function checklistHTML(listId, { compact = false } = {}) {
  const list = store.seed.lists.find((l) => l.id === listId);
  if (list.sections) return sectionedHTML(list);
  const items = store.items(listId);
  const p = store.progress(listId);
  const groups = [];
  for (const it of items) {
    const g = it.seed ? it.group : 'Added';
    let grp = groups.find((x) => x.name === g);
    if (!grp) groups.push((grp = { name: g, items: [] }));
    grp.items.push(it);
  }
  const single = groups.length === 1;
  return `<div class="checklist" data-list="${esc(listId)}">
    <div class="cl-head"><b>${compact ? esc(list.title) : 'Items'}</b><span>${p.done}/${p.total}</span></div>
    ${progressBar(p)}
    ${groups.map((g) => `
      ${single && g.name !== 'Added' ? '' : `<div class="grp">${esc(g.name)}</div>`}
      <ul class="items">${g.items.map((it) => itemHTML(it)).join('')}</ul>`).join('')}
    ${addRow(listId)}
  </div>`;
}

const addRow = (listId) => `<form class="addrow" data-add-item="${esc(listId)}">
      <input type="text" name="text" placeholder="Add an item…" autocomplete="off" enterkeyhint="done">
      <button class="btn sm primary" type="submit">Add</button>
    </form>`;

// ---- sectioned lists (data/lists.json): collapsible sections, priority filter, info cards ----
const FILTERS = ['All', 'Must', 'Nice', 'Later', 'Skip'];
const filterOf = (listId) => uiState.filter.get(listId) || 'All';
/** "All" is everything except Skip — the don't-buy guidance stays findable under its own chip. */
const passes = (it, f) => (f === 'All' ? it.priority !== 'Skip' : it.priority === f);

function sectionedHTML(list) {
  const f = filterOf(list.id);
  const all = store.items(list.id);
  const shown = all.filter((it) => passes(it, f));
  const p = store.tally(shown);
  const counts = Object.fromEntries(FILTERS.map((x) => [x, all.filter((it) => passes(it, x)).length]));
  const custom = shown.filter((it) => !it.seed);
  return `<div class="checklist sectioned" data-list="${esc(list.id)}">
    <div class="cl-head"><b>${f === 'All' ? 'Items' : `${esc(f)} items`}</b><span>${p.done}/${p.total}</span></div>
    ${progressBar(p)}
    <div class="filters" role="group" aria-label="Show">${FILTERS.map((x) => `<button type="button" class="opt${x === f ? ' on' : ''}" data-filter="${x}" aria-pressed="${x === f}">${x}<em>${counts[x]}</em></button>`).join('')}</div>
    ${list.sections.map((sec) => sectionHTML(list, sec, shown)).join('')}
    ${custom.length ? sectionHTML(list, { id: 'added', title: 'Added' }, custom) : ''}
    ${f === 'All' ? addRow(list.id) : `<p class="filter-note">Showing ${esc(f)} only — switch to All to add an item.</p>`}
  </div>`;
}

function sectionHTML(list, sec, shown) {
  const items = shown.filter((it) => (sec.id === 'added' ? !it.seed : it.section === sec.id));
  if (!items.length) return '';
  const p = store.tally(items.filter((it) => it.priority !== 'Skip'));
  const key = `${list.id}/${sec.id}`;
  const open = !uiState.closed.has(key);
  return `<details class="sec-grp"${open ? ' open' : ''}>
    <summary data-toggle-sec="${esc(key)}"><span class="grp">${esc(sec.title)}</span><span class="cnt">${p.total ? `${p.done}/${p.total}` : ''}</span></summary>
    ${sec.intro ? `<p class="sec-intro">${rich(sec.intro)}</p>` : ''}
    ${(sec.infoBefore || []).map((c) => infoCard(c)).join('')}
    <ul class="items">${items.map((it) => itemHTML(it, sec)).join('')}</ul>
    ${sec.note ? `<p class="sec-note">${rich(sec.note)}</p>` : ''}
    ${(sec.infoAfter || []).map((c) => infoCard(c)).join('')}
  </details>`;
}

/** Read-only, collapsible text: buying rules, the priority key, mechanism notes, the balm recipe. */
function infoCard(c, cls = '') {
  const open = uiState.open.has(c.id);
  const body = c.blocks.map((b) => {
    if (b.type === 'p') return `<p>${rich(b.text)}</p>`;
    const tag = b.type === 'ol' ? 'ol' : 'ul';
    return `<${tag}>${b.items.map((t) => `<li>${rich(t)}</li>`).join('')}</${tag}>`;
  }).join('');
  return `<details class="info ${cls}"${open ? ' open' : ''}>
    <summary data-toggle-info="${esc(c.id)}"><span>${rich(c.title)}</span><i aria-hidden="true">›</i></summary>
    <div class="info-body">${body}</div>
  </details>`;
}

const PRI_CLASS = { Must: 'must', Nice: 'nice', Later: 'later', Skip: 'skip' };
/** Priority tag + quantity (single, or per-size for 1A) on one compact line. */
function itemFoot(it, sec) {
  const bits = [];
  if (it.priority) bits.push(`<span class="tag ${PRI_CLASS[it.priority] || ''}">${esc(it.priority)}</span>`);
  if (it.sizes && sec?.sizes) {
    bits.push(`<span class="qty sizes">${sec.sizes.map((label, i) => `<span><small>${esc(label)}</small>${esc(it.sizes[i] ?? '—')}</span>`).join('')}</span>`);
  } else if (it.qty && it.qty !== '—') {
    bits.push(`<span class="qty">×${esc(it.qty)}</span>`);
  }
  bits.push(...costFoot(it));
  return bits.length ? `<div class="item-foot">${bits.join('')}</div>` : '';
}

function itemHTML(it, sec) {
  if (uiState.editing === `item:${it.id}`) {
    return `<li class="item editing"><div class="editor">
      <input type="text" data-hold value="${esc(it.text)}" data-edit-text="${esc(it.id)}">
      ${BUDGET_LISTS.includes(it.listId) ? costEditor(it) : ''}
      <div class="row">
        <button class="btn sm primary" data-save-item="${esc(it.id)}">Save</button>
        <button class="btn sm" data-cancel-edit>Cancel</button>
        <button class="btn sm danger" data-delete-item="${esc(it.id)}">Delete</button>
      </div></div></li>`;
  }
  const meta = it.done ? `Checked by ${stamp(it.checkedBy, it.checkedAt)}` : (it.custom ? `Added by ${stamp(it.createdBy, it.createdAt)}` : '');
  const cls = ['item', it.done ? 'done' : '', it.child ? 'child' : '', it.priority === 'Skip' ? 'skip' : ''].filter(Boolean).join(' ');
  return `<li class="${cls}">
    <label class="chk"><input type="checkbox" data-item="${esc(it.id)}" ${it.done ? 'checked' : ''}><span class="box"></span></label>
    <div class="item-body">
      <div class="item-text">${rich(it.text)}</div>
      ${itemFoot(it, sec)}
      ${it.notes ? `<div class="item-note">${rich(it.notes)}</div>` : ''}
      ${meta ? `<div class="item-meta">${meta}</div>` : ''}
    </div>
    <button class="more" data-edit-item="${esc(it.id)}" aria-label="Edit item">⋯</button>
  </li>`;
}

function guideHTML(g, { withList = true } = {}) {
  const list = withList && store.listFor(g.id);
  return `<article class="gsec" id="${esc(g.id)}">
    <span class="tag ${esc(g.tagKind)}">${esc(g.tag)}</span>
    <h2 class="serif">${esc(g.title)}</h2>
    <div class="gsub">${esc(g.sub)}</div>
    ${g.html}
  </article>
  ${list ? `<p class="gsec-note">The checklist above is the live version of this section's list — the guide text is kept verbatim from v1.</p>` : ''}`;
}

/** Bind checklist interactions on a frame (delegated). */
function bindChecklist(frame, view) {
  frame.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-item]');
    if (!cb) return;
    const id = cb.dataset.item;
    const listId = cb.closest('[data-list]').dataset.list;
    const done = cb.checked;
    store.write('items', id, { listId, done, checkedBy: done ? store.user : null, checkedAt: done ? Date.now() : null });
  });
  frame.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-add-item]');
    if (!form) return;
    e.preventDefault();
    const text = form.text.value.trim();
    if (!text) return;
    store.write('items', 'c-' + store.uid(), { custom: true, listId: form.dataset.addItem, text, done: false });
    form.reset();
  });
  frame.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) { uiState.filter.set(chip.closest('[data-list]').dataset.list, chip.dataset.filter); view.update(); return; }
    const co = e.target.closest('[data-cost-opt]');
    if (co) { for (const b of co.parentElement.querySelectorAll('[data-cost-opt]')) b.classList.toggle('on', b === co && !co.classList.contains('on')); return; }
    // <details> toggles itself after this click lands; remember the new state so a re-render keeps it
    const sum = e.target.closest('summary[data-toggle-sec],summary[data-toggle-info]');
    if (sum) {
      const willOpen = !sum.parentElement.open;
      if (sum.dataset.toggleSec !== undefined) uiState.closed[willOpen ? 'delete' : 'add'](sum.dataset.toggleSec);
      else uiState.open[willOpen ? 'add' : 'delete'](sum.dataset.toggleInfo);
      return;
    }
    const t = e.target.closest('[data-edit-item],[data-save-item],[data-cancel-edit],[data-delete-item]');
    if (!t) return;
    if (t.dataset.editItem !== undefined) { uiState.editing = `item:${t.dataset.editItem}`; view.update(); frame.querySelector('[data-edit-text]')?.focus(); }
    else if (t.dataset.cancelEdit !== undefined) { uiState.editing = null; view.update(); }
    else if (t.dataset.saveItem !== undefined) {
      const id = t.dataset.saveItem;
      const text = frame.querySelector(`[data-edit-text="${CSS.escape(id)}"]`).value.trim();
      const listId = t.closest('[data-list]').dataset.list;
      const cost = readCostEditor(t.closest('.editor'));
      uiState.editing = null;
      document.activeElement?.blur?.();   // a focused editor field would hold the re-render
      if (!text) { view.update(); return; }
      store.write('items', id, { listId, text }).then(() => { if (cost) store.saveItemCost(id, listId, cost); });
    } else if (t.dataset.deleteItem !== undefined) {
      if (!confirm('Delete this item?')) return;
      uiState.editing = null;
      store.remove('items', t.dataset.deleteItem);
    }
  });
}

// ---------- TODAY ----------
const fmtLong = (iso) => formatDate(iso, { weekday: false, year: true });
const today = {
  render(root) {
    root.innerHTML = `<section class="today" id="todayFrame"></section>`;
    this.frame = root.firstElementChild;
    bindQuickRow(this.frame);
    // "This week": ticks, show-all, add, and links into decisions / lists / visits
    this.frame.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-wa]');
      if (cb) store.setActionDone(cb.dataset.wa, cb.checked);
    });
    this.frame.addEventListener('submit', (e) => {
      const form = e.target.closest('form[data-wa-add]');
      if (!form) return;
      e.preventDefault();
      const title = form.title.value.trim();
      if (!title) return;
      store.addWeekAction({ week: Number(form.dataset.waAdd), title }).then(() => { form.reset(); window.toast?.('Added to this week'); });
    });
    this.frame.addEventListener('click', (e) => {
      const fold = e.target.closest('summary[data-fold]');
      if (fold) { uiState.open[fold.parentElement.open ? 'delete' : 'add'](fold.dataset.fold); return; }
      const all = e.target.closest('[data-wa-all]');
      if (all) { uiState.open[uiState.open.has('wa-all') ? 'delete' : 'add']('wa-all'); this.update(); return; }
      const link = e.target.closest('[data-wa-link]');
      if (link) {
        const { kind, id } = linkTarget(link.dataset.waLink);
        if (kind === 'decision') uiState.open.add(`dec:${id}`);   // land with that decision open
        location.hash = `#${linkHash(link.dataset.waLink)}`;
      }
    });
    // The due-date banner's one action (and its way back). Both confirm first
    // and both are ordinary settings/due writes stamped with who and when.
    this.frame.addEventListener('click', (e) => {
      const t = e.target.closest('[data-due-apply],[data-due-revert]');
      if (!t) return;
      const b = store.dueBanner();
      if (!b) return;
      if (t.hasAttribute('data-due-apply')) {
        if (!confirm(`Update the app's due date to ${fmtLong(b.confirmed)}?\n\nThe week counter, countdown and every estimate will follow. Dates you've confirmed and the weeks already stamped on past visits stay as they are.`)) return;
        store.applyConfirmedDue().then(() => window.toast?.(`Due date set to ${fmtLong(b.confirmed)} — estimates updated`));
      } else {
        if (!confirm(`Go back to ${fmtLong(DUE)} as the app's due date?`)) return;
        store.revertDue().then(() => window.toast?.(`Due date back to ${fmtLong(DUE)}`));
      }
    });
    this.update();
  },
  update() {
    const s = summary();
    const m = store.seed.meta;
    const evs = store.events();
    // events() is already in date order; windows (from/to) follow confirmed dates + the live due date
    // The growth note is picked by the same week the pill shows (summary().g), never by date.
    const growth = noteFor(s.g.weeks, store.devNotes());
    const next = evs.filter((e) => e.category !== 'dev' && e.to >= s.iso && !e.state.done).slice(0, 3);
    const overdue = evs.filter((e) => e.category !== 'dev' && e.to < s.iso && !e.state.done);
    const open = store.openQuestions().length;
    const banner = store.dueBanner();
    const dueDoc = store.dueDoc;
    const nextVisit = sortVisits(store.visits()).upcoming[0];
    const pill = s.weekLabel === '40+'
      ? `<b>40+</b><span>weeks — any moment now</span>`
      : `<b>${s.g.weeks}w ${s.g.day}d</b><span>pregnant today</span>`;
    const count = s.pastDue ? `Due date was ${formatDate(s.due)} · baby's call now` : s.dueToday ? `Today is the due date 🌟` : `${s.left} days to ${formatDate(s.due, { weekday: false })} · ${s.weeksLeft} weeks to go`;
    // v1's "Due May 11, 2027 · Renewal Center…" line, with the live due date swapped in
    const dueLine = m.due.replace(/^Due \w+ \d+, \d{4}/, `Due ${formatDate(s.due, { weekday: false, year: true })}`);
    this.frame.innerHTML = `
      <div class="hero">
        <div class="hdr-eyebrow">${esc(m.eyebrow)}</div>
        <h1 class="serif">Baby <span class="amp">Hightower</span></h1>
        <div class="hdr-due">${esc(dueLine)}</div>
        <div class="weekpill">${pill}</div>
        <div class="countline">${count}</div>
        <div class="chips"><span class="chip">Trimester ${s.trimester}</span><span class="chip sand">${formatDate(s.iso, { weekday: true })}</span></div>
      </div>
      ${quickRow()}
      ${banner ? `<div class="sec"><div class="due-banner ${banner.kind}">
        <div class="k">Dating ultrasound</div>
        <p>${esc(banner.title)}</p>
        ${banner.action
          ? `<small>The app is still counting from ${fmtLong(store.due)}.</small><div class="row"><button class="btn sm primary" data-due-apply>Update app due date</button></div>`
          : `<small>App due date is ${fmtLong(store.due)}${dueDoc?.setBy ? ` · updated by ${stamp(dueDoc.setBy, dueDoc.setAt)}` : ''}.</small>${banner.revert ? `<div class="row"><button class="btn sm" data-due-revert>Back to ${fmtLong(DUE)}</button></div>` : ''}`}
      </div></div>` : ''}
      ${growth ? `<div class="sec"><div class="now-card"><div class="k">Baby is growing · week ${esc(s.weekLabel)}</div><p>${esc(growth.note.title)}</p><small class="range">Note for ${esc(growth.label.toLowerCase())}${growth.to === 40 ? '+' : ''}</small></div></div>` : ''}
      ${this.weekCard(s.g.weeks)}
      <div class="sec"><div class="sec-head"><h2 class="serif">Up next</h2><small>${next.length ? 'tap for the plan' : ''}</small></div>
        ${next.length ? `<div class="spine">${next.map((e) => eventCard(e, s.iso)).join('')}</div>` : `<div class="empty"><b>Nothing left on the timeline</b>Everything's either done or behind you.</div>`}
      </div>
      ${nextVisit ? `<button class="linkrow" data-go="visits/v/${esc(nextVisit.key)}"><span>Next visit: ${nextVisit.date ? formatDate(nextVisit.date) : 'date to set'} · ${esc(visitType(nextVisit))}<small>${nextVisit.time ? `${formatTime(nextVisit.time)} · ` : ''}${esc(nextVisit.provider || '')}</small></span><span class="arrow">→</span></button>` : ''}
      <button class="linkrow" data-go="notes/questions"><span>${open ? `${open} question${open === 1 ? '' : 's'} queued for the next visit` : 'No questions queued for the next visit'}<small>Anyone can add one, anytime</small></span><span class="arrow">→</span></button>
      ${overdue.length ? `<button class="linkrow" data-go="timeline"><span>${overdue.length} past event${overdue.length === 1 ? '' : 's'} not marked complete<small>Open the timeline to tick them off</small></span><span class="arrow">→</span></button>` : ''}`;
  },
};

/** The "This week" action card: the same week number as the pill (summary().g.weeks). */
today.weekCard = function weekCard(week) {
  const all = store.weekActionList();
  const items = actionsFor(all, week);
  const showAll = uiState.open.has('wa-all');
  const shown = showAll ? items : items.slice(0, SHOW);
  const next = items.length ? null : nextAfter(all, week);
  const ahead = upcoming(all, week);
  const range = weekRange(week);
  const row = (a, withWeek = false) => `<li class="item wa${a.done ? ' done' : ''}">
      <label class="chk"><input type="checkbox" data-wa="${esc(a.key)}" ${a.done ? 'checked' : ''}><span class="box"></span></label>
      <div class="item-body">
        <div class="item-text">${withWeek ? `<span class="wa-week">wk ${a.week}</span>` : ''}${esc(a.title)}</div>
        <div class="item-foot"><span class="tag ${a.category === 'Decision' ? 'mon' : a.category === 'Appointment' || a.category === 'Class' ? 'fam' : 'med'}">${esc(categoryOf(a))}</span>${a.detail ? `<span class="wa-detail">${esc(a.detail)}</span>` : ''}${a.done ? `<span class="item-meta">Done by ${stamp(a.doneBy, a.doneAt)}</span>` : ''}</div>
      </div>
      ${a.linkTo && linkHash(a.linkTo) ? `<button class="more wa-go" data-wa-link="${esc(a.linkTo)}" aria-label="Open">→</button>` : ''}
    </li>`;
  return `<div class="sec"><div class="now-card wa-card">
    <div class="k">This week · week ${week}</div>
    <small class="range">${esc(range.label)}</small>
    ${items.length
      ? `<ul class="items wa-list">${shown.map((a) => row(a)).join('')}</ul>${items.length > SHOW ? `<button type="button" class="btn sm ghost" data-wa-all>${showAll ? 'Show fewer' : `Show all (${items.length})`}</button>` : ''}`
      : next
        ? `<p class="wa-empty">Nothing on the plan for week ${week}.</p><div class="wa-week wa-next">Next up · week ${next.week}</div><ul class="items wa-list">${row(next)}</ul>`
        : `<p class="wa-empty">Nothing on the plan for week ${week}, or after it.</p>`}
    <form class="addrow wa-add" data-wa-add="${week}"><input type="text" name="title" placeholder="Add something for this week…" autocomplete="off" enterkeyhint="done" data-hold><button class="btn sm primary" type="submit">Add</button></form>
    <details class="info wa-ahead"${uiState.open.has('wa-ahead') ? ' open' : ''}><summary data-fold="wa-ahead"><span>Next 4 weeks${ahead.length ? ` · ${ahead.reduce((n, g) => n + g.items.length, 0)}` : ''}</span><i aria-hidden="true">›</i></summary>
      <div class="info-body">${ahead.length ? ahead.map((g) => `<div class="grp wa-grp">Week ${g.week} <small>· ${esc(weekRange(g.week).label)}</small></div><ul class="items wa-list">${g.items.map((a) => row(a)).join('')}</ul>`).join('') : `<p class="hint">Nothing on the plan for weeks ${week + 1}–${week + 4}.</p>`}</div>
    </details>
  </div></div>`;
};

// ---------- TIMELINE ----------
const timeline = {
  render(root, params) {
    this.params = params;
    root.innerHTML = `<section id="tlFrame"></section>`;
    this.frame = root.firstElementChild;
    bindChecklist(this.frame, this);
    this.frame.addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle-ev]');
      if (!t) return;
      const id = t.dataset.toggleEv;
      const done = !store.get('events', id)?.done;
      store.write('events', id, { done, doneBy: done ? store.user : null, doneAt: done ? Date.now() : null });
    });
    let timer;
    this.frame.addEventListener('input', (e) => {
      const ta = e.target.closest('textarea[data-ev-notes]');
      if (!ta) return;
      clearTimeout(timer);
      timer = setTimeout(() => store.write('events', ta.dataset.evNotes, { notes: ta.value }), 500);
    });
    this.update();
  },
  update() {
    const [kind, id] = this.params;
    if (kind === 'ev') return this.detail(id);
    if (kind === 'guide') return this.guide(id);
    const iso = todayISO();
    const legend = store.seed.meta.legend;
    const evs = store.events(); // date order; each knows its trimester under the live due date
    // v1's range lines ('Nov 9 → Feb 15 · weeks 14–27'), recomputed from the due date
    const d = (w, dd) => formatDate(dateAt(w, dd), { weekday: false });
    const ranges = [`now → ${d(13, 6)} · weeks 1–13`, `${d(14, 0)} → ${d(28, 0)} · weeks 14–27`, `${d(28, 1)} → baby · weeks 28–40`];
    this.frame.innerHTML = `
      <div class="legend">
        <span><i style="background:var(--sage)"></i>${esc(legend[0])}</span>
        <span><i style="background:var(--blush-deep)"></i>${esc(legend[1])}</span>
        <span><i style="background:var(--sand-deep)"></i>${esc(legend[2])}</span>
        <span><i style="background:var(--cream);border:2px solid var(--sage-deep);width:8px;height:8px"></i>${esc(legend[3])}</span>
      </div>
      ${store.seed.trimesters.map((t, i) => `
        <div class="tri"><div class="tri-head"><h2 class="serif">${esc(t.title)}</h2><small>${esc(ranges[i])}</small></div>
        <p class="tri-sub">${esc(t.sub)}</p>
        <div class="spine">${evs.filter((e) => e.trimester === i + 1).map((e) => eventCard(e, iso)).join('')}</div></div>`).join('')}
      <div class="sec"><div class="sec-head"><h2 class="serif">The Guide</h2><small>every section from v1</small></div>
        <div class="guide-index">${store.seed.guide.map((g) => `<button class="card" data-go="timeline/guide/${esc(g.id)}"><div class="ev-date">${esc(g.tag)}</div><div class="ev-title">${esc(g.title)}</div></button>`).join('')}</div>
      </div>`;
  },
  detail(id) {
    const e = store.event(id);
    if (!e) { this.frame.innerHTML = `<div class="page"><button class="back" data-go="timeline">← Timeline</button><div class="empty">That event isn't on the timeline.</div></div>`; return; }
    const st = e.state;
    const g = e.guide && store.guide(e.guide);
    const list = g && store.listFor(g.id);
    const notesFocused = document.activeElement?.dataset?.evNotes === id;
    if (notesFocused) return; // don't clobber typing; a later update will catch up
    this.frame.innerHTML = `<div class="page">
      <button class="back" data-go="timeline">← Timeline</button>
      <div class="date-row">${dateLine(e)}<button class="btn sm ghost" data-edit-date="${esc(id)}">${e.confirmed ? 'Change' : 'Set date'} ›</button></div>
      ${e.confirmed ? `<small class="date-meta">Confirmed by ${stamp(st.dateBy, st.dateAt)} · estimate was ${esc(estLabel(e, false))}</small>` : `<small class="date-meta">Estimate · ${formatGestation(summaryAt(e.from))} on ${esc(formatDate(e.from))}</small>`}
      <h2 class="title">${esc(e.title)}</h2>
      ${e.note ? `<p class="ev-note">${esc(e.note)}</p>` : ''}
      <div class="state-row">
        <button class="btn toggle${st.done ? ' on' : ''}" data-toggle-ev="${esc(id)}">
          <span class="box">${st.done ? '✓' : ''}</span>
          <span>${st.done ? 'Completed' : 'Mark complete'}${st.done ? `<small>by ${stamp(st.doneBy, st.doneAt)}</small>` : '<small>tap when it\'s handled</small>'}</span>
        </button>
      </div>
      <label class="field"><span>Notes for this event</span>
        <textarea data-hold data-ev-notes="${esc(id)}" placeholder="Anything to remember about this one…">${esc(st.notes || '')}</textarea>
        ${st.notes ? `<small>Last edited by ${stamp(st.updatedBy, st.updatedAt)}</small>` : ''}
      </label>
      ${list ? `<div class="sec-head" style="margin-top:18px"><h2 class="serif">${esc(list.title)}</h2><button class="btn sm ghost" data-go="checklists/${esc(list.id)}">Open list →</button></div>${checklistHTML(list.id)}` : ''}
      ${g ? guideHTML(g) : ''}
    </div>`;
  },
  guide(id) {
    const g = store.guide(id);
    if (!g) { this.frame.innerHTML = `<div class="page"><button class="back" data-go="timeline">← Timeline</button><div class="empty">No such guide section.</div></div>`; return; }
    const list = store.listFor(g.id);
    this.frame.innerHTML = `<div class="page">
      <button class="back" data-go="timeline">← Timeline</button>
      ${list ? `<div class="sec-head"><h2 class="serif">${esc(list.title)}</h2><button class="btn sm ghost" data-go="checklists/${esc(list.id)}">Open list →</button></div>${checklistHTML(list.id)}` : ''}
      ${guideHTML(g)}
    </div>`;
  },
};
const summaryAt = (iso) => summary(iso).g;

// ---------- CHECKLISTS ----------
const checklists = {
  render(root, params) {
    this.params = params;
    // #checklists/decisions → the Open Decisions Log, its own page under a back button
    if (params[0] === 'decisions') {
      root.innerHTML = `<div class="page"><button class="back" data-go="checklists">← Lists</button><div id="decHost"></div></div>`;
      decisions.render(root.querySelector('#decHost'));
      return;
    }
    // #checklists/budget → the spend tracker
    if (params[0] === 'budget') {
      root.innerHTML = `<div class="page"><button class="back" data-go="checklists">← Lists</button><div id="budgetHost"></div></div>`;
      budget.render(root.querySelector('#budgetHost'));
      return;
    }
    root.innerHTML = `<section id="clFrame"></section>`;
    this.frame = root.firstElementChild;
    bindChecklist(this.frame, this);
    this.update();
  },
  update() {
    const [listId] = this.params;
    if (listId === 'decisions') return decisions.update();
    if (listId === 'budget') return budget.update();
    if (listId) {
      const list = store.seed.lists.find((l) => l.id === listId);
      if (!list) { this.frame.innerHTML = `<div class="page"><button class="back" data-go="checklists">← Lists</button><div class="empty">No such list.</div></div>`; return; }
      const g = store.guide(list.guide);
      this.frame.innerHTML = `<div class="page">
        <button class="back" data-go="checklists">← Lists</button>
        <h2 class="title">${esc(list.title)}</h2>
        <p class="ev-note">${esc(list.sub)}</p>
        ${(list.info || []).map((c) => infoCard(c, 'top')).join('')}
        ${BUDGET_LISTS.includes(listId) ? `<button class="linkrow" data-go="checklists/budget"><span>Budget<small>${(() => { const b = summarize(store.budgetItems().filter((it) => it.listId === listId)); return `${fmtMoney(b.spent)} spent · ${fmtMoney(b.committed)} committed on this list`; })()}</small></span><span class="arrow">→</span></button>` : ''}
        ${checklistHTML(listId)}
        ${g ? `<button class="linkrow" data-go="timeline/guide/${esc(g.id)}"><span>Read the guide: ${esc(g.title)}<small>${esc(g.tag)}</small></span><span class="arrow">→</span></button>` : ''}
      </div>`;
      return;
    }
    const decs = store.decisions();
    const closed = decs.filter((d) => decStatus(d) === 'Closed').length;
    const dp = { done: closed, total: decs.length, pct: decs.length ? Math.round((closed / decs.length) * 100) : 0 };
    const b = summarize(store.budgetItems(), store.ceiling);
    this.frame.innerHTML = `
      <div class="sec-head"><h2 class="serif">Checklists</h2><small>who checked what, on both phones</small></div>
      <button class="list-card budget-index" data-go="checklists/budget">
        <div class="t"><b>Budget</b><span>${fmtMoney(b.committed)} of ${fmtMoney(b.ceiling)}</span></div>
        <div class="s">${fmtMoney(b.spent)} spent · ${fmtMoney(b.remaining)} remaining${b.unpriced ? ` · ${b.unpriced} unpriced` : ''}</div>
        <div class="bar ${b.tone}"><i style="width:${Math.min(b.pct, 100)}%"></i></div>
      </button>
      <button class="list-card dec-index" data-go="checklists/decisions">
        <div class="t"><b>Open decisions</b><span>${closed}/${decs.length} closed</span></div>
        <div class="s">${decs.length - closed} still open · mirrors the master plan doc</div>
        ${progressBar(dp)}
      </button>
      ${store.seed.lists.map((l) => { const p = store.progress(l.id); return `
        <button class="list-card" data-go="checklists/${esc(l.id)}">
          <div class="t"><b>${esc(l.title)}</b><span>${p.done}/${p.total}</span></div>
          <div class="s">${esc(l.sub)}</div>
          ${progressBar(p)}
        </button>`; }).join('')}`;
  },
};

// ---------- NOTES ----------
const notes = {
  render(root) {
    root.innerHTML = `<section id="notesFrame">
      <form class="compose" id="noteForm">
        <textarea name="text" placeholder="Write a note… (cravings, a number to remember, what the midwife said)" rows="3"></textarea>
        <div class="row"><small>Posting as <b>${esc(store.user)}</b></small><button class="btn primary" type="submit">Add note</button></div>
      </form>
      <input type="search" class="search" id="noteSearch" placeholder="Search notes" autocomplete="off">
      <div id="noteList"></div>
    </section>`;
    this.frame = root.firstElementChild;
    this.listEl = this.frame.querySelector('#noteList');
    this.frame.querySelector('#noteForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const ta = e.target.text;
      const text = ta.value.trim();
      if (!text) return;
      store.write('notes', 'n-' + store.uid(), { text, author: store.user });
      ta.value = '';
      ta.blur();
    });
    this.frame.querySelector('#noteSearch').addEventListener('input', () => this.update());
    this.frame.addEventListener('click', (e) => {
      const t = e.target.closest('[data-edit-note],[data-save-note],[data-cancel-edit],[data-delete-note]');
      if (!t) return;
      if (t.dataset.editNote !== undefined) { uiState.editing = `note:${t.dataset.editNote}`; this.update(); this.frame.querySelector('[data-edit-text]')?.focus(); }
      else if (t.dataset.cancelEdit !== undefined) { uiState.editing = null; this.update(); }
      else if (t.dataset.saveNote !== undefined) {
        const text = this.frame.querySelector('[data-edit-text]').value.trim();
        uiState.editing = null;
        if (text) store.write('notes', t.dataset.saveNote, { text }); else this.update();
      } else if (t.dataset.deleteNote !== undefined) {
        if (!confirm('Delete this note?')) return;
        uiState.editing = null;
        store.remove('notes', t.dataset.deleteNote);
      }
    });
    this.update();
  },
  update() {
    const q = (this.frame.querySelector('#noteSearch').value || '').trim().toLowerCase();
    const all = store.notes();
    const list = q ? all.filter((n) => (n.text || '').toLowerCase().includes(q) || (n.author || '').toLowerCase().includes(q)) : all;
    if (!list.length) { this.listEl.innerHTML = `<div class="empty"><b>${q ? 'No matches' : 'No notes yet'}</b>${q ? 'Try another word.' : 'Both of you can post here; newest on top.'}</div>`; return; }
    this.listEl.innerHTML = list.map((n) => {
      if (uiState.editing === `note:${n.key}`) {
        return `<article class="note"><div class="editor">
          <textarea data-hold data-edit-text>${esc(n.text)}</textarea>
          <div class="row"><button class="btn sm primary" data-save-note="${esc(n.key)}">Save</button><button class="btn sm" data-cancel-edit>Cancel</button><button class="btn sm danger" data-delete-note="${esc(n.key)}">Delete</button></div>
        </div></article>`;
      }
      const edited = n.updatedAt && n.updatedAt - (n.createdAt || 0) > 2000 ? ` · edited by ${stamp(n.updatedBy, n.updatedAt)}` : '';
      return `<article class="note"><div class="body">
        <div class="note-meta"><b>${esc(n.author || n.createdBy)}</b> · ${formatStamp(n.createdAt)}${edited}</div>
        <div class="note-text">${esc(n.text)}</div></div>
        <button class="more" data-edit-note="${esc(n.key)}" aria-label="Edit note">⋯</button></article>`;
    }).join('');
  },
};

// ---------- OB QUESTIONS ----------
// Statuses (stored): to_ask = Open · asked · answered · dropped = No longer
// relevant. A question written before 1.5.0 has to_ask and reads as Open;
// nothing is rewritten. askedAtVisitId ties a question to a visit (set from
// the visit page, or when an answer is saved there).
const questions = {
  render(root) {
    root.innerHTML = `<section id="qFrame">
      <form class="ask" id="qForm">
        <input type="text" name="text" placeholder="Ask at the next visit…" autocomplete="off" enterkeyhint="done">
        <button class="btn primary" type="submit">Add</button>
      </form>
      <div class="filters q-filters" role="group" aria-label="Show" id="qFilters"></div>
      <div id="qList"></div>
    </section>`;
    this.frame = root.firstElementChild;
    const form = this.frame.querySelector('#qForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = e.target.text;
      const text = inp.value.trim();
      if (!text) return;
      store.write('questions', 'q-' + store.uid(), { text, status: 'to_ask', author: store.user, answer: '' });
      inp.value = '';
      if ((uiState.filter.get('questions') || 'Open') === 'Answered') { uiState.filter.set('questions', 'Open'); this.update(); }
    });
    // iOS "done" key: make sure Enter always submits, even in standalone mode
    form.text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } });
    this.frame.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-q-filter]');
      if (chip) { uiState.filter.set('questions', chip.dataset.qFilter); this.update(); return; }
      // an answered card is a <details>; remember whether it's open so a re-render keeps it
      const sum = e.target.closest('summary[data-q-fold]');
      if (sum) { uiState.open[sum.parentElement.open ? 'delete' : 'add'](`q:${sum.dataset.qFold}`); return; }
      const t = e.target.closest('[data-q]');
      if (!t) return;
      const key = t.dataset.q, act = t.dataset.act;
      const q = store.get('questions', key);
      if (act === 'asked') store.write('questions', key, { status: 'asked', askedBy: store.user, askedAt: Date.now() });
      else if (act === 'answer') { uiState.answering.add(key); this.update(); this.frame.querySelector(`textarea[data-q-ans="${CSS.escape(key)}"]`)?.focus(); }
      else if (act === 'save') {
        const ta = this.frame.querySelector(`textarea[data-q-ans="${CSS.escape(key)}"]`);
        const answer = ta.value.trim();
        if (!answer) { ta.focus(); return; }
        uiState.answering.delete(key);
        ta.blur();
        store.write('questions', key, { status: 'answered', answer, answeredBy: store.user, answeredAt: Date.now(), askedBy: q.askedBy || store.user, askedAt: q.askedAt || Date.now() });
      }
      else if (act === 'hide') { uiState.answering.delete(key); this.update(); }
      else if (act === 'unask') store.write('questions', key, { status: 'to_ask', askedAtVisitId: null });
      else if (act === 'reopen') store.write('questions', key, { status: 'to_ask' });
      else if (act === 'drop') store.write('questions', key, { status: 'dropped', droppedBy: store.user, droppedAt: Date.now() });
      else if (act === 'delete') { if (confirm('Delete this question?')) store.remove('questions', key); }
    });
    this.update();
  },
  update() {
    const f = uiState.filter.get('questions') || 'Open';
    const all = store.questions();
    const counts = Object.fromEntries(Q_FILTERS.map((x) => [x, all.filter((q) => qPasses(q, x)).length]));
    const rank = { to_ask: 0, asked: 0, answered: 1, dropped: 2 };
    const list = all.filter((q) => qPasses(q, f)).sort((a, b) => {
      const ra = rank[qStatus(a)], rb = rank[qStatus(b)];
      if (ra !== rb) return ra - rb;
      return ra === 1 ? (b.answeredAt || 0) - (a.answeredAt || 0) : (a.createdAt || 0) - (b.createdAt || 0);
    });
    this.frame.querySelector('#qFilters').innerHTML = Q_FILTERS.map((x) => `<button type="button" class="opt${x === f ? ' on' : ''}" data-q-filter="${x}" aria-pressed="${x === f}">${x}<em>${counts[x]}</em></button>`).join('');
    const empty = f === 'Answered'
      ? `<div class="empty"><b>Nothing answered yet</b>Answers land here, with the visit they came from.</div>`
      : `<div class="empty"><b>Nothing queued</b>Type a question above — it lands here for whoever's at the visit.</div>`;
    this.frame.querySelector('#qList').innerHTML = list.length ? list.map((q) => this.card(q)).join('') : empty;
  },
  /** 'at the Tue, Oct 6 visit' — or nothing if the question wasn't tied to one. */
  visitRef(q) {
    if (!q.askedAtVisitId) return '';
    const v = store.visit(q.askedAtVisitId);
    return v ? `<button class="q-visit" data-go="visits/v/${esc(v.key)}">at the ${v.date ? formatDate(v.date) : 'undated'} visit →</button>` : 'at a visit since removed';
  },
  card(q) {
    const key = q.key, st = qStatus(q);
    const answering = st === 'asked' || uiState.answering.has(key);
    if (st === 'answered') {
      const open = uiState.open.has(`q:${key}`);
      return `<details class="q answered q-fold"${open ? ' open' : ''}>
        <summary data-q-fold="${key}"><div class="q-text">${esc(q.text)}</div><div class="q-meta">Answered by ${stamp(q.answeredBy, q.answeredAt)}${q.askedAtVisitId ? ' · ' + this.visitRef(q) : ''}</div></summary>
        <div class="ans"><span class="k">Answer</span>${esc(q.answer)}</div>
        <div class="q-meta">Added by ${stamp(q.author || q.createdBy, q.createdAt)}${q.askedBy ? ` · asked by ${stamp(q.askedBy, q.askedAt)}` : ''}</div>
        <div class="q-actions"><button class="btn sm" data-q="${key}" data-act="reopen">Ask again</button><button class="btn sm danger ghost" data-q="${key}" data-act="delete">Delete</button></div>
      </details>`;
    }
    if (st === 'dropped') {
      return `<article class="q dropped">
        <div class="q-top"><div class="q-text">${esc(q.text)}</div></div>
        <div class="q-meta">No longer relevant · ${stamp(q.droppedBy || q.updatedBy, q.droppedAt || q.updatedAt)}</div>
        <div class="q-actions"><button class="btn sm" data-q="${key}" data-act="reopen">Reopen</button><button class="btn sm danger ghost" data-q="${key}" data-act="delete">Delete</button></div>
      </article>`;
    }
    const meta = [`Added by ${stamp(q.author || q.createdBy, q.createdAt)}`];
    if (st === 'asked') meta.push(`<b>Asked</b> by ${stamp(q.askedBy, q.askedAt)}${q.askedAtVisitId ? ' ' + this.visitRef(q) : ''}`);
    let actions;
    if (answering) {
      actions = `<div class="q-answer"><textarea data-hold data-q-ans="${key}" placeholder="What did they say?">${esc(q.answer || '')}</textarea></div>
        <div class="q-actions"><button class="btn primary" data-q="${key}" data-act="save">Save answer</button>
        ${st === 'asked' ? `<button class="btn" data-q="${key}" data-act="unask">Not asked yet</button>` : `<button class="btn" data-q="${key}" data-act="hide">Cancel</button>`}</div>`;
    } else {
      actions = `<div class="q-actions"><button class="btn" data-q="${key}" data-act="asked">✓ Asked</button><button class="btn primary" data-q="${key}" data-act="answer">Answer</button><button class="btn ghost" data-q="${key}" data-act="drop">No longer relevant</button></div>`;
    }
    return `<article class="q ${esc(st)}">
      <div class="q-top"><div class="q-text">${esc(q.text)}</div><button class="more" data-q="${key}" data-act="delete" aria-label="Delete">⋯</button></div>
      <div class="q-meta">${meta.join(' · ')}</div>
      ${actions}</article>`;
  },
};

// ---------- NOTES & QUESTIONS (one tab, two segments) ----------
// #notes → Questions (the waiting-room view) · #notes/notes → Notes.
// Both panels above render into their own host and keep their own
// collections (`questions`, `notes`) exactly as before 1.2.0 — nothing moved.
const notesq = {
  render(root, params) {
    root.innerHTML = `<section id="nqFrame">
      <div class="seg" role="tablist" aria-label="Notes &amp; Questions">
        <button role="tab" data-go="notes/questions" data-seg="questions">Questions <span class="seg-n" id="segQCount" hidden></span></button>
        <button role="tab" data-go="notes/notes" data-seg="notes">Notes</button>
      </div>
      <div id="segQuestions" role="tabpanel"></div>
      <div id="segNotes" role="tabpanel" hidden></div>
    </section>`;
    this.frame = root.firstElementChild;
    questions.render(this.frame.querySelector('#segQuestions'));
    notes.render(this.frame.querySelector('#segNotes'));
    this.navigate(params);
  },
  navigate(params) {
    this.seg = params[0] === 'notes' ? 'notes' : 'questions';
    this.frame.querySelectorAll('[data-seg]').forEach((b) => {
      const on = b.dataset.seg === this.seg;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    });
    this.frame.querySelector('#segQuestions').hidden = this.seg !== 'questions';
    this.frame.querySelector('#segNotes').hidden = this.seg !== 'notes';
    this.update();
  },
  update() {
    const open = store.openQuestions().length;
    const n = this.frame.querySelector('#segQCount');
    n.textContent = open || '';
    n.hidden = !open;
    questions.update();
    notes.update();
  },
};

// ---------- OB CALL ----------
// The Wombkeepers first-call phone reference (js/obcall.js, verbatim) as a live
// checklist. State is the `obcall` collection, one document per thing:
//   <checkId>       { done, checkedBy, checkedAt }   every checkbox, incl. the scripts
//   f-<fieldId>     { value }                        fill-in fields
//   notes-<secId>   { notes }                        free notes under each step
const ob = {
  get: (key) => store.get('obcall', key) || {},
  checks: (sec) => sec.blocks.filter((b) => b.type === 'item' || b.type === 'quote'),
  progress(sections) {
    let done = 0, total = 0;
    for (const s of sections) for (const b of this.checks(s)) { total++; if (this.get(b.id).done) done++; }
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  },
  /** Escape, then apply the tiny inline markup the content uses. `fill` values are already HTML. */
  rich(text, fill) {
    let s = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/«(.+?)»/g, '<i class="say">$1</i>');
    if (fill) s = s.replace(/\{(\w+)\}/g, (m, k) => fill[k] ?? m);
    return s;
  },
};

const obcall = {
  render(root) {
    root.innerHTML = `<section class="obcall" id="obFrame"></section>`;
    this.frame = root.firstElementChild;
    this.timers = new Map();
    const f = this.frame;
    f.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-ob-check]');
      if (!cb) return;
      const done = cb.checked;
      store.write('obcall', cb.dataset.obCheck, { done, checkedBy: done ? store.user : null, checkedAt: done ? Date.now() : null });
    });
    f.addEventListener('click', (e) => {
      const t = e.target.closest('[data-ob-opt],[data-ob-reset],[data-er-jump]');
      if (!t) return;
      if (t.dataset.obOpt !== undefined) {
        const key = `f-${t.dataset.obOpt}`;
        const val = ob.get(key).value === t.dataset.val ? '' : t.dataset.val; // tap again to clear
        store.write('obcall', key, { value: val });
      } else if (t.dataset.obReset !== undefined) this.reset();
      else if (t.dataset.erJump !== undefined) f.querySelector('#erBox')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Typed fields: debounce while typing, flush on blur and when the phone locks mid-call.
    f.addEventListener('input', (e) => {
      const el = e.target.closest('[data-ob-field],[data-ob-notes]');
      if (el) this.queue(el);
    });
    f.addEventListener('focusout', (e) => this.flush(e.target));
    if (!this.bound) {
      this.bound = true;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flushAll(); });
      addEventListener('pagehide', () => this.flushAll());
    }
    this.update();
  },
  keyFor(el) { return el.dataset.obField !== undefined ? `f-${el.dataset.obField}` : `notes-${el.dataset.obNotes}`; },
  queue(el) {
    const key = this.keyFor(el);
    clearTimeout(this.timers.get(key)?.t);
    const write = () => {
      this.timers.delete(key);
      store.write('obcall', key, el.dataset.obField !== undefined ? { value: el.value } : { notes: el.value });
    };
    this.timers.set(key, { t: setTimeout(write, 400), write });
  },
  flush(el) {
    if (!el?.dataset || (el.dataset.obField === undefined && el.dataset.obNotes === undefined)) return;
    const p = this.timers.get(this.keyFor(el));
    if (p) { clearTimeout(p.t); p.write(); }
  },
  flushAll() { for (const p of [...this.timers.values()]) { clearTimeout(p.t); p.write(); } },
  reset() {
    if (!confirm('Reset the checklist? Every check, answer and note on this page is cleared — on both phones.')) return;
    for (const p of this.timers.values()) clearTimeout(p.t);
    this.timers.clear();
    for (const d of store.list('obcall')) {
      if (d.key.startsWith('f-')) { if (d.value) store.write('obcall', d.key, { value: '' }); }
      else if (d.key.startsWith('notes-')) { if (d.notes) store.write('obcall', d.key, { notes: '' }); }
      else if (d.done) store.write('obcall', d.key, { done: false, checkedBy: null, checkedAt: null });
    }
    window.toast?.('Checklist reset');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  update() {
    const C = OB_CALL;
    const g = summary().g;
    const gest = `${g.weeks} week${g.weeks === 1 ? '' : 's'}, ${g.day} day${g.day === 1 ? '' : 's'}`;
    const steps = C.sections.filter((s) => !s.optional);
    const p = ob.progress(steps);
    const anyState = store.list('obcall').some((d) => d.done || d.value || d.notes);
    this.frame.innerHTML = `
      <div class="ob-head">
        <div class="hdr-eyebrow">${esc(C.sub)}</div>
        <h2 class="title">${esc(C.title)}</h2>
        <div class="ob-progress"><b>${p.done} of ${p.total} done</b><small>${p.done === p.total ? 'all four steps covered' : 'steps 1–4 · saves on both phones'}</small></div>
        ${progressBar(p)}
      </div>
      <div class="facts">
        <div class="facts-title">${esc(C.facts.title)}</div>
        ${C.facts.rows.map((r) => `<div class="fact"><span class="k">${esc(r.k)}</span><span class="v">${ob.rich(r.v, { gestation: esc(gest) })}</span></div>`).join('')}
      </div>
      ${C.sections.map((s) => this.section(s)).join('')}
      <aside class="er" id="erBox">
        <div class="er-title">${esc(C.er.title)}</div>
        <ul>${C.er.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </aside>
      <p class="ob-foot">${esc(C.footer)}</p>
      <button class="btn danger ghost ob-reset" data-ob-reset ${anyState ? '' : 'disabled'}>Reset checklist</button>
      <button class="er-pin" data-er-jump aria-label="Jump to the ER warning"><span>${esc(C.er.title)}</span><i>↓</i></button>`;
    this.watchER();
  },
  section(s) {
    const p = ob.progress([s]);
    let html = '', ul = [];
    const closeUl = () => { if (ul.length) { html += `<ul class="items">${ul.join('')}</ul>`; ul = []; } };
    for (const b of s.blocks) {
      if (b.type === 'item') { ul.push(this.item(b)); continue; }
      closeUl();
      if (b.type === 'text') html += `<p class="ob-text">${ob.rich(b.text)}</p>`;
      else if (b.type === 'quote') html += this.quote(b);
    }
    closeUl();
    const n = ob.get(`notes-${s.id}`);
    return `<section class="ob-sec" id="ob-${esc(s.id)}">
      <div class="ob-sec-head"><div>${s.step ? `<span class="step">${esc(s.step)}</span>` : ''}<h2 class="serif">${esc(s.title)}</h2></div><span class="cnt">${p.done}/${p.total}</span></div>
      <div class="checklist ob-list">${html}</div>
      <label class="field ob-notes"><span>Their answers · notes</span>
        <textarea data-hold data-ob-notes="${esc(s.id)}" placeholder="Write down what they say…">${esc(n.notes || '')}</textarea>
        ${n.notes ? `<small>Last edited by ${stamp(n.updatedBy, n.updatedAt)}</small>` : ''}
      </label>
    </section>`;
  },
  item(b) {
    const st = ob.get(b.id);
    return `<li class="item${st.done ? ' done' : ''}">
      <label class="chk"><input type="checkbox" data-ob-check="${esc(b.id)}" ${st.done ? 'checked' : ''}><span class="box"></span></label>
      <div class="item-body">
        ${b.text ? `<div class="item-text">${ob.rich(b.text)}</div>` : ''}
        ${(b.fields || []).map((f) => this.field(f)).join('')}
        ${st.done ? `<div class="item-meta">Checked by ${stamp(st.checkedBy, st.checkedAt)}</div>` : ''}
      </div></li>`;
  },
  field(f) {
    const val = ob.get(`f-${f.id}`).value || '';
    const digits = f.tel ? val.replace(/\D/g, '') : '';
    return `<div class="fld">
      ${f.label ? `<span class="fld-k">${esc(f.label)}</span>` : ''}
      ${f.options ? `<div class="opts">${f.options.map((o) => `<button type="button" class="opt${val === o ? ' on' : ''}" data-ob-opt="${esc(f.id)}" data-val="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
      <div class="fld-row">
        <input type="${f.tel ? 'tel' : 'text'}" data-hold data-ob-field="${esc(f.id)}" value="${esc(val)}" placeholder="${esc(f.placeholder || (f.options ? 'or type it' : ''))}" autocomplete="off" enterkeyhint="done">
        ${digits.length >= 7 ? `<a class="btn sm" href="tel:${digits}">Call</a>` : ''}
      </div></div>`;
  },
  quote(b) {
    const st = ob.get(b.id);
    const fill = {};
    for (const [k, fid] of Object.entries(b.fill || {})) {
      const v = ob.get(`f-${fid}`).value;
      fill[k] = v ? `<mark>${esc(v)}</mark>` : `<span class="blank">${esc(b.blank[k])}</span>`;
    }
    return `<div class="say-block${st.done ? ' done' : ''}">
      <p class="say-text">${ob.rich(b.text, fill)}</p>
      <label class="say-check"><input type="checkbox" data-ob-check="${esc(b.id)}" ${st.done ? 'checked' : ''}><span class="box"></span>
        <span class="say-lbl">${esc(b.check)}${st.done ? `<small>by ${stamp(st.checkedBy, st.checkedAt)}</small>` : '<small>read it word for word</small>'}</span></label>
    </div>`;
  },
  /** Hide the pinned ER strip while the full ER box itself is on screen. */
  watchER() {
    this.io?.disconnect();
    const box = this.frame.querySelector('#erBox'), pin = this.frame.querySelector('.er-pin');
    if (!box || !pin || !('IntersectionObserver' in window)) return;
    this.io = new IntersectionObserver(([en]) => pin.classList.toggle('hide', en.isIntersecting), { threshold: 0.3 });
    this.io.observe(box);
  },
};

// ---------- RESOURCES ----------
// #resources → OB First Call entry + the Listen list (data/resources.json).
// #resources/obcall → the OB Call page above, unchanged, under a back button.
// Listened state is the `resources` collection, one doc per episode id:
//   { done, checkedBy, checkedAt }  — the same shape as a checklist tick.
const tagKind = (t) => (/members/i.test(t) ? 'mon' : /best/i.test(t) ? 'fam' : 'med');

const resources = {
  render(root, params) {
    this.params = params;
    if (params[0] === 'obcall') {
      root.innerHTML = `<div class="page"><button class="back" data-go="resources">← Resources</button><div id="obHost"></div></div>`;
      obcall.render(root.querySelector('#obHost'));
      return;
    }
    root.innerHTML = `<section id="resFrame"></section>`;
    this.frame = root.firstElementChild;
    this.frame.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-listen]');
      if (!cb) return;
      const done = cb.checked;
      store.write('resources', cb.dataset.listen, { done, checkedBy: done ? store.user : null, checkedAt: done ? Date.now() : null });
    });
    this.update();
  },
  update() {
    if (this.params[0] === 'obcall') return obcall.update();
    const L = store.resources.listen;
    const steps = OB_CALL.sections.filter((s) => !s.optional);
    const p = ob.progress(steps);
    const all = L.groups.flatMap((g) => g.episodes);
    const lp = store.listenProgress(all);
    this.frame.innerHTML = `
      <div class="sec-head"><h2 class="serif">Resources</h2><small>guides & listening, shared</small></div>
      <div class="grp">OB First Call</div>
      <button class="list-card" data-go="resources/obcall">
        <div class="t"><b>${esc(OB_CALL.title)}</b><span>${p.done}/${p.total}</span></div>
        <div class="s">${esc(OB_CALL.sub)}</div>
        ${progressBar(p)}
      </button>
      <div class="sec-head" style="margin-top:22px"><h2 class="serif">${esc(L.title)}</h2><small>${lp.done ? `${lp.done} of ${lp.total} listened` : esc(L.sub)}</small></div>
      ${L.groups.map((g) => this.group(g)).join('')}
      <p class="res-note">${esc(L.footer)}</p>`;
  },
  group(g) {
    const p = store.listenProgress(g.episodes);
    return `<div class="checklist res-group">
      <div class="cl-head"><b>${esc(g.host)}</b><span>${p.done}/${p.total}</span></div>
      ${g.note ? `<p class="res-groupnote">${esc(g.note)}</p>` : ''}
      <ul class="items">${g.episodes.map((e) => this.episode(e)).join('')}</ul>
    </div>`;
  },
  episode(e) {
    const st = store.listened(e.id);
    return `<li class="item ep${st.done ? ' done' : ''}">
      <label class="chk" aria-label="Listened"><input type="checkbox" data-listen="${esc(e.id)}" ${st.done ? 'checked' : ''}><span class="box"></span></label>
      <a class="item-body ep-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">
        <div class="item-text">${esc(e.title)}</div>
        <div class="ep-desc">${esc(e.desc)}</div>
        <div class="ep-foot">${e.tag ? `<span class="tag ${tagKind(e.tag)}">${esc(e.tag)}</span>` : ''}${st.done ? `<span class="item-meta">Listened by ${stamp(st.checkedBy, st.checkedAt)}</span>` : ''}</div>
      </a>
      <span class="ep-ext" aria-hidden="true">↗</span>
    </li>`;
  },
};

// ---------- SETTINGS ----------
const settings = {
  render(root) {
    root.innerHTML = `<section id="setFrame"></section>`;
    this.frame = root.firstElementChild;
    this.frame.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'switch') { store.setIdentity({ ...store.identity, user: t.dataset.user }); }
      else if (act === 'export') exportJSON();
      else if (act === 'update') navigator.serviceWorker?.getRegistration().then((r) => r?.update()).then(() => window.toast?.('Checked for updates'));
      else if (act === 'reload') location.reload();
      else if (act === 'due-reset') store.setDueDate(null).then(() => window.toast?.(`Due date back to ${formatDate(DUE, { year: true })}`));
    });
    this.frame.addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.target.id === 'ceilingForm') {
        store.setCeiling(e.target.ceiling.value).then(() => window.toast?.(`Ceiling set to ${fmtMoney(store.ceiling)}`));
        return;
      }
      if (e.target.id === 'dueForm') {
        const due = e.target.due.value;
        if (!due) return;
        store.setDueDate(due).then(() => window.toast?.(`Due date set to ${formatDate(due, { year: true })} — estimates updated`));
        return;
      }
      const code = e.target.code.value.trim();
      if (code.length < 4) return;
      store.setIdentity({ ...store.identity, code });
      location.hash = '#today';
      location.reload(); // restart sync against the new household
    });
    this.update();
  },
  update() {
    const id = store.identity || {};
    const s = store.syncStatus || { state: 'off', msg: 'Not syncing' };
    const dueDoc = store.dueDoc;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    this.frame.innerHTML = `<div class="page">
      <button class="back" data-go="today">← Back</button>
      <h2 class="title">Settings</h2>
      <div class="kv">
        <div class="row"><span class="l">You are</span><b>${esc(id.user || '—')}</b></div>
        <div class="row"><span class="l">Switch</span><span>${USERS.filter((u) => u !== id.user).map((u) => `<button class="btn sm" data-act="switch" data-user="${u}">I'm ${u}</button>`).join(' ')}</span></div>
        <div class="row"><span class="l">Sync</span><b class="status" data-state="${esc(s.state)}"><i></i>${esc(s.msg)}</b></div>
        <div class="row"><span class="l">Network</span><b>${navigator.onLine ? 'Online' : 'Offline'}</b></div>
      </div>
      <form class="field" id="dueForm"><span>Due date</span>
        <div class="addrow" style="padding:0"><input type="date" name="due" data-hold value="${esc(store.due)}" required><button class="btn sm primary" type="submit">Save</button></div>
        <small>${dueDoc?.due ? `Set by ${stamp(dueDoc.updatedBy, dueDoc.updatedAt)}. ` : `The default (${formatDate(DUE, { year: true })}). `}Every "week N" estimate on the timeline moves with it; dates you've confirmed stay put. Weeks count from LMP ${formatDate(currentLMP(), { year: true })}.</small>
        ${store.due !== DUE ? `<div class="stack" style="margin-top:8px"><button type="button" class="btn sm" data-act="due-reset">Reset to ${formatDate(DUE, { weekday: false, year: true })}</button></div>` : ''}
      </form>
      <form class="field" id="ceilingForm"><span>Budget ceiling</span>
        <div class="addrow" style="padding:0"><input type="text" inputmode="decimal" name="ceiling" data-hold value="${esc(String(store.ceiling))}" required><button class="btn sm primary" type="submit">Save</button></div>
        <small>${store.ceilingDoc?.ceiling ? `Set by ${stamp(store.ceilingDoc.setBy, store.ceilingDoc.setAt)}. ` : 'The default. '}What Lists → Budget reads against.</small>
      </form>
      <form class="field" id="codeForm"><span>Household code</span>
        <div class="addrow" style="padding:0"><input type="text" name="code" value="${esc(id.code || '')}" autocapitalize="none" autocorrect="off" spellcheck="false" minlength="4" required><button class="btn sm primary" type="submit">Save</button></div>
        <small>Same code on both phones. Changing it reloads the app and joins that household.</small>
      </form>
      <div class="field"><span>Backup</span>
        <div class="stack"><button class="btn" data-act="export">Export everything as JSON</button></div>
        <small>Every check, note, question, visit, result, decision, symptom, this-week tick, listened episode and event state — the seed content is in the app itself.</small>
      </div>
      <div class="field"><span>App</span>
        <div class="kv" style="margin-top:0">
          <div class="row"><span class="l">Version</span><b>${esc(APP_VERSION)}</b></div>
          <div class="row"><span class="l">Anchor</span><b>LMP ${formatDate(currentLMP(), { year: true })} · due ${formatDate(store.due, { year: true })}</b></div>
          <div class="row"><span class="l">Installed</span><b>${standalone ? 'Home screen app' : 'Browser tab'}</b></div>
        </div>
        <div class="stack"><button class="btn" data-act="update">Check for update</button><button class="btn" data-act="reload">Reload</button></div>
        <p class="hint install-hint">Not installed yet? iPhone: Share → <b>Add to Home Screen</b>. Android: menu → <b>Install app</b>.</p>
      </div>
    </div>`;
  },
};

export async function exportJSON() {
  const json = store.exportJSON();
  const name = `baby-hightower-${todayISO()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const views = { today, timeline, checklists, visits, notes: notesq, resources, settings };

// ---------- DATE EDITOR ----------
// The bottom sheet behind every tappable date (#dateSheet in index.html).
// Save confirms a date (+ optional time) for the event, Clear goes back to
// the estimate; both are ordinary store writes, so they sync like a tick.
export const dateEditor = {
  id: null,
  el: null,
  bind() {
    this.el = document.getElementById('dateSheet');
    const form = this.el.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const date = form.date.value, time = form.time.value;
      if (!date || !this.id) return;
      const id = this.id;
      this.close();
      store.setEventDate(id, date, time).then(() => window.toast?.(`Confirmed ${formatDate(date)}${time ? ` · ${formatTime(time)}` : ''}`));
    });
    this.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-ds]');
      if (e.target === this.el) return this.close(); // backdrop
      if (!t) return;
      if (t.dataset.ds === 'cancel') this.close();
      else if (t.dataset.ds === 'clear') { const id = this.id; this.close(); store.clearEventDate(id).then(() => window.toast?.('Back to the estimate')); }
    });
  },
  open(id) {
    const e = store.event(id);
    if (!e || !this.el) return;
    this.id = id;
    const form = this.el.querySelector('form');
    this.el.querySelector('#dsTitle').textContent = e.title;
    this.el.querySelector('#dsEst').textContent = `Estimate: ${estLabel(e, false)}`;
    // prefilled with the estimate's first day, so Save with no change confirms the estimate as-is
    form.date.value = e.confirmed ? e.from : e.estFrom;
    form.time.value = e.time || '';
    this.el.querySelector('#dsMeta').textContent = e.confirmed ? `Confirmed by ${e.state.dateBy || '?'} · ${formatStamp(e.state.dateAt)}` : 'Not confirmed yet — the timeline shows the estimate';
    this.el.querySelector('[data-ds=clear]').hidden = !e.confirmed;
    this.el.hidden = false;
  },
  close() { if (this.el) this.el.hidden = true; this.id = null; },
};
