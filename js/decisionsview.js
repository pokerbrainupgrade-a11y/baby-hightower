// The Open Decisions Log — a manual mirror of the decision layer in the
// master plan doc, on the Lists tab (#checklists/decisions). One card per
// decision: summary shows title · owner · deadline · status; open it for the
// context, blocker, what it unblocks, and the decision itself. Closing needs
// the decision written down; closed ones stay, folded up at the bottom, for
// good. Typed fields save on a short debounce and flush on blur / phone lock.
import { store } from './store.js';
import { esc, stamp, uiState } from './ui.js';
import { formatDate, todayISO } from './dates.js';
import { OWNERS, DEC_STATUS, MIRROR_LINE, decStatus, decOwner, deadline, sortDecisions } from './decisions.js';

const ST_CLASS = { Open: 'st-open', Researching: 'st-researching', Blocked: 'st-blocked', Closed: 'st-closed' };

export const decisions = {
  render(host) {
    host.innerHTML = `<section class="decisions" id="decFrame"></section>`;
    this.frame = host.firstElementChild;
    this.timers = new Map();
    const f = this.frame;
    f.addEventListener('click', (e) => this.onClick(e));
    f.addEventListener('change', (e) => { const el = e.target; if (el.matches('[data-dec][data-f]') && this.instant(el)) this.writeEl(el); });
    f.addEventListener('input', (e) => { const el = e.target.closest('[data-dec][data-f]'); if (el && !this.instant(el)) this.queue(el); });
    f.addEventListener('focusout', (e) => this.flush(e.target));
    f.addEventListener('submit', (e) => this.onSubmit(e));
    if (!decisions.bound) {
      decisions.bound = true;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') decisions.flushAll(); });
      addEventListener('pagehide', () => decisions.flushAll());
    }
    this.update();
  },
  instant: (el) => el.type === 'date' || el.type === 'number',
  keyFor: (el) => `${el.dataset.dec}#${el.dataset.f}`,
  writeEl(el) { return store.saveDecision(el.dataset.dec, { [el.dataset.f]: el.value }); },
  queue(el) {
    const k = this.keyFor(el);
    clearTimeout(this.timers.get(k)?.t);
    const write = () => { this.timers.delete(k); this.writeEl(el); };
    this.timers.set(k, { t: setTimeout(write, 400), write });
  },
  flush(el) {
    if (!el?.dataset?.dec) return;
    const p = this.timers.get(this.keyFor(el));
    if (p) { clearTimeout(p.t); p.write(); }
  },
  flushAll() { for (const p of [...(this.timers?.values() || [])]) { clearTimeout(p.t); p.write(); } },

  onClick(e) {
    const sum = e.target.closest('summary[data-fold]');
    if (sum) { uiState.open[sum.parentElement.open ? 'delete' : 'add'](sum.dataset.fold); return; }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act, key = t.dataset.key, val = t.dataset.val;
    if (act === 'd-status') {
      if (val === 'Closed') return this.close(key);
      store.setDecisionStatus(key, val);
    } else if (act === 'd-owner') store.saveDecision(key, { owner: val });
    else if (act === 'd-close') this.close(key);
    else if (act === 'd-add') { uiState.open[uiState.open.has('d-add') ? 'delete' : 'add']('d-add'); this.update(); this.frame.querySelector('form[data-add-decision] input')?.focus(); }
  },
  /** Close from whatever is in the decision box right now; refuse (and say so) when it's blank. */
  close(key) {
    const ta = this.frame.querySelector(`textarea[data-dec="${CSS.escape(key)}"][data-f="decision"]`);
    const text = (ta?.value ?? store.decision(key)?.decision ?? '').trim();
    if (!text) { window.toast?.('Write the decision first — a closed decision needs its answer recorded'); ta?.focus(); return; }
    this.timers.delete(this.keyFor(ta));   // the close carries the text; drop the pending debounce
    store.closeDecision(key, text).then(() => window.toast?.('Closed — it stays in the list below'));
  },
  onSubmit(e) {
    const form = e.target.closest('form[data-add-decision]');
    if (!form) return;
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) return;
    uiState.open.delete('d-add');
    store.addDecision({ title, owner: form.owner.value }).then((k) => { uiState.open.add(`dec:${k}`); this.update(); });
  },

  update() {
    const today = todayISO();
    const list = sortDecisions(store.decisions());
    const open = list.filter((d) => decStatus(d) !== 'Closed');
    const closed = list.filter((d) => decStatus(d) === 'Closed');
    const addOpen = uiState.open.has('d-add');
    this.frame.innerHTML = `
      <div class="sec-head"><h2 class="serif">Open decisions</h2><small>${open.length} open · ${closed.length} closed</small></div>
      <p class="mirror-line">${esc(MIRROR_LINE)}</p>
      ${open.map((d) => this.card(d, today)).join('')}
      ${addOpen ? `<form class="compose" data-add-decision>
          <input type="text" name="title" placeholder="What needs deciding?" autocomplete="off" enterkeyhint="done" data-hold>
          <div class="row"><select name="owner" class="select" aria-label="Owner">${OWNERS.map((o) => `<option${o === 'Both' ? ' selected' : ''}>${o}</option>`).join('')}</select><span><button type="button" class="btn sm" data-act="d-add">Cancel</button> <button class="btn sm primary" type="submit">Add</button></span></div>
        </form>` : `<div class="stack"><button class="btn" data-act="d-add">+ Add a decision</button></div>`}
      <details class="archive"${uiState.open.has('dec:closed') ? ' open' : ''}><summary data-fold="dec:closed">Closed <small>${closed.length ? `(${closed.length})` : '(none yet)'}</small></summary>
        ${closed.length ? closed.map((d) => this.card(d, today)).join('') : `<p class="hint">Closed decisions stay here — what was decided, by whom, and when.</p>`}
      </details>`;
  },
  /** 'By Sun, Nov 15' · 'Week 20 · Mon, Dec 21' — a week shows the date it resolves to under the current due date. */
  when(d, today) {
    const dl = deadline(d);
    if (!dl) return '';
    const late = decStatus(d) !== 'Closed' && dl.date < today;
    const text = dl.week === null ? `By ${formatDate(dl.date)}` : `Week ${dl.week} · ${formatDate(dl.date)}`;
    return `<span class="dec-when${late ? ' late' : ''}">${esc(text)}</span>`;
  },
  card(d, today) {
    const key = d.key, st = decStatus(d), owner = decOwner(d);
    const open = uiState.open.has(`dec:${key}`);
    const dl = deadline(d);
    const field = (label, f, placeholder) => `<label class="field"><span>${label}</span><input type="text" data-hold data-dec="${esc(key)}" data-f="${f}" value="${esc(d[f] || '')}" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done"></label>`;
    return `<details class="dec ${ST_CLASS[st]}"${open ? ' open' : ''}>
      <summary data-fold="dec:${esc(key)}">
        <div class="dec-title">${esc(d.title)}</div>
        <div class="dec-meta"><span class="chip${owner === 'Both' ? '' : ' blush'}">${esc(owner)}</span>${this.when(d, today)}<span class="status-chip ${ST_CLASS[st]}">${esc(st)}</span></div>
      </summary>
      <div class="dec-body">
        <div class="field"><span>Status</span><div class="opts">${DEC_STATUS.map((s) => `<button type="button" class="opt${s === st ? ' on' : ''}" data-act="d-status" data-key="${esc(key)}" data-val="${s}">${s}</button>`).join('')}</div></div>
        <div class="field"><span>Owner</span><div class="opts">${OWNERS.map((o) => `<button type="button" class="opt${o === owner ? ' on' : ''}" data-act="d-owner" data-key="${esc(key)}" data-val="${o}">${o}</button>`).join('')}</div></div>
        <div class="two">
          <label class="field"><span>Decide by <em>(date)</em></span><input type="date" data-hold data-dec="${esc(key)}" data-f="decideBy" value="${esc(d.decideBy || '')}"></label>
          <label class="field"><span>…or by week</span><input type="number" inputmode="numeric" min="0" max="45" data-hold data-dec="${esc(key)}" data-f="decideByWeek" value="${Number.isInteger(d.decideByWeek) ? d.decideByWeek : ''}" placeholder="e.g. 20"></label>
        </div>
        ${dl?.week !== null && dl ? `<small class="hint dec-resolve">Week ${dl.week} starts ${formatDate(dl.date, { year: true })} under the current due date.</small>` : ''}
        <label class="field"><span>Context</span><textarea data-hold data-dec="${esc(key)}" data-f="context" placeholder="Why this is a decision, and what the options are">${esc(d.context || '')}</textarea></label>
        ${field('Blocked by', 'blockedBy', 'What input is missing')}
        ${field('Unblocks', 'unblocks', 'What closing this releases')}
        <label class="field"><span>Decision</span><textarea data-hold data-dec="${esc(key)}" data-f="decision" placeholder="The answer, once there is one">${esc(d.decision || '')}</textarea></label>
        ${st === 'Closed'
          ? `<small class="date-meta">Closed by ${stamp(d.closedBy, d.closedAt)}</small>`
          : `<div class="stack"><button type="button" class="btn primary" data-act="d-close" data-key="${esc(key)}">Close with this decision</button></div>`}
        ${d.updatedBy ? `<small class="date-meta">Last saved by ${stamp(d.updatedBy, d.updatedAt)}</small>` : ''}
      </div>
    </details>`;
  },
};
