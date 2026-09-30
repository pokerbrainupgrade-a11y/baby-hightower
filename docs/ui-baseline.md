# UI quality baseline (UI-0)

Measured 2026-09-30 on 1.10.1 (`37d4fd6`), before R-1. Measure only: nothing in the app was changed.
Screenshots: `docs/ui-baseline/<tab>-<390|1280>.png` for Today, Timeline, Lists (checklists), Visits,
Notes & Qs, Resources and Settings — full-page, Chromium, clock fixed at Wed Sep 30 2026 12:00
America/Phoenix, fresh storage, animations disabled, and sync fully off (`firebase-config.js` and the
Firebase SDK blocked, so the dot is always "Not syncing"). In a full-page capture the fixed tab bar is
drawn where the first viewport ends; that's the capture, not the app.

The screenshots were retaken once, on the same pre-R-1 code: the first set was captured with sync
attempting to connect under a throwaway code (denied by the rules), so the sync dot's colour depended on
timing. Run twice on unchanged code, the harness now differs by at most 65 scattered anti-aliased
pixels per image (max channel delta 10). That is the noise floor for R-1's "no visual change" diff.

The survival, date and airplane checks below (§3, §4, §6) ran with that throwaway code too. Everything
they test is local (IndexedDB, the service worker), and the rules refused every sync write, so nothing
reached Firestore.

## 1. Rhythm: values off the 4px scale, and font sizes

Counted: every px literal in padding / margin / gap / top·right·bottom·left / width / height /
min- and max- sizes / border-radius, in `css/app.css` and in `style=""` attributes in `js/*.js`.
Zero and percentages are skipped; borders, shadows and letter-spacing are not spacing.

| File | Off-scale | Of total |
|---|---|---|
| `css/app.css` | 348 (incl. 9 × `999px` pill radius, which is deliberate) | 635 |
| `js/visitsview.js` | 5 | 5 |
| `js/budgetview.js` | 2 | 3 |
| `js/views.js` | 2 | 5 |
| `js/app.js` | 0 | 2 |
| **Total** | **357 (348 excluding the pill radius)** | 650 |

Most common off-scale values: 10px (75), 6px (69), 2px (49), 14px (42), 9px (13), 5px (11), 11px (12), 22px (11), 13px (10).

**Distinct font sizes: 25** (10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 18, 19,
20, 21, 22, 24, 26, 27, 34, 46 px) plus the hero's `clamp(34px, 9vw, 46px)`. Twelve of them are half-pixel steps.

## 2. States per tab

✓ present · ◐ partial · ✗ missing · — not applicable

| Tab | Empty | Loading | Error / offline | Pressed | Disabled | Focus |
|---|---|---|---|---|---|---|
| Today | ✓ ("Nothing left on the timeline", empty week → next item) | ◐ | ◐ | ◐ | ✗ | ◐ |
| Timeline | — (seeded) | ◐ | ◐ | ◐ | ✗ | ◐ |
| Lists | ◐ (budget / decisions have text; a list emptied by deletes has none) | ◐ | ◐ | ◐ | ✗ | ◐ |
| Visits | ✓ (visits, results, symptoms, since-last-visit) | ◐ | ◐ | ◐ | ✗ | ◐ |
| Notes & Qs | ✓ (questions, answered, notes) | ◐ | ◐ | ◐ | ✗ | ◐ |
| Resources | — (static content) | ◐ | ◐ | ◐ | ◐ (First Call reset only) | ◐ |
| Settings | — | ◐ | ✓ (the one sync-status line) | ◐ | ✗ | ◐ |

- **Loading ◐ everywhere:** the local copy does render, with no spinner, but `#app` stays hidden (a blank
  cream screen) until the five data files load in `store.init()`.
- **Error / offline ◐:** a coloured sync dot plus a toast on going offline. There is no quiet sync-status line
  on the tabs themselves; the only readable status is in Settings. Writes do stay local and retry.
- **Pressed ◐:** `:active` exists for `.btn`, `.list-card`, `.opt`, `.quick-tag`, event cards, `.more`,
  episode links and decision summaries. It's missing on the tab bar, `.linkrow`, `.back`, the segment
  control, checkboxes and every `<details>` fold.
- **Disabled ✗:** only `.ob-reset:disabled` is styled.
- **Focus ◐:** inputs, textareas and the select have a focus ring. Buttons and links fall back to the
  browser default (not removed, not designed); there's no `:focus-visible` anywhere.
- **Tap targets under 44px:** `.btn.sm` (38px), `.more` (36px), `.filters .opt` (36px), the sync dot (12px).

## 3. Reload / force-close survival

Force-close = a real renderer crash (Chrome's `Page.crash`, so no `pagehide`), then a new page.

| Case | Result |
|---|---|
| Open visit form, text typed, **reload** within 400ms of the last key | **FAIL** — text lost (the 400ms debounce's `pagehide` flush doesn't finish before the reload) |
| Open visit form, text typed, **force-close** mid-entry | **FAIL** — text lost |
| Open visit form, typing paused ≥ 400ms, then force-close | pass |
| New OB question typed but not submitted, reload | **FAIL** — lost; the input has no draft |
| Checklist tick, force-close 150ms later | pass |

## 4. Date stamps at 20:00, 23:59 and 00:01 America/Phoenix

Sun Oct 4 → Mon Oct 5, 2026 (8w6d → 9w0d); 20:00 Phoenix is already Oct 5 in UTC. Run with the
browser in America/Phoenix, UTC and Asia/Tokyo.

| Phoenix time | Week pill | Mini counter | Growing card / This Week | Symptom `day` | Visit `date` | Result |
|---|---|---|---|---|---|---|
| Oct 4 20:00 | 8w 6d | 8w 6d | week 8 / week 8 | 2026-10-04 | 2026-10-04 | pass |
| Oct 4 23:59 | 8w 6d | 8w 6d | week 8 / week 8 | 2026-10-04 | 2026-10-04 | pass |
| Oct 5 00:01 | 9w 0d | 9w 0d | week 9 / week 9 | 2026-10-05 | 2026-10-05 | pass |

Identical in all three browser time zones. The growing card and the pill agree at every point.
The stamped `gest` on the symptom and the visit matches the pill.

## 5. Two-context sync

**Not measured.** The household code lives only in the Firestore rules and on the two phones, and the
rules deny any other path, so an automated two-context check can't run without the real code. Filed as
a task (a way to run READ FIRST → UI QUALITY 8 without the real household).

## 6. Airplane mode

Service worker installed online, then offline with a full reload of every route: **all render fully
from cache**, Fraunces included — Today, Timeline, Lists (index, Budget, Decisions, Go Bag), Visits,
Symptom log, Questions, Notes, Resources, Wombkeepers, First Call, Settings.

## 7. Motion that ignores `prefers-reduced-motion`

The reduced-motion block covers only `html{scroll-behavior}` and `.page{animation}`. Not covered:

- `.sync-dot[data-state="connecting"]` — `pulse` 1.2s infinite
- `.bar i` — `transition: width .25s` (also animates width, not transform/opacity)
- `.chk .box` — `transition: background .12s` (animates background)
- `details.sec-grp summary .grp::before`, `details.info summary i`, `details.q-fold summary .q-text::after` — chevron `transform .15s`
- `.er-pin` — `transition: opacity .2s, transform .2s`
- JS: `window.scrollTo({ behavior: 'smooth' })` in `js/app.js:74` and `js/views.js:813`, `scrollIntoView({ behavior: 'smooth' })` in `js/views.js:772`
