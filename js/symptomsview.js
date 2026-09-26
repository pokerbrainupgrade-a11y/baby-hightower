// The Symptom Log's three surfaces:
//   quickRow / bindQuickRow  the six-tag grid on Today — tap logs Moderate (Undo in the toast), hold opens the sheet
//   symptomSheet             the bottom sheet (#symptomSheet): tag, Mild / Moderate / Rough, a short note; also edits an entry
//   symptomLog               #visits/symptoms — newest first, grouped by day, with the day's sleep / mood / appetite
//   sinceView                #visits/since — everything after the latest Completed visit, grouped by tag, with "Copy as text"
// A record, not an instrument: nothing on these pages interprets anything.
import { store } from './store.js';
import { esc, stamp, uiState } from './ui.js';
import { formatDate, formatClock, todayISO } from './dates.js';
import { SEVERITY, DEFAULT_SEVERITY, severityOf, severityLabel, byDay, byTag, sinceText } from './symptoms.js';

const sevDot = (n) => `<i class="sev-dot s${severityOf(n)}" aria-label="${severityLabel(n)}"></i>`;
const HOLD_MS = 450;

// ---------- quick row (Today) ----------
export function quickRow() {
  const tags = store.quickTags();
  return `<div class="quick">
    <div class="quick-head"><span class="k">How are you feeling?</span><small>tap logs it · hold for more</small></div>
    <div class="quick-grid">${tags.map((t) => `<button type="button" class="quick-tag" data-quick="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="quick-foot"><button type="button" class="btn sm" data-quick-more>More…</button><button type="button" class="btn sm ghost" data-go="visits/symptoms">Open the log →</button></div>
  </div>`;
}

/** Tap = log at Moderate with an Undo toast · hold = the sheet. Bound once per Today frame. */
export function bindQuickRow(frame) {
  let timer = null, held = false, pressed = null, x0 = 0, y0 = 0;
  const end = () => { clearTimeout(timer); timer = null; pressed?.classList.remove('press'); pressed = null; };
  frame.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-quick]');
    if (!b) return;
    held = false; pressed = b; x0 = e.clientX; y0 = e.clientY;
    b.classList.add('press');
    timer = setTimeout(() => { held = true; end(); symptomSheet.open({ type: b.dataset.quick }); }, HOLD_MS);
  });
  frame.addEventListener('pointermove', (e) => { if (pressed && Math.hypot(e.clientX - x0, e.clientY - y0) > 12) end(); });
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  frame.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-quick]')) e.preventDefault(); });
  frame.addEventListener('click', (e) => {
    if (e.target.closest('[data-quick-more]')) { symptomSheet.open({}); return; }
    const b = e.target.closest('[data-quick]');
    if (!b) return;
    if (held) { held = false; return; }   // the hold already opened the sheet
    quickLog(b.dataset.quick);
  });
}

async function quickLog(type) {
  const key = await store.logSymptom({ type, severity: DEFAULT_SEVERITY });
  window.toast?.(`Logged ${type} · ${SEVERITY[DEFAULT_SEVERITY]}`, { action: 'Undo', duration: 6000, onAction: () => store.remove('symptoms', key) });
}

// ---------- the sheet ----------
export const symptomSheet = {
  el: null, key: null, type: null, severity: DEFAULT_SEVERITY,
  bind() {
    this.el = document.getElementById('symptomSheet');
    const form = this.el.querySelector('form');
    form.addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) return this.close();   // backdrop
      const t = e.target.closest('[data-sym],[data-sym-tag],[data-sym-sev]');
      if (!t) return;
      if (t.dataset.symTag !== undefined) { this.type = t.dataset.symTag; this.paint(); if (this.type === 'Other') form.other.focus(); }
      else if (t.dataset.symSev !== undefined) { this.severity = severityOf(t.dataset.symSev); this.paint(); }
      else if (t.dataset.sym === 'cancel') this.close();
      else if (t.dataset.sym === 'delete') {
        if (!confirm('Delete this entry?')) return;
        const k = this.key; this.close();
        store.remove('symptoms', k).then(() => window.toast?.('Entry deleted'));
      }
    });
  },
  /** open({ type }) to log that tag · open({}) to pick one · open({ key }) to edit an entry */
  open({ type = null, key = null } = {}) {
    const form = this.el.querySelector('form');
    this.key = key;
    if (key) {
      const e = store.symptom(key);
      if (!e) return;
      const known = store.symptomTags.includes(e.type);
      this.type = known ? e.type : 'Other';
      this.severity = severityOf(e.severity);
      form.note.value = e.note || '';
      form.other.value = known ? '' : e.type;
    } else {
      this.type = type; this.severity = DEFAULT_SEVERITY;
      form.note.value = ''; form.other.value = '';
    }
    this.el.querySelector('#symKicker').textContent = key ? 'Edit entry' : 'Log a symptom';
    this.el.querySelector('#symSave').textContent = key ? 'Save' : 'Log it';
    this.el.querySelector('[data-sym=delete]').hidden = !key;
    this.paint();
    this.el.hidden = false;
  },
  paint() {
    this.el.querySelector('#symTags').innerHTML = store.symptomTags.map((t) => `<button type="button" class="opt${t === this.type ? ' on' : ''}" data-sym-tag="${esc(t)}">${esc(t)}</button>`).join('');
    this.el.querySelector('#symSev').innerHTML = [1, 2, 3].map((n) => `<button type="button" class="sev s${n}${n === this.severity ? ' on' : ''}" data-sym-sev="${n}" aria-pressed="${n === this.severity}">${SEVERITY[n]}</button>`).join('');
    this.el.querySelector('#symOtherWrap').hidden = this.type !== 'Other';
  },
  async save() {
    if (!this.type) { window.toast?.('Pick a tag first'); return; }
    const form = this.el.querySelector('form');
    const other = form.other.value.trim();
    const type = this.type === 'Other' && other ? other : this.type;
    const note = form.note.value.trim(), severity = this.severity, key = this.key;
    this.close();
    if (key) { await store.updateSymptom(key, { type, severity, note }); window.toast?.('Saved'); return; }
    const k = await store.logSymptom({ type, severity, note });
    window.toast?.(`Logged ${type} · ${SEVERITY[severity]}`, { action: 'Undo', duration: 6000, onAction: () => store.remove('symptoms', k) });
  },
  close() { if (this.el) this.el.hidden = true; this.key = null; },
};

// ---------- the log ----------
export const symptomLog = {
  render(host) {
    host.innerHTML = `<section class="symlog" id="symFrame"></section>`;
    this.frame = host.firstElementChild;
    this.timers = new Map();
    const f = this.frame;
    f.addEventListener('click', (e) => {
      const sum = e.target.closest('summary[data-fold]');
      if (sum) { uiState.open[sum.parentElement.open ? 'delete' : 'add'](sum.dataset.fold); return; }
      const t = e.target.closest('[data-sym-edit],[data-sym-del],[data-mood],[data-quick-more]');
      if (!t) return;
      if (t.dataset.symEdit !== undefined) symptomSheet.open({ key: t.dataset.symEdit });
      else if (t.dataset.symDel !== undefined) { if (confirm('Delete this entry?')) store.remove('symptoms', t.dataset.symDel).then(() => window.toast?.('Entry deleted')); }
      else if (t.dataset.mood !== undefined) store.saveDay(t.dataset.day, { mood: store.dayEntry(t.dataset.day).mood === t.dataset.mood ? null : t.dataset.mood });
      else symptomSheet.open({});
    });
    f.addEventListener('input', (e) => { const el = e.target.closest('[data-day][data-f]'); if (el) this.queue(el); });
    f.addEventListener('focusout', (e) => this.flush(e.target));
    if (!symptomLog.bound) {
      symptomLog.bound = true;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') symptomLog.flushAll(); });
      addEventListener('pagehide', () => symptomLog.flushAll());
    }
    this.update();
  },
  keyFor: (el) => `${el.dataset.day}#${el.dataset.f}`,
  queue(el) {
    const k = this.keyFor(el);
    clearTimeout(this.timers.get(k)?.t);
    const write = () => { this.timers.delete(k); store.saveDay(el.dataset.day, { [el.dataset.f]: el.value }); };
    this.timers.set(k, { t: setTimeout(write, 400), write });
  },
  flush(el) { if (!el?.dataset?.day) return; const p = this.timers.get(this.keyFor(el)); if (p) { clearTimeout(p.t); p.write(); } },
  flushAll() { for (const p of [...(this.timers?.values() || [])]) { clearTimeout(p.t); p.write(); } },
  update() {
    const today = todayISO();
    const all = store.symptomList();
    const groups = byDay(all);
    if (!groups.length || groups[0].day !== today) groups.unshift({ day: today, entries: [] });   // today's day notes are always reachable
    const since = store.sinceLastVisit();
    this.frame.innerHTML = `
      <div class="sec-head"><h2 class="serif">Symptom log</h2><small>${all.length ? `${all.length} ${all.length === 1 ? 'entry' : 'entries'}` : 'nothing logged yet'}</small></div>
      <div class="stack"><button type="button" class="btn primary big" data-quick-more>+ Log a symptom</button></div>
      <button class="linkrow" data-go="visits/since"><span>Since last visit<small>${since.visit ? `${since.entries.length} logged since ${formatDate(since.visit.date)}` : 'no completed visit yet — shows everything'}</small></span><span class="arrow">→</span></button>
      ${groups.map((g) => this.dayGroup(g, today)).join('')}`;
  },
  dayGroup(g, today) {
    const d = store.dayEntry(g.day);
    const bits = [];
    if (d.sleepHours != null) bits.push(`sleep ${d.sleepHours}h`);
    if (d.mood) bits.push(d.mood);
    if (d.appetite) bits.push(d.appetite);
    const open = uiState.open.has(`day:${g.day}`);
    return `<div class="daygrp">
      <div class="grp vgrp">${g.day === today ? 'Today · ' : ''}${formatDate(g.day)}</div>
      ${g.entries.length ? `<div class="checklist"><ul class="items">${g.entries.map((e) => this.entry(e)).join('')}</ul></div>` : `<p class="hint">Nothing logged${g.day === today ? ' yet today' : ''}.</p>`}
      <details class="info daynote"${open ? ' open' : ''}>
        <summary data-fold="day:${g.day}"><span>${bits.length ? esc(bits.join(' · ')) : 'Day notes · sleep, mood, appetite'}</span><i aria-hidden="true">›</i></summary>
        <div class="info-body">
          <div class="two">
            <label class="field"><span>Sleep <em>(hours)</em></span><input type="number" inputmode="decimal" step="0.5" min="0" max="24" data-hold data-day="${g.day}" data-f="sleepHours" value="${d.sleepHours ?? ''}" placeholder="–"></label>
            <div class="field"><span>Mood</span><div class="opts">${(store.symptoms?.moods || []).map((m) => `<button type="button" class="opt${d.mood === m ? ' on' : ''}" data-mood="${esc(m)}" data-day="${g.day}">${esc(m)}</button>`).join('')}</div></div>
          </div>
          <label class="field"><span>Appetite / aversions</span><input type="text" data-hold data-day="${g.day}" data-f="appetite" value="${esc(d.appetite || '')}" placeholder="a few words" autocomplete="off" enterkeyhint="done"></label>
          ${d.updatedBy ? `<small class="hint">Saved by ${stamp(d.updatedBy, d.updatedAt)}</small>` : ''}
        </div>
      </details>
    </div>`;
  },
  entry(e) {
    return `<li class="item sym">
      <span class="sym-time">${formatClock(e.at)}</span>
      <div class="item-body">
        <div class="item-text">${sevDot(e.severity)}${esc(e.type)} <small class="sev-lbl">${severityLabel(e.severity)}</small></div>
        ${e.note ? `<div class="item-note">${esc(e.note)}</div>` : ''}
        <div class="item-meta">${esc(e.createdBy || '?')}${e.gest ? ` · ${e.gest.weeks}w ${e.gest.day}d` : ''}</div>
      </div>
      <button class="more" data-sym-edit="${esc(e.key)}" aria-label="Edit entry">⋯</button>
      <button class="more del" data-sym-del="${esc(e.key)}" aria-label="Delete entry">×</button>
    </li>`;
  },
};

// ---------- since last visit ----------
export const sinceView = {
  render(host) {
    host.innerHTML = `<section class="since" id="sinceFrame"></section>`;
    this.frame = host.firstElementChild;
    this.frame.addEventListener('click', (e) => {
      const t = e.target.closest('[data-copy],[data-sym-edit]');
      if (!t) return;
      if (t.dataset.symEdit !== undefined) symptomSheet.open({ key: t.dataset.symEdit });
      else this.copy();
    });
    this.update();
  },
  async copy() {
    const text = sinceText(store.sinceLastVisit());
    try { await navigator.clipboard.writeText(text); window.toast?.('Copied — paste it anywhere'); return; } catch { /* no clipboard: fall through */ }
    if (navigator.share) { try { await navigator.share({ text }); return; } catch { /* dismissed */ } }
    const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); window.toast?.('Copied — paste it anywhere'); } catch { window.toast?.("Couldn't copy on this browser"); }
    ta.remove();
  },
  update() {
    const r = store.sinceLastVisit();
    const groups = byTag(r.entries, r.tags);
    const v = r.visit;
    this.frame.innerHTML = `
      <div class="sec-head"><h2 class="serif">Since last visit</h2><small>${v ? `${formatDate(v.date)} · ${esc(v.type || 'visit')}` : 'no completed visit yet'}</small></div>
      <p class="hint since-hint">${v ? `Everything logged since the ${formatDate(v.date)} ${esc(v.type || '')} visit${v.time ? ` (${esc(v.time)})` : ''} — ${r.entries.length} ${r.entries.length === 1 ? 'entry' : 'entries'}.` : 'No visit is marked Completed yet, so this is everything logged. Mark a visit Completed in the Visits tab and this view starts from there.'}</p>
      <div class="two"><button type="button" class="btn primary" data-copy>Copy as text</button><button type="button" class="btn" data-go="visits/symptoms">Open the log</button></div>
      ${groups.length ? groups.map((g) => `<div class="checklist">
          <div class="cl-head"><b>${esc(g.type)}</b><span>×${g.count} · ${[1, 2, 3].filter((s) => g.sev[s]).map((s) => `${g.sev[s]} ${SEVERITY[s].toLowerCase()}`).join(', ')}</span></div>
          <ul class="items">${g.entries.map((e) => `<li class="item sym">
            <span class="sym-time">${formatDate(e.day, { weekday: false })}<br>${formatClock(e.at)}</span>
            <div class="item-body"><div class="item-text">${sevDot(e.severity)}${severityLabel(e.severity)}</div>${e.note ? `<div class="item-note">${esc(e.note)}</div>` : ''}</div>
            <button class="more" data-sym-edit="${esc(e.key)}" aria-label="Edit entry">⋯</button>
          </li>`).join('')}</ul>
        </div>`).join('') : `<div class="empty"><b>Nothing logged${v ? ' since then' : ''}</b>Tap a tag on Today to log one.</div>`}
      ${r.days.length ? `<div class="checklist"><div class="cl-head"><b>Day notes</b><span>${r.days.length}</span></div><ul class="items">${r.days.map((d) => {
        const bits = [];
        if (d.sleepHours != null) bits.push(`sleep ${d.sleepHours}h`);
        if (d.mood) bits.push(d.mood);
        if (d.appetite) bits.push(d.appetite);
        return `<li class="item sym"><span class="sym-time">${formatDate(d.key, { weekday: false })}</span><div class="item-body"><div class="item-text">${esc(bits.join(' · '))}</div></div></li>`;
      }).join('')}</ul></div>` : ''}`;
  },
};
