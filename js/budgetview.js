// The spend tracker (#checklists/budget) and the money bits on list items.
//   budget          the page: ceiling, spent / committed / remaining, the bar, breakdowns, the item list with inline estimates
//   costEditor      the cost fields inside an item's ⋯ editor (budget lists only); readCostEditor collects them on Save
//   costFoot        the money tags on an item row — nothing at all when no cost field is set
// It reports. It doesn't scold: no warning copy, no blocking.
import { store } from './store.js';
import { esc, rich, uiState } from './ui.js';
import { formatDate } from './dates.js';
import { PURCHASERS, COVERAGE, DEFAULT_COVERAGE, coverageOf, coverageLabel, isMoney, isPurchased, isUnpriced, fmtMoney, summarize } from './budget.js';

const money = (v) => (isMoney(v) ? String(v) : '');

export function costEditor(it) {
  const cov = coverageOf(it);
  return `<div class="cost-editor">
    <div class="two">
      <label class="field"><span>Estimate</span><input type="text" inputmode="decimal" data-hold data-cost="estimatedCost" value="${esc(money(it.estimatedCost))}" placeholder="$"></label>
      <label class="field"><span>Actual</span><input type="text" inputmode="decimal" data-hold data-cost="actualCost" value="${esc(money(it.actualCost))}" placeholder="$"></label>
    </div>
    <div class="two">
      <label class="field"><span>Bought on</span><input type="date" data-hold data-cost="purchasedAt" value="${esc(it.purchasedAt || '')}"></label>
      <div class="field"><span>Bought by</span><div class="opts" data-cost-group="purchasedBy">${PURCHASERS.map((p) => `<button type="button" class="opt${it.purchasedBy === p ? ' on' : ''}" data-cost-opt="${p}">${p}</button>`).join('')}</div></div>
    </div>
    <div class="field"><span>Coverage</span><div class="opts" data-cost-group="coverage">${COVERAGE.map((c) => `<button type="button" class="opt${cov === c ? ' on' : ''}" data-cost-opt="${esc(c)}">${esc(coverageLabel(c))}</button>`).join('')}</div></div>
    <div class="two">
      <label class="field"><span>Vendor</span><input type="text" data-hold data-cost="vendor" value="${esc(it.vendor || '')}" placeholder="optional" autocomplete="off"></label>
      <label class="field"><span>Link</span><input type="url" data-hold data-cost="link" value="${esc(it.link || '')}" placeholder="https://" autocomplete="off" inputmode="url"></label>
    </div>
  </div>`;
}

/** The editor's cost fields as a patch for store.saveItemCost — null when the editor has no cost block. */
export function readCostEditor(editor) {
  const box = editor?.querySelector('.cost-editor');
  if (!box) return null;
  const patch = {};
  for (const el of box.querySelectorAll('[data-cost]')) patch[el.dataset.cost] = el.value;
  for (const g of box.querySelectorAll('[data-cost-group]')) patch[g.dataset.costGroup] = g.querySelector('.on')?.dataset.costOpt || (g.dataset.costGroup === 'coverage' ? DEFAULT_COVERAGE : '');
  return patch;
}

/** Money tags for an item row. An item with no cost fields gets none — it looks exactly as before. */
export function costFoot(it) {
  const bits = [];
  if (isPurchased(it)) bits.push(`<span class="cost paid">${fmtMoney(it.actualCost)}${it.purchasedBy ? ` · ${esc(it.purchasedBy)}` : ''}</span>`);
  else if (isMoney(it.estimatedCost)) bits.push(`<span class="cost est">est ${fmtMoney(it.estimatedCost)}</span>`);
  if (it.coverage && it.coverage !== DEFAULT_COVERAGE) bits.push(`<span class="tag cov">${esc(coverageLabel(coverageOf(it)))}</span>`);
  if (it.vendor) bits.push(`<span class="cost vendor">${esc(it.vendor)}</span>`);
  if (it.link) bits.push(`<a class="cost link" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">link ↗</a>`);
  return bits;
}

export const budget = {
  render(host) {
    host.innerHTML = `<section class="budget" id="budgetFrame"></section>`;
    this.frame = host.firstElementChild;
    const f = this.frame;
    f.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'ceiling-edit') { uiState.open[uiState.open.has('ceiling') ? 'delete' : 'add']('ceiling'); this.update(); f.querySelector('#ceilingInput')?.focus(); }
      else if (t.dataset.act === 'filter') { uiState.filter.set('budget', t.dataset.val); this.update(); }
    });
    f.addEventListener('submit', (e) => {
      if (e.target.id !== 'budgetCeiling') return;
      e.preventDefault();
      uiState.open.delete('ceiling');
      store.setCeiling(e.target.ceiling.value).then(() => window.toast?.(`Ceiling set to ${fmtMoney(store.ceiling)}`));
    });
    // inline estimate / actual: saved when the field is left (change), so one sitting of tab-tab-tab works
    f.addEventListener('change', (e) => {
      const el = e.target.closest('input[data-inline-cost]');
      if (!el) return;
      store.saveItemCost(el.dataset.item, el.dataset.list, { [el.dataset.inlineCost]: el.value });
    });
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[data-inline-cost]')) { e.preventDefault(); e.target.blur(); } });
    this.update();
  },
  update() {
    const items = store.budgetItems();
    const s = summarize(items, store.ceiling);
    const filter = uiState.filter.get('budget') || 'All';
    const unpricedOnly = filter === 'Unpriced';
    const editing = uiState.open.has('ceiling');
    const doc = store.ceilingDoc;
    this.frame.innerHTML = `
      <div class="sec-head"><h2 class="serif">Budget</h2><small>every number typed in by hand</small></div>
      <div class="budget-head">
        <div class="nums">
          <div><span class="k">Spent</span><b>${fmtMoney(s.spent)}</b></div>
          <div><span class="k">Committed</span><b>${fmtMoney(s.committed)}</b></div>
          <div><span class="k">Remaining</span><b class="${s.remaining < 0 ? 'neg' : ''}">${fmtMoney(s.remaining)}</b></div>
        </div>
        <div class="bar ${s.tone}"><i style="width:${Math.min(s.pct, 100)}%"></i></div>
        ${editing ? `<form class="addrow" id="budgetCeiling" style="padding:8px 0 0"><input type="text" inputmode="decimal" name="ceiling" id="ceilingInput" data-hold value="${esc(String(s.ceiling))}" aria-label="Ceiling"><button class="btn sm primary" type="submit">Save</button><button class="btn sm" type="button" data-act="ceiling-edit">Cancel</button></form>`
          : `<div class="ceiling-line"><span>${Math.round(s.pct)}% of the ${fmtMoney(s.ceiling)} ceiling${doc?.ceiling ? ` · set by ${esc(doc.setBy || '?')}` : ''}</span><button type="button" class="btn sm ghost" data-act="ceiling-edit">Change ›</button></div>`}
        <p class="hint">Committed = spent + estimates on unpurchased Must and Nice items. Later and Skip items don't count.</p>
      </div>

      <div class="grp vgrp">By coverage</div>
      <div class="kv">${s.byCoverage.map((c) => `<div class="row"><span class="l">${esc(c.label)}${c.n ? ` <small>· ${c.n}</small>` : ''}</span><b>${fmtMoney(c.spent)} spent · ${fmtMoney(c.committed)} committed</b></div>`).join('')}</div>

      <div class="grp vgrp">By list</div>
      ${s.byList.map((g) => `<button class="list-card" data-go="checklists/${esc(g.listId)}">
        <div class="t"><b>${esc(g.title)}</b><span>${fmtMoney(g.spent)} spent · ${fmtMoney(g.committed)} committed</span></div>
        <div class="s">${g.n} items${g.unpriced ? ` · ${g.unpriced} unpriced` : ''}</div>
      </button>`).join('')}

      <div class="sec-head" style="margin-top:22px"><h2 class="serif">Items</h2><small>${unpricedOnly ? `${s.unpriced} to price` : `${items.length} across five lists`}</small></div>
      <div class="filters" style="padding:0 0 10px"><button type="button" class="opt${!unpricedOnly ? ' on' : ''}" data-act="filter" data-val="All">All</button><button type="button" class="opt${unpricedOnly ? ' on' : ''}" data-act="filter" data-val="Unpriced">Unpriced only<em>${s.unpriced}</em></button></div>
      ${s.byList.map((g) => this.group(g, unpricedOnly)).join('')}`;
  },
  group(g, unpricedOnly) {
    const rows = unpricedOnly ? g.items.filter(isUnpriced) : g.items.filter((it) => it.priority !== 'Skip');
    if (!rows.length) return '';
    return `<div class="checklist budget-list">
      <div class="cl-head"><b>${esc(g.title)}</b><span>${rows.length}</span></div>
      <ul class="items">${rows.map((it) => `<li class="item cost-row${isPurchased(it) ? ' done' : ''}">
        <div class="item-body">
          <div class="item-text">${rich(it.text)}</div>
          <div class="item-foot">${it.priority ? `<span class="tag ${esc(it.priority.toLowerCase())}">${esc(it.priority)}</span>` : ''}${it.coverage && it.coverage !== DEFAULT_COVERAGE ? `<span class="tag cov">${esc(coverageLabel(coverageOf(it)))}</span>` : ''}${it.purchasedAt ? `<span class="cost vendor">${formatDate(it.purchasedAt, { weekday: false })}</span>` : ''}${it.vendor ? `<span class="cost vendor">${esc(it.vendor)}</span>` : ''}</div>
        </div>
        <div class="cost-inputs">
          <label><small>est</small><input type="text" inputmode="decimal" data-hold data-inline-cost="estimatedCost" data-item="${esc(it.id)}" data-list="${esc(it.listId)}" value="${esc(money(it.estimatedCost))}" placeholder="$"></label>
          <label><small>paid</small><input type="text" inputmode="decimal" data-hold data-inline-cost="actualCost" data-item="${esc(it.id)}" data-list="${esc(it.listId)}" value="${esc(money(it.actualCost))}" placeholder="$"></label>
        </div>
      </li>`).join('')}</ul>
    </div>`;
  },
};
