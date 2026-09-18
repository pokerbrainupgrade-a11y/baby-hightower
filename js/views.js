// The five tabs + detail pages + settings. Each view is { render(root, params), update() }.
// A view may also expose navigate(params): the router calls it instead of
// render() when only the params change (segment switch, sub-page), so the
// frame and its inputs are kept.
// render() builds the static frame once and binds listeners on it; update()
// re-renders only the live containers, so the frame's inputs keep focus.
import { store } from './store.js';
import { summary, todayISO, formatGestation, formatStamp, formatDate } from './dates.js';
import { APP_VERSION, LMP, DUE, USERS } from './config.js';
import { OB_CALL } from './obcall.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = (hash) => { location.hash = hash; };
const stamp = (who, ms) => (who ? `${esc(who)} · ${formatStamp(ms)}` : '');
export const uiState = { answering: new Set(), editing: null };

// ---------- shared pieces ----------
function eventCard(e, today) {
  const done = !!e.state.done;
  return `<div class="ev ${e.category}${e.date < today ? ' past' : ''}${done ? ' done' : ''}">
    <button class="card" data-go="timeline/ev/${esc(e.id)}">
      ${e.dateLabel ? `<div class="ev-date">${esc(e.dateLabel)}</div>` : ''}
      <div class="ev-title">${done ? '<span class="tick">✓</span>' : ''}${esc(e.title)}</div>
      ${e.note ? `<div class="ev-note">${esc(e.note)}</div>` : ''}
      ${e.linkLabel ? `<span class="ev-link">${esc(e.linkLabel)}</span>` : ''}
    </button></div>`;
}

function progressBar(p) {
  return `<div class="bar${p.total && p.done === p.total ? ' full' : ''}"><i style="width:${p.pct}%"></i></div>`;
}

/** Checklist block (used on the Lists page and inside event/guide detail). */
function checklistHTML(listId, { compact = false } = {}) {
  const list = store.seed.lists.find((l) => l.id === listId);
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
    <form class="addrow" data-add-item="${esc(listId)}">
      <input type="text" name="text" placeholder="Add an item…" autocomplete="off" enterkeyhint="done">
      <button class="btn sm primary" type="submit">Add</button>
    </form>
  </div>`;
}

function itemHTML(it) {
  if (uiState.editing === `item:${it.id}`) {
    return `<li class="item editing"><div class="editor">
      <input type="text" data-hold value="${esc(it.text)}" data-edit-text="${esc(it.id)}">
      <div class="row">
        <button class="btn sm primary" data-save-item="${esc(it.id)}">Save</button>
        <button class="btn sm" data-cancel-edit>Cancel</button>
        <button class="btn sm danger" data-delete-item="${esc(it.id)}">Delete</button>
      </div></div></li>`;
  }
  const meta = it.done ? `Checked by ${stamp(it.checkedBy, it.checkedAt)}` : (it.custom ? `Added by ${stamp(it.createdBy, it.createdAt)}` : '');
  return `<li class="item${it.done ? ' done' : ''}">
    <label class="chk"><input type="checkbox" data-item="${esc(it.id)}" ${it.done ? 'checked' : ''}><span class="box"></span></label>
    <div class="item-body"><div class="item-text">${esc(it.text)}</div>${meta ? `<div class="item-meta">${meta}</div>` : ''}</div>
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
    const t = e.target.closest('[data-edit-item],[data-save-item],[data-cancel-edit],[data-delete-item]');
    if (!t) return;
    if (t.dataset.editItem !== undefined) { uiState.editing = `item:${t.dataset.editItem}`; view.update(); frame.querySelector('[data-edit-text]')?.focus(); }
    else if (t.dataset.cancelEdit !== undefined) { uiState.editing = null; view.update(); }
    else if (t.dataset.saveItem !== undefined) {
      const id = t.dataset.saveItem;
      const text = frame.querySelector(`[data-edit-text="${CSS.escape(id)}"]`).value.trim();
      const listId = t.closest('[data-list]').dataset.list;
      uiState.editing = null;
      if (text) store.write('items', id, { listId, text }); else view.update();
    } else if (t.dataset.deleteItem !== undefined) {
      if (!confirm('Delete this item?')) return;
      uiState.editing = null;
      store.remove('items', t.dataset.deleteItem);
    }
  });
}

// ---------- TODAY ----------
const today = {
  render(root) {
    root.innerHTML = `<section class="today" id="todayFrame"></section>`;
    this.frame = root.firstElementChild;
    this.update();
  },
  update() {
    const s = summary();
    const m = store.seed.meta;
    const evs = store.events();
    const dev = evs.filter((e) => e.category === 'dev' && e.date <= s.iso).pop() || evs.find((e) => e.category === 'dev');
    const next = evs.filter((e) => e.category !== 'dev' && e.date >= s.iso && !e.state.done).slice(0, 3);
    const overdue = evs.filter((e) => e.category !== 'dev' && e.date < s.iso && !e.state.done);
    const open = store.questions().filter((q) => q.status !== 'answered').length;
    const pill = s.pastDue || s.dueToday
      ? `<b>40+</b><span>weeks — any moment now</span>`
      : `<b>${s.g.weeks}w ${s.g.day}d</b><span>pregnant today</span>`;
    const count = s.pastDue ? `Due date was ${formatDate(DUE)} · baby's call now` : s.dueToday ? `Today is the due date 🌟` : `${s.left} days to May 11 · ${s.weeksLeft} weeks to go`;
    this.frame.innerHTML = `
      <div class="hero">
        <div class="hdr-eyebrow">${esc(m.eyebrow)}</div>
        <h1 class="serif">Baby <span class="amp">Hightower</span></h1>
        <div class="hdr-due">${esc(m.due)}</div>
        <div class="weekpill">${pill}</div>
        <div class="countline">${count}</div>
        <div class="chips"><span class="chip">Trimester ${s.trimester}</span><span class="chip sand">${formatDate(s.iso, { weekday: true })}</span></div>
      </div>
      ${dev ? `<div class="sec"><div class="now-card"><div class="k">Baby is growing</div><p>${esc(dev.title)}</p></div></div>` : ''}
      <div class="sec"><div class="sec-head"><h2 class="serif">Up next</h2><small>${next.length ? 'tap for the plan' : ''}</small></div>
        ${next.length ? `<div class="spine">${next.map((e) => eventCard(e, s.iso)).join('')}</div>` : `<div class="empty"><b>Nothing left on the timeline</b>Everything's either done or behind you.</div>`}
      </div>
      <button class="linkrow" data-go="notes/questions"><span>${open ? `${open} question${open === 1 ? '' : 's'} queued for the next visit` : 'No questions queued for the next visit'}<small>Anyone can add one, anytime</small></span><span class="arrow">→</span></button>
      ${overdue.length ? `<button class="linkrow" data-go="timeline"><span>${overdue.length} past event${overdue.length === 1 ? '' : 's'} not marked complete<small>Open the timeline to tick them off</small></span><span class="arrow">→</span></button>` : ''}`;
  },
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
    this.frame.innerHTML = `
      <div class="legend">
        <span><i style="background:var(--sage)"></i>${esc(legend[0])}</span>
        <span><i style="background:var(--blush-deep)"></i>${esc(legend[1])}</span>
        <span><i style="background:var(--sand-deep)"></i>${esc(legend[2])}</span>
        <span><i style="background:var(--cream);border:2px solid var(--sage-deep);width:8px;height:8px"></i>${esc(legend[3])}</span>
      </div>
      ${store.seed.trimesters.map((t) => `
        <div class="tri"><div class="tri-head"><h2 class="serif">${esc(t.title)}</h2><small>${esc(t.range)}</small></div>
        <p class="tri-sub">${esc(t.sub)}</p>
        <div class="spine">${t.events.map((e) => eventCard({ ...e, state: store.get('events', e.id) || {} }, iso)).join('')}</div></div>`).join('')}
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
      ${e.dateLabel ? `<div class="ev-date">${esc(e.dateLabel)}</div>` : `<div class="ev-date">${esc(formatDate(e.date, { year: true }))} · ${formatGestation(summaryAt(e.date))}</div>`}
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
    root.innerHTML = `<section id="clFrame"></section>`;
    this.frame = root.firstElementChild;
    bindChecklist(this.frame, this);
    this.update();
  },
  update() {
    const [listId] = this.params;
    if (listId) {
      const list = store.seed.lists.find((l) => l.id === listId);
      if (!list) { this.frame.innerHTML = `<div class="page"><button class="back" data-go="checklists">← Lists</button><div class="empty">No such list.</div></div>`; return; }
      const g = store.guide(list.guide);
      this.frame.innerHTML = `<div class="page">
        <button class="back" data-go="checklists">← Lists</button>
        <h2 class="title">${esc(list.title)}</h2>
        <p class="ev-note">${esc(list.sub)}</p>
        ${checklistHTML(listId)}
        ${g ? `<button class="linkrow" data-go="timeline/guide/${esc(g.id)}"><span>Read the guide: ${esc(g.title)}<small>${esc(g.tag)}</small></span><span class="arrow">→</span></button>` : ''}
      </div>`;
      return;
    }
    this.frame.innerHTML = `
      <div class="sec-head"><h2 class="serif">Checklists</h2><small>who checked what, on both phones</small></div>
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
const questions = {
  render(root) {
    root.innerHTML = `<section id="qFrame">
      <form class="ask" id="qForm">
        <input type="text" name="text" placeholder="Ask at the next visit…" autocomplete="off" enterkeyhint="done">
        <button class="btn primary" type="submit">Add</button>
      </form>
      <div class="sec-head"><h2 class="serif">Next visit</h2><span class="count" id="qCount"></span></div>
      <div id="qNext"></div>
      <details class="archive" id="qArchive"><summary>Answered <small id="qDoneCount"></small></summary><div id="qDone"></div></details>
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
    });
    // iOS "done" key: make sure Enter always submits, even in standalone mode
    form.text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } });
    this.frame.addEventListener('click', (e) => {
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
      else if (act === 'unask') store.write('questions', key, { status: 'to_ask' });
      else if (act === 'reopen') store.write('questions', key, { status: 'to_ask' });
      else if (act === 'delete') { if (confirm('Delete this question?')) store.remove('questions', key); }
    });
    this.update();
  },
  update() {
    const all = store.questions();
    const next = all.filter((q) => q.status !== 'answered');
    const done = all.filter((q) => q.status === 'answered').sort((a, b) => (b.answeredAt || 0) - (a.answeredAt || 0));
    this.frame.querySelector('#qCount').textContent = next.length || '';
    this.frame.querySelector('#qDoneCount').textContent = done.length ? `(${done.length})` : '(none yet)';
    this.frame.querySelector('#qNext').innerHTML = next.length ? next.map((q) => this.card(q)).join('')
      : `<div class="empty"><b>Nothing queued</b>Type a question above — it lands here for whoever's at the visit.</div>`;
    this.frame.querySelector('#qDone').innerHTML = done.map((q) => this.card(q)).join('');
  },
  card(q) {
    const key = q.key;
    const answering = q.status === 'asked' || uiState.answering.has(key);
    const meta = [`Added by ${stamp(q.author || q.createdBy, q.createdAt)}`];
    if (q.status === 'asked') meta.push(`<b>Asked</b> by ${stamp(q.askedBy, q.askedAt)}`);
    if (q.status === 'answered') meta.push(`Answered by ${stamp(q.answeredBy, q.answeredAt)}`);
    let actions = '';
    if (q.status === 'answered') {
      actions = `<div class="ans"><span class="k">Answer</span>${esc(q.answer)}</div>
        <div class="q-actions"><button class="btn sm" data-q="${key}" data-act="reopen">Ask again</button><button class="btn sm danger ghost" data-q="${key}" data-act="delete">Delete</button></div>`;
    } else if (answering) {
      actions = `<div class="q-answer"><textarea data-hold data-q-ans="${key}" placeholder="What did they say?">${esc(q.answer || '')}</textarea></div>
        <div class="q-actions"><button class="btn primary" data-q="${key}" data-act="save">Save answer</button>
        ${q.status === 'asked' ? `<button class="btn" data-q="${key}" data-act="unask">Not asked yet</button>` : `<button class="btn" data-q="${key}" data-act="hide">Cancel</button>`}</div>`;
    } else {
      actions = `<div class="q-actions"><button class="btn" data-q="${key}" data-act="asked">✓ Asked</button><button class="btn primary" data-q="${key}" data-act="answer">Answer</button></div>`;
    }
    return `<article class="q ${esc(q.status)}">
      <div class="q-top"><div class="q-text">${esc(q.text)}</div>${q.status !== 'answered' ? `<button class="more" data-q="${key}" data-act="delete" aria-label="Delete">⋯</button>` : ''}</div>
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
    const open = store.questions().filter((q) => q.status !== 'answered').length;
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
    });
    this.frame.addEventListener('submit', (e) => {
      e.preventDefault();
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
      <form class="field"><span>Household code</span>
        <div class="addrow" style="padding:0"><input type="text" name="code" value="${esc(id.code || '')}" autocapitalize="none" autocorrect="off" spellcheck="false" minlength="4" required><button class="btn sm primary" type="submit">Save</button></div>
        <small>Same code on both phones. Changing it reloads the app and joins that household.</small>
      </form>
      <div class="field"><span>Backup</span>
        <div class="stack"><button class="btn" data-act="export">Export everything as JSON</button></div>
        <small>Every check, note, question, listened episode and event state — the seed content is in the app itself.</small>
      </div>
      <div class="field"><span>App</span>
        <div class="kv" style="margin-top:0">
          <div class="row"><span class="l">Version</span><b>${esc(APP_VERSION)}</b></div>
          <div class="row"><span class="l">Anchor</span><b>LMP ${formatDate(LMP, { year: true })} · due ${formatDate(DUE, { year: true })}</b></div>
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

export const views = { today, timeline, checklists, notes: notesq, resources, settings };
