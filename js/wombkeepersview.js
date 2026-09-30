// The Wombkeepers emergency pager card on Today. Every sentence on it comes
// verbatim from data/wombkeepers.json → emergencyPager; the app adds only
// button labels. Calm on purpose: the existing palette, no red, no alarm.
import { store } from './store.js';
import { esc } from './ui.js';
import { summary } from './dates.js';
import { smsHref, telHref, mapsHref, bandFor, sortContacts, attribution } from './wombkeepers.js';

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
    <button class="linkrow" data-go="resources/wombkeepers"><span>Wombkeepers reference<small>Contacts, when to call, schedule, fees and more</small></span><span class="arrow">→</span></button>
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

// ---------- the Wombkeepers reference page (#resources/wombkeepers) ----------
// Fifteen collapsible sections rendered straight from data/wombkeepers.json,
// each with its page attribution. Sub-headings name the JSON's own groups;
// every sentence of provider text is shown as given. The one derivation is
// which "When to call" band starts open (bandFor, off the pill's week).

const SECTIONS = [
  { id: 'reach', title: 'Reach us', open: true },
  { id: 'when', title: 'When to call', open: true },
  { id: 'visits', title: 'Visits & schedule' },
  { id: 'screening', title: 'Screening & tests' },
  { id: 'meds', title: 'Medications' },
  { id: 'food', title: 'Food & diet' },
  { id: 'exercise', title: 'Exercise' },
  { id: 'vaccines', title: 'Vaccines' },
  { id: 'travel', title: 'Travel' },
  { id: 'birth', title: 'Birth center & holidays' },
  { id: 'money', title: 'Money & billing' },
  { id: 'paperwork', title: 'Leave paperwork' },
  { id: 'peds', title: 'Pediatricians' },
  { id: 'wellness', title: 'Wellness services' },
  { id: 'after', title: 'After birth' },
];
// Toggled state per session: key → open? (absent = the section's default)
const openState = new Map();
const isOpen = (key, dflt) => (openState.has(key) ? openState.get(key) : !!dflt);

const src = (pages) => (pages ? `<p class="wk-src">${esc(attribution(pages))}</p>` : '');
const ul = (items) => (items?.length ? `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '');
const sub = (t) => `<h3 class="wk-sub">${esc(t)}</h3>`;
const para = (t) => (t ? `<p>${esc(t)}</p>` : '');
const labelled = (rows, k, v) => rows.map((r) => `<div class="wk-row"><b>${esc(r[k])}</b><p>${esc(r[v])}</p>${src(r.pages)}</div>`).join('');

function fold(key, title, body, dflt, cls = '') {
  return `<details class="info wk-sec ${cls}"${isOpen(key, dflt) ? ' open' : ''}><summary data-wk-fold="${esc(key)}" data-wk-default="${dflt ? 1 : 0}"><span>${esc(title)}</span><i aria-hidden="true">›</i></summary><div class="info-body">${body}</div></details>`;
}

function contactCard(c) {
  const tel = telHref(c.phone), map = c.address ? mapsHref(c.address) : null;
  const acts = [
    tel ? `<a class="btn sm" href="${esc(tel)}">Call ${esc(c.phone)}</a>` : '',
    c.email ? `<a class="btn sm" href="mailto:${esc(c.email)}">Email</a>` : '',
    map ? `<a class="btn sm" href="${esc(map)}" target="_blank" rel="noopener noreferrer">Map</a>` : '',
  ].join('');
  return `<div class="wk-contact">
    <b>${esc(c.label)}</b>
    <small>${esc([c.organization, c.category].filter(Boolean).join(' · '))}</small>
    ${c.email ? `<small>${esc(c.email)}</small>` : ''}
    ${c.address ? `<small>${esc(c.address)}</small>` : ''}
    ${acts ? `<div class="wk-acts">${acts}</div>` : ''}
    ${para(c.notes)}
    ${src(c.pages)}
  </div>`;
}

const body = {
  reach: (W) => `${sortContacts(W.contacts).map(contactCard).join('')}
    <div class="wk-row"><b>Emergency line</b><p>${esc(W.emergencyPager.notFor)}</p>${src(W.emergencyPager.pages)}</div>`,
  when(W) {
    const cur = bandFor(summary().g.weeks, W.whenToCall);
    return W.whenToCall.map((b, i) => fold(`when:${i}`, b.band, `${ul(b.items)}${src(b.pages)}${i === 0 && W.earlyPregnancyNote ? `${para(W.earlyPregnancyNote.text)}${src(W.earlyPregnancyNote.pages)}` : ''}`, i === cur, 'wk-band')).join('');
  },
  visits: (W) => labelled(W.visitSchedule, 'label', 'text'),
  screening: (W) => labelled(W.screening, 'when', 'text'),
  meds(W) {
    const M = W.medications;
    return `${para(M.disclaimer)}${para(M.practicePolicy)}
      ${sub('May use')}${M.mayUse.map((c) => `<div class="wk-row"><b>${esc(c.category)}</b>${ul(c.items)}</div>`).join('')}
      ${sub('Avoid')}
      <div class="wk-row"><b>Medications</b><p>${esc(M.avoid.medications)}</p></div>
      <div class="wk-row"><b>Supplements</b><p>${esc(M.avoid.supplements)}</p></div>
      <div class="wk-row"><b>Essential oils</b><p>${esc(M.avoid.essentialOils)}</p></div>
      ${src(M.pages)}`;
  },
  food: (W) => `${sub('Avoid')}${ul(W.food.avoid)}${sub('Diet')}${ul(W.food.dietRecs)}${sub('Supplements')}${para(W.food.firstVisitSupplements)}${src(W.food.pages)}`,
  exercise: (W) => {
    const E = W.exercise;
    return `${para(E.recommendation)}${sub('Not safe')}${ul(E.notSafe)}${sub('Discuss first')}${ul(E.discussFirst)}${sub('Exercising safely')}${ul(E.safely)}${sub('Stop and contact')}${ul(E.stopAndContact)}${sub('Birth ball')}${para(E.birthBall)}${src(E.pages)}`;
  },
  vaccines: (W) => `${para(W.vaccines.stance)}${ul(W.vaccines.recommended)}${para(W.vaccines.where)}${src(W.vaccines.pages)}`,
  travel: (W) => `${ul(W.travel.text)}${src(W.travel.pages)}`,
  birth: (W) => `${sub('Birth center')}${para(W.birthCenter.text)}${src(W.birthCenter.pages)}${sub('Holidays')}${para(W.holidayCoverage.text)}${src(W.holidayCoverage.pages)}`,
  money: (W) => labelled(W.fees, 'label', 'text'),
  paperwork: (W) => `${ul(W.paperwork.text)}${para(W.paperwork.firstVisitForms)}${src(W.paperwork.pages)}`,
  peds(W) {
    const P = W.pediatricians;
    return `${para(P.note)}${P.groups.map((g) => `<div class="wk-row"><b>${esc(g.name)}</b><small>${esc(g.where)}</small><p>${esc(g.notes)}</p></div>`).join('')}
      ${sub('Home care')}${para(P.homeCareNote)}<ul>${P.homeCare.map((h) => `<li><a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.name)}</a></li>`).join('')}</ul>${src(P.pages)}`;
  },
  wellness: (W) => `${ul(W.wellnessServices.items)}${para(W.wellnessServices.calendar)}${src(W.wellnessServices.pages)}`,
  after(W) {
    const P = W.postpartum, N = W.newborn;
    const NB = [['feeding', 'Feeding'], ['cord', 'Cord'], ['bathing', 'Bathing'], ['comforting', 'Comforting'], ['safeSleep', 'Safe sleep'], ['temperature', 'Temperature'], ['appearance', 'Appearance'], ['jaundice', 'Jaundice'], ['carSeat', 'Car seat'], ['illness', 'Illness'], ['development', 'Development']];
    return `<h3 class="wk-sub wk-sub-lg">Postpartum</h3>${sub('Call if')}${ul(P.callIf)}${sub('Pain medication')}${para(P.painMedication)}${sub('Care')}${ul(P.care)}${sub('Hospital stay')}${para(P.hospitalStay)}${src(P.pages)}
      <h3 class="wk-sub wk-sub-lg">Newborn</h3>${NB.filter(([k]) => N[k]?.length).map(([k, t]) => `${sub(t)}${ul(N[k])}`).join('')}${src(N.pages)}`;
  },
};

export const wombkeepersPage = {
  render(root) {
    root.innerHTML = `<section class="wk" id="wkFrame"></section>`;
    this.frame = root.firstElementChild;
    this.frame.addEventListener('click', (e) => {
      const s = e.target.closest('summary[data-wk-fold]');
      if (!s) return;
      // the toggle lands after this handler; record where it's going
      openState.set(s.dataset.wkFold, !s.parentElement.open);
    });
    this.update();
  },
  update() {
    const W = store.wombkeepers;
    if (!W) { this.frame.innerHTML = ''; return; }
    this.frame.innerHTML = `
      <div class="wk-head"><div class="hdr-eyebrow">${esc(W.source.practice)}</div><h2 class="title">Wombkeepers</h2>
        <small>From the ${esc(W.source.title)} — shown as given, for reference.</small></div>
      ${SECTIONS.map((s) => fold(s.id, s.title, body[s.id](W), s.open)).join('')}
      <div class="grp">First call</div>
      <button class="list-card" data-go="resources/obcall"><div class="t"><b>First Call with Wombkeepers</b><span>→</span></div><div class="s">The first-call phone guide, unchanged</div></button>`;
  },
};
