// Pure logic for the Purchases spend tracker. No DOM, no store
// (tests/budget.test.js). It adds money to the list items that already exist;
// an item with none of the cost fields set is exactly what it was before.
// It reports totals against the ceiling — nothing here judges, warns or blocks.

/** The lists whose items carry money and count toward the ceiling. */
export const BUDGET_LISTS = ['purchases', 'nursery', 'clothing', 'nursery-essentials', 'gobag'];
export const DEFAULT_CEILING = 4000;   // the default only — the live ceiling is settings/budget, editable in the app
export const PURCHASERS = ['Q', 'Staci', 'Gift'];
export const COVERAGE = ['Out of pocket', 'Insurance', 'HSA', 'Gift', 'Registry'];
export const DEFAULT_COVERAGE = 'Out of pocket';
/** How a coverage reads on screen. HSA is a label we put on it, not a ruling on eligibility. */
export const COVERAGE_LABEL = { 'Out of pocket': 'Out of pocket', Insurance: 'Insurance', HSA: 'marked HSA by us', Gift: 'Gift', Registry: 'Registry' };
export const coverageOf = (it) => (COVERAGE.includes(it?.coverage) ? it.coverage : DEFAULT_COVERAGE);
export const coverageLabel = (c) => COVERAGE_LABEL[c] || COVERAGE_LABEL[DEFAULT_COVERAGE];
/** Seeded cost fields on existing items — merged under any state doc, never written as one. */
export const SEED_COSTS = {
  'clothing-1c-7': { coverage: 'Insurance', estimatedCost: 0 },   // Breast pump
};

/** A typed amount → number, or null for blank / nonsense. Accepts "$1,200.50". */
export function parseMoney(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
export const isMoney = (v) => typeof v === 'number' && Number.isFinite(v);
/** 1234.5 → '$1,234.50' · 200 → '$200' · null → '—' */
export function fmtMoney(n) {
  if (!isMoney(n)) return '—';
  const abs = Math.abs(n), cents = Math.round(abs * 100) % 100 !== 0;
  return (n < 0 ? '-$' : '$') + abs.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}

/** Purchased means an actual cost has been entered (a date alone is just a date). */
export const isPurchased = (it) => isMoney(it?.actualCost);
/** Later and Skip items never count toward what's committed; everything else does. */
export const countsToward = (it) => it?.priority !== 'Later' && it?.priority !== 'Skip';
export const isPriced = (it) => isMoney(it?.estimatedCost) || isMoney(it?.actualCost);
/** Shown in the "unpriced" filter: nothing entered yet, and not a Skip item. */
export const isUnpriced = (it) => !isPriced(it) && it?.priority !== 'Skip';

/** Bar colour by share of the ceiling: sage under 75%, sand to 100%, blush-deep over. */
export const barTone = (pct) => (pct < 75 ? 'ok' : pct <= 100 ? 'warm' : 'over');

/** Gift and Registry cost us nothing: they never enter spent or committed, and are reported on their own. */
export const NOT_COUNTED = ['Gift', 'Registry'];
export const isCounted = (it) => !NOT_COUNTED.includes(coverageOf(it));

/**
 * spent / committed for any set of items — Gift and Registry items excluded —
 * plus `gifts` (actual value received that way) and `giftsExpected`
 * (estimates on gift / registry items not yet received). Informational only.
 */
export function totals(items) {
  let spent = 0, committed = 0, gifts = 0, giftsExpected = 0;
  for (const it of items) {
    if (!isCounted(it)) {
      if (isPurchased(it)) gifts += it.actualCost;
      else if (countsToward(it) && isMoney(it.estimatedCost)) giftsExpected += it.estimatedCost;
      continue;
    }
    if (isPurchased(it)) { spent += it.actualCost; continue; }
    if (countsToward(it) && isMoney(it.estimatedCost)) committed += it.estimatedCost;
  }
  return { spent: r2(spent), committed: r2(spent + committed), gifts: r2(gifts), giftsExpected: r2(giftsExpected) };
}
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * The budget view's numbers. `items` are the live items of the budget lists
 * (each with listId + listTitle); `ceiling` the household's setting.
 *   spent      sum of actualCost (Gift / Registry excluded)
 *   committed  spent + estimatedCost on unpurchased Must / Nice (and untagged) items (Gift / Registry excluded)
 *   remaining  ceiling − committed
 *   gifts      value received as gifts / registry — shown beside the numbers, never counted
 */
export function summarize(items, ceiling = DEFAULT_CEILING) {
  const c = isMoney(ceiling) && ceiling > 0 ? ceiling : DEFAULT_CEILING;
  const t = totals(items);
  const pct = r2((t.committed / c) * 100);
  const byCoverage = COVERAGE.map((cov) => ({ coverage: cov, label: coverageLabel(cov), counted: !NOT_COUNTED.includes(cov), ...totals(items.filter((it) => coverageOf(it) === cov)), n: items.filter((it) => coverageOf(it) === cov && isPriced(it)).length }));
  const byList = [];
  for (const it of items) {
    let g = byList.find((x) => x.listId === it.listId);
    if (!g) byList.push((g = { listId: it.listId, title: it.listTitle || it.listId, items: [] }));
    g.items.push(it);
  }
  for (const g of byList) Object.assign(g, totals(g.items), { n: g.items.length, unpriced: g.items.filter(isUnpriced).length });
  return {
    ceiling: c, spent: t.spent, committed: t.committed, remaining: r2(c - t.committed), pct, tone: barTone(pct),
    gifts: t.gifts, giftsExpected: t.giftsExpected,
    byCoverage, byList, unpriced: items.filter(isUnpriced).length,
  };
}
