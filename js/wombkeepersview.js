// The Wombkeepers emergency pager card on Today. Every sentence on it comes
// verbatim from data/wombkeepers.json → emergencyPager; the app adds only
// button labels. Calm on purpose: the existing palette, no red, no alarm.
import { store } from './store.js';
import { esc } from './ui.js';
import { smsHref, attribution } from './wombkeepers.js';

export function pagerCard() {
  const p = store.wombkeepers?.emergencyPager;
  if (!p) return '';
  return `<div class="sec"><div class="now-card pager-card">
    <div class="k">Wombkeepers emergency pager · <span class="nw">${esc(p.number)}</span></div>
    <div class="pager-btns">
      <a class="btn big primary" href="${esc(smsHref(p.tel, p.smsTemplate))}">Text the pager</a>
      <p class="pager-note">${esc(p.textInstructions)}</p>
      <button type="button" class="btn sm ghost pager-copy" data-pager-copy>Copy text template</button>
      <a class="btn big" href="tel:${esc(p.tel)}">Call the pager</a>
      <p class="pager-note">${esc(p.dialInstructions)}</p>
    </div>
    <p class="pager-small">${esc(p.use)}</p>
    <p class="pager-small">${esc(p.responseTime)}</p>
    <p class="pager-small">${esc(p.beforeHospital)}</p>
    <small class="range">${esc(attribution(p.pages))}</small>
  </div></div>`;
}

export function bindPager(frame) {
  frame.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-pager-copy]')) return;
    const text = store.wombkeepers?.emergencyPager?.smsTemplate || '';
    try { await navigator.clipboard.writeText(text); window.toast?.('Template copied — paste it into Messages'); }
    catch { window.toast?.('Couldn’t copy — type it from the line above'); }
  });
}
