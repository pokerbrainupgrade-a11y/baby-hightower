// Tiny helpers shared by the view modules (views.js, visitsview.js).
import { formatStamp } from './dates.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Escape, then render the one bit of inline markup the list content uses: **bold**. */
export const rich = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
export const stamp = (who, ms) => (who ? `${esc(who)} · ${formatStamp(ms)}` : '');
export const progressBar = (p) => `<div class="bar${p.total && p.done === p.total ? ' full' : ''}"><i style="width:${p.pct}%"></i></div>`;
// filter: listId → 'All' | 'Must' | 'Nice' | 'Later' | 'Skip' (sectioned lists) · 'questions' → 'Open' | 'Answered' | 'All'
// closed: '<listId>/<sectionId>' keys of collapsed sections · open: info cards / answered questions the user expanded
export const uiState = { answering: new Set(), editing: null, filter: new Map(), closed: new Set(), open: new Set() };
