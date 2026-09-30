// The Visits tab: the visit log with its Results & Labs section.
//   #visits            list — Upcoming pinned on top, then newest first, then the results
//   #visits/v/<key>    one visit: dates, type, vitals, summary, next steps, questions
//   #visits/r/<key>    one result record: status (with history), dates, result text
// Typed fields save on a short debounce and flush on blur / when the phone
// locks (the OB Call pattern); date, time and select fields save on change.
// Everything is a plain store write, stamped with who and when, so it syncs
// like a tick. No copy in here interprets anything.
import { store } from './store.js';
import { esc, stamp, uiState } from './ui.js';
import { formatDate, formatTime, todayISO } from './dates.js';
import { VISIT_TYPES, VISIT_STATUS, VITALS, RESULT_CATEGORIES, RESULT_STATUS, DATING_ULTRASOUND_ID, visitType, visitStatus, gestLabel, sortVisits, qStatus, resultStatus, resultCategory } from './visits.js';
import { symptomLog, sinceView } from './symptomsview.js';

const fmtLong = (iso) => formatDate(iso, { weekday: false, year: true });

export const visits = {
  render(root, params) {
    this.params = params;
    // #visits/symptoms → the log · #visits/since → since the last completed visit
    if (params[0] === 'symptoms' || params[0] === 'since') {
      root.innerHTML = `<div class="page"><button class="back" data-go="visits">← Visits</button><div id="symHost"></div></div>`;
      (params[0] === 'since' ? sinceView : symptomLog).render(root.querySelector('#symHost'));
      return;
    }
    root.innerHTML = `<section class="visits" id="vFrame"></section>`;
    this.frame = root.firstElementChild;
    this.timers = new Map();
    const f = this.frame;
    f.addEventListener('click', (e) => this.onClick(e));
    f.addEventListener('change', (e) => this.onChange(e));
    f.addEventListener('input', (e) => {
      const el = e.target.closest('[data-doc][data-f]');
      if (el && !this.instant(el)) this.queue(el);
    });
    f.addEventListener('focusout', (e) => this.flush(e.target));
    f.addEventListener('submit', (e) => this.onSubmit(e));
    if (!visits.bound) {
      visits.bound = true;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') visits.flushAll(); });
      addEventListener('pagehide', () => visits.flushAll());
    }
    this.update();
  },

  // ---- typed fields: <input data-doc="visits/<key>" data-f="summary"> (or data-f="vitals.weight") ----
  instant: (el) => el.tagName === 'SELECT' || el.type === 'date' || el.type === 'time',
  keyFor: (el) => `${el.dataset.doc}#${el.dataset.f}`,
  writeEl(el) {
    const [coll, key] = el.dataset.doc.split('/');
    const f = el.dataset.f, v = el.value;
    let patch;
    if (f.startsWith('vitals.')) patch = { vitals: { [f.slice(7)]: v } };
    else if (f === 'confirmedDueDate') patch = { confirmedDueDate: v || null, confirmedDueBy: v ? store.user : null, confirmedDueAt: v ? Date.now() : null };
    else patch = { [f]: v };
    return coll === 'visits' ? store.saveVisit(key, patch) : store.saveResult(key, patch);
  },
  queue(el) {
    const k = this.keyFor(el);
    clearTimeout(this.timers.get(k)?.t);
    const write = () => { this.timers.delete(k); this.writeEl(el); };
    this.timers.set(k, { t: setTimeout(write, 400), write });
  },
  flush(el) {
    if (!el?.dataset?.doc) return;
    const p = this.timers.get(this.keyFor(el));
    if (p) { clearTimeout(p.t); p.write(); }
  },
  flushAll() { for (const p of [...(this.timers?.values() || [])]) { clearTimeout(p.t); p.write(); } },

  // ---- events ----
  onChange(e) {
    const el = e.target;
    if (el.matches('[data-doc][data-f]') && this.instant(el)) { this.writeEl(el); return; }
    const cb = el.closest('input[data-attach-q]');
    if (!cb) return;
    const key = cb.dataset.attachQ, vk = cb.dataset.visit;
    if (cb.checked) store.write('questions', key, { status: 'asked', askedAtVisitId: vk, askedBy: store.user, askedAt: Date.now() });
    else store.write('questions', key, { status: 'to_ask', askedAtVisitId: null });
  },
  onClick(e) {
    const sum = e.target.closest('summary[data-fold]');
    if (sum) { uiState.open[sum.parentElement.open ? 'delete' : 'add'](sum.dataset.fold); return; }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act, key = t.dataset.key, val = t.dataset.val;
    if (act === 'v-new') {
      // one tap: today, Prenatal, Upcoming — everything else is filled in on the page that opens
      store.addVisit().then((k) => { window.toast?.('Visit added — set the date and type'); location.hash = `#visits/v/${k}`; });
    } else if (act === 'v-type') store.saveVisit(key, { type: val });
    else if (act === 'v-status') store.saveVisit(key, { status: val });
    else if (act === 'v-delete') {
      if (!confirm('Delete this visit? Questions being asked here go back to Open; answers already saved stay.')) return;
      for (const q of store.questionsForVisit(key)) if (qStatus(q) === 'asked') store.write('questions', q.key, { status: 'to_ask', askedAtVisitId: null });
      store.remove('visits', key).then(() => { location.hash = '#visits'; });
    } else if (act === 'q-answer') {
      const ta = this.frame.querySelector(`textarea[data-q-ans="${CSS.escape(key)}"]`);
      const answer = ta?.value.trim();
      if (!answer) { ta?.focus(); return; }
      ta.blur();
      const q = store.question(key) || {};
      store.write('questions', key, { status: 'answered', answer, answeredBy: store.user, answeredAt: Date.now(), askedAtVisitId: t.dataset.visit, askedBy: q.askedBy || store.user, askedAt: q.askedAt || Date.now() });
    } else if (act === 'q-detach') store.write('questions', key, { status: 'to_ask', askedAtVisitId: null });
    else if (act === 'r-status') store.setResultStatus(key, val);
    else if (act === 'r-due-clear') store.saveResult(key, { confirmedDueDate: null, confirmedDueBy: null, confirmedDueAt: null });
    else if (act === 'r-delete') { if (confirm('Delete this record?')) store.remove('results', key).then(() => { location.hash = '#visits'; }); }
    else if (act === 'r-add') { uiState.open[uiState.open.has('r-add') ? 'delete' : 'add']('r-add'); this.update(); this.frame.querySelector('form[data-add-result] input')?.focus(); }
  },
  onSubmit(e) {
    const form = e.target.closest('form[data-add-result]');
    if (!form) return;
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return;
    uiState.open.delete('r-add');
    store.addResult({ name, category: form.category.value }).then((k) => { location.hash = `#visits/r/${k}`; });
  },

  // ---- pages ----
  update() {
    const [kind, key] = this.params;
    if (kind === 'symptoms') return symptomLog.update();
    if (kind === 'since') return sinceView.update();
    if (kind === 'v') return this.visitPage(key);
    if (kind === 'r') return this.resultPage(key);
    return this.listPage();
  },
  listPage() {
    const today = todayISO();
    const { upcoming, past } = sortVisits(store.visits());
    const results = store.results();
    const addOpen = uiState.open.has('r-add');
    const since = store.sinceLastVisit(), symCount = store.symptomList().length;
    this.frame.innerHTML = `
      <div class="sec-head"><h2 class="serif">Visits</h2><small>${past.length ? `${past.length} logged` : 'the log, on both phones'}</small></div>
      <button class="btn primary big" data-act="v-new">+ Add a visit</button>
      <div class="two sym-links">
        <button class="linkrow" data-go="visits/since"><span>Since last visit<small>${since.visit ? `${since.entries.length} logged since ${formatDate(since.visit.date)}` : 'the symptom record for the waiting room'}</small></span><span class="arrow">→</span></button>
        <button class="linkrow" data-go="visits/symptoms"><span>Symptom log<small>${symCount ? `${symCount} logged` : 'by day, from Today'}</small></span><span class="arrow">→</span></button>
      </div>
      ${upcoming.length ? `<div class="grp vgrp">Upcoming</div>${upcoming.map((v) => this.visitCard(v, today)).join('')}` : ''}
      ${past.length ? `<div class="grp vgrp">Past</div>${past.map((v) => this.visitCard(v, today)).join('')}` : upcoming.length ? '' : `<div class="empty"><b>No visits yet</b>One tap adds one — a date and a type is enough to start.</div>`}
      <div class="sec-head" style="margin-top:var(--sp-26)"><h2 class="serif">Results &amp; labs</h2><small>ordered · scheduled · back</small></div>
      ${results.map((r) => this.resultCard(r)).join('')}
      ${addOpen ? `<form class="compose" data-add-result>
          <input type="text" name="name" placeholder="Name of the test or scan" autocomplete="off" enterkeyhint="done" data-hold>
          <div class="row"><select name="category" class="select" aria-label="Category">${RESULT_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select><span><button type="button" class="btn sm" data-act="r-add">Cancel</button> <button class="btn sm primary" type="submit">Add</button></span></div>
        </form>` : `<div class="stack"><button class="btn" data-act="r-add">+ Add a record</button></div>`}`;
  },
  visitCard(v, today) {
    const up = visitStatus(v) === 'Upcoming';
    const late = up && v.date && v.date < today;
    const qs = store.questionsForVisit(v.key);
    const g = gestLabel(v.gest);
    const line = v.date ? `${formatDate(v.date).toUpperCase()}${v.time ? ` · ${formatTime(v.time)}` : ''}${g ? ` · ${g}` : ''}` : 'DATE TO SET';
    return `<button class="card visit-card${up ? ' upcoming' : ''}" data-go="visits/v/${esc(v.key)}">
      <div class="ev-date">${esc(line)}</div>
      <div class="ev-title">${esc(visitType(v))}${v.provider ? ` · ${esc(v.provider)}` : ''}</div>
      ${v.summary ? `<div class="ev-note">${esc(v.summary)}</div>` : up ? `<div class="ev-note">${late ? 'Date has passed — open it to mark it completed' : 'Tap to fill in as you go'}</div>` : ''}
      <div class="v-foot">${up ? `<span class="chip${late ? ' sand' : ''}">${late ? 'Still marked upcoming' : 'Upcoming'}</span>` : `<span class="chip sand">Completed</span>`}${qs.length ? `<small>${qs.length} question${qs.length === 1 ? '' : 's'}</small>` : ''}${v.seenBy ? `<small>seen by ${esc(v.seenBy)}</small>` : ''}</div>
    </button>`;
  },
  visitPage(key) {
    const v = store.visit(key);
    if (!v) { this.frame.innerHTML = `<div class="page"><button class="back" data-go="visits">← Visits</button><div class="empty"><b>Not in the log</b>That visit was removed.</div></div>`; return; }
    const st = visitStatus(v), type = visitType(v), doc = `visits/${esc(key)}`, g = gestLabel(v.gest);
    const attached = store.questionsForVisit(key);
    const asked = attached.filter((q) => qStatus(q) === 'asked');
    const answered = attached.filter((q) => qStatus(q) === 'answered').sort((a, b) => (a.answeredAt || 0) - (b.answeredAt || 0));
    // attachable: Open, or marked Asked from the Questions tab without a visit
    const attachable = store.openQuestions().filter((q) => qStatus(q) === 'to_ask' || !q.askedAtVisitId);
    const linked = store.resultsForVisit(key);
    const field = (label, f, placeholder = '') => `<label class="field"><span>${label}</span><input type="text" data-hold data-doc="${doc}" data-f="${f}" value="${esc(v[f] || '')}" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done"></label>`;
    this.frame.innerHTML = `<div class="page">
      <button class="back" data-go="visits">← Visits</button>
      <div class="seg" role="group" aria-label="Status">${VISIT_STATUS.map((s) => `<button type="button" class="${s === st ? 'on' : ''}" data-act="v-status" data-key="${esc(key)}" data-val="${s}" aria-pressed="${s === st}">${s}</button>`).join('')}</div>
      <h2 class="title">${esc(type)} visit</h2>
      <small class="date-meta">${v.date ? `${g ? `${g} at this visit` : ''}${v.gest?.due ? ` · counted against due ${fmtLong(v.gest.due)}` : ''}` : 'Set the date to stamp the week'}</small>
      <div class="two">
        <label class="field"><span>Date</span><input type="date" data-hold data-doc="${doc}" data-f="date" value="${esc(v.date || '')}"></label>
        <label class="field"><span>Time <em>(optional)</em></span><input type="time" data-hold data-doc="${doc}" data-f="time" value="${esc(v.time || '')}"></label>
      </div>
      <div class="field"><span>Type</span><div class="opts">${VISIT_TYPES.map((t) => `<button type="button" class="opt${t === type ? ' on' : ''}" data-act="v-type" data-key="${esc(key)}" data-val="${t}">${t}</button>`).join('')}</div></div>
      ${field('Provider', 'provider')}
      ${field('Seen by', 'seenBy', 'who you saw')}
      ${field('Who went', 'attendees', 'Q, Staci…')}
      <div class="field"><span>Vitals <em>(as written down · optional)</em></span>
        <div class="vitals">${VITALS.map((x) => `<label><small>${esc(x.label)}</small><input type="text" data-hold data-doc="${doc}" data-f="vitals.${x.key}" value="${esc(v.vitals?.[x.key] || '')}" autocomplete="off" enterkeyhint="done"></label>`).join('')}</div>
      </div>
      <label class="field"><span>Summary</span><textarea data-hold data-doc="${doc}" data-f="summary" placeholder="What happened, what they said…">${esc(v.summary || '')}</textarea></label>
      <label class="field"><span>Next steps</span><textarea data-hold data-doc="${doc}" data-f="nextSteps" placeholder="What's next, in their words…">${esc(v.nextSteps || '')}</textarea></label>
      <small class="date-meta">Added by ${stamp(v.createdBy, v.createdAt)}${v.updatedAt && v.updatedAt - (v.createdAt || 0) > 2000 ? ` · last saved by ${stamp(v.updatedBy, v.updatedAt)}` : ''}</small>

      <div class="sec-head" style="margin-top:var(--sp-22)"><h2 class="serif">Questions</h2><small>${attached.length ? `${answered.length} of ${attached.length} answered here` : 'from Notes &amp; Qs'}</small></div>
      ${asked.length ? `<div class="grp vgrp">Asking at this visit</div>${asked.map((q) => this.askedCard(q, key)).join('')}` : ''}
      ${answered.length ? `<div class="grp vgrp">Answered here</div>${answered.map((q) => this.answeredCard(q)).join('')}` : ''}
      <div class="grp vgrp">Open questions</div>
      ${attachable.length ? `<div class="checklist"><ul class="items">${attachable.map((q) => `<li class="item">
          <label class="chk"><input type="checkbox" data-attach-q="${esc(q.key)}" data-visit="${esc(key)}"><span class="box"></span></label>
          <div class="item-body"><div class="item-text">${esc(q.text)}</div><div class="item-meta">Added by ${stamp(q.author || q.createdBy, q.createdAt)} · tick to ask it here</div></div></li>`).join('')}</ul></div>`
        : `<div class="empty"><b>Nothing open</b>Questions added under Notes &amp; Qs show up here.</div>`}
      <button class="linkrow" data-go="notes/questions"><span>Add a question<small>Notes &amp; Qs → Questions</small></span><span class="arrow">→</span></button>
      ${linked.length ? `<div class="sec-head" style="margin-top:var(--sp-22)"><h2 class="serif">Results from this visit</h2></div>${linked.map((r) => this.resultCard(r)).join('')}` : ''}
      <div class="stack" style="margin-top:var(--sp-22)"><button class="btn danger ghost" data-act="v-delete" data-key="${esc(key)}">Delete visit</button></div>
    </div>`;
  },
  askedCard(q, visitKey) {
    return `<article class="q asked">
      <div class="q-top"><div class="q-text">${esc(q.text)}</div></div>
      <div class="q-meta"><b>Asked</b> by ${stamp(q.askedBy, q.askedAt)}</div>
      <div class="q-answer"><textarea data-hold data-q-ans="${esc(q.key)}" placeholder="What did they say?">${esc(q.answer || '')}</textarea></div>
      <div class="q-actions"><button class="btn primary" data-act="q-answer" data-key="${esc(q.key)}" data-visit="${esc(visitKey)}">Save answer</button><button class="btn" data-act="q-detach" data-key="${esc(q.key)}">Not asked</button></div>
    </article>`;
  },
  answeredCard(q) {
    return `<article class="q answered">
      <div class="q-text">${esc(q.text)}</div>
      <div class="ans"><span class="k">Answer</span>${esc(q.answer)}</div>
      <div class="q-meta">Answered by ${stamp(q.answeredBy, q.answeredAt)}</div>
    </article>`;
  },
  resultCard(r) {
    const st = resultStatus(r), idx = RESULT_STATUS.indexOf(st);
    const when = r.resultDate ? `result ${formatDate(r.resultDate, { weekday: false })}` : r.scheduledDate ? `scheduled ${formatDate(r.scheduledDate, { weekday: false })}` : '';
    return `<button class="list-card result-card" data-go="visits/r/${esc(r.key)}">
      <div class="t"><b>${esc(r.name)}</b><span>${esc(resultCategory(r))}</span></div>
      <div class="s"><span class="status-chip s${idx}">${esc(st)}</span>${when ? `<span>${esc(when)}</span>` : ''}${r.key === DATING_ULTRASOUND_ID && r.confirmedDueDate ? `<span>due ${fmtLong(r.confirmedDueDate)}</span>` : ''}</div>
    </button>`;
  },
  resultPage(key) {
    const r = store.result(key);
    if (!r) { this.frame.innerHTML = `<div class="page"><button class="back" data-go="visits">← Visits</button><div class="empty"><b>No such record</b>It may have been removed.</div></div>`; return; }
    const st = resultStatus(r), doc = `results/${esc(key)}`;
    const { upcoming, past } = sortVisits(store.visits());
    const all = [...upcoming, ...past];
    const hist = [...(r.history || [])].reverse();
    const dating = key === DATING_ULTRASOUND_ID;
    this.frame.innerHTML = `<div class="page">
      <button class="back" data-go="visits">← Visits</button>
      <div><span class="tag med">${esc(resultCategory(r))}</span></div>
      <h2 class="title">${esc(r.name)}</h2>
      <div class="field"><span>Status</span>
        <div class="opts">${RESULT_STATUS.map((s) => `<button type="button" class="opt${s === st ? ' on' : ''}" data-act="r-status" data-key="${esc(key)}" data-val="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        ${hist.length ? `<details class="info top"${uiState.open.has(`hist:${key}`) ? ' open' : ''}><summary data-fold="hist:${esc(key)}"><span>History</span><i aria-hidden="true">›</i></summary><div class="info-body"><ul class="hist">${hist.map((h) => `<li><b>${esc(h.status)}</b> · ${stamp(h.by, h.at)}</li>`).join('')}</ul></div></details>` : `<small>No status changes yet.</small>`}
      </div>
      <div class="two">
        <label class="field"><span>Scheduled</span><input type="date" data-hold data-doc="${doc}" data-f="scheduledDate" value="${esc(r.scheduledDate || '')}"></label>
        <label class="field"><span>Result date</span><input type="date" data-hold data-doc="${doc}" data-f="resultDate" value="${esc(r.resultDate || '')}"></label>
      </div>
      <label class="field"><span>Result</span><textarea data-hold data-doc="${doc}" data-f="result" placeholder="Copy it in as it was given.">${esc(r.result || '')}</textarea></label>
      <label class="field"><span>Notes</span><textarea data-hold data-doc="${doc}" data-f="notes" placeholder="Anything to remember about this one…">${esc(r.notes || '')}</textarea></label>
      <label class="field"><span>Linked visit</span>
        <select class="select" data-doc="${doc}" data-f="linkedVisitId"><option value="">— none —</option>${all.map((v) => `<option value="${esc(v.key)}"${v.key === r.linkedVisitId ? ' selected' : ''}>${v.date ? esc(formatDate(v.date, { year: true })) : 'No date'} · ${esc(visitType(v))}</option>`).join('')}</select>
      </label>
      ${dating ? `<label class="field"><span>Confirmed due date <em>(optional)</em></span>
        <div class="addrow" style="padding:0"><input type="date" data-hold data-doc="${doc}" data-f="confirmedDueDate" value="${esc(r.confirmedDueDate || '')}">${r.confirmedDueDate ? `<button type="button" class="btn sm" data-act="r-due-clear" data-key="${esc(key)}">Clear</button>` : ''}</div>
        <small>${r.confirmedDueDate ? `Set by ${stamp(r.confirmedDueBy, r.confirmedDueAt)}. ` : ''}The date the scan gives. Today shows a banner with one button — the app's due date only changes when someone taps it.</small>
      </label>` : ''}
      <small class="date-meta">${r.updatedBy ? `Last saved by ${stamp(r.updatedBy, r.updatedAt)}` : 'Nothing entered yet'}</small>
      ${r.seed ? '' : `<div class="stack" style="margin-top:var(--sp-22)"><button class="btn danger ghost" data-act="r-delete" data-key="${esc(key)}">Delete record</button></div>`}
    </div>`;
  },
};
