# Baby Hightower

A private, installable PWA for Q & Staci to run the pregnancy together.
Due **May 11, 2027** · LMP Aug 3, 2026 · all dates America/Phoenix.

Vanilla JS, no build step, one static folder. Everything is stored on the phone
(IndexedDB) and works fully offline; if a `firebase-config.js` is present the
two phones sync in real time through Firestore.

Five tabs: **Today** (live week counter, countdown, next three events, baby-development
note) · **Timeline** (the v1 trimester timeline; every event opens its guide,
checklist, completion toggle and notes) · **Lists** (Go Bag, Purchases, Legal,
Nursery Build, First 30 Days, Classes) · **Notes** · **OB Questions** (to ask →
asked → answered, built for the waiting room).

---

## 1. Run it locally

```bash
cd "baby-hightower"
npx serve -l 5173 .
```

Open <http://localhost:5173>. Pick "I'm Q" / "I'm Staci", type any household
code (4+ characters), and you're in. Without Firebase it says **Not syncing** —
that's expected and everything still works.

Tests (week math against LMP / due date):

```bash
npm test
```

Regenerate the seed data from the v1 HTML, or the icons:

```bash
npm run seed
```

```bash
npm run icons
```

### Layout

| Path | What |
|---|---|
| `index.html`, `css/app.css` | Shell + the v1 visual design (cream/sage/blush/sand, Fraunces) |
| `js/config.js` | **LMP, due date, timezone, version** — the only constants |
| `js/dates.js` · `tests/dates.test.js` | Week/countdown math (pure functions) + tests |
| `js/db.js` · `js/store.js` | IndexedDB wrapper · in-memory state, write-through, last-write-wins |
| `js/sync.js` | Optional Firestore mirror, only activates when `firebase-config.js` exists |
| `js/views.js` · `js/app.js` | The five tabs, detail pages, settings · router, identity, SW update flow |
| `data/seed.json` | All events, guide sections and checklist items extracted verbatim from v1 |
| `tools/extract-seed.mjs` · `tools/make-icons.mjs` | Seed extractor · dependency-free icon generator |
| `sw.js` · `manifest.webmanifest` · `icons/` | PWA bits |
| `firestore.rules` · `firebase-config.example.js` | Sync setup templates |

Data model: one IndexedDB store of documents shaped `{ id: "coll/key", coll, key,
updatedAt, updatedBy, ...fields }` across four collections — `events` (per-event
done/notes), `items` (checklist checks, edits, custom items), `notes`, `questions`.
Deletes are soft (`deleted: true`) so they replicate. Firestore holds the same
docs at `households/<code>/<coll>/<key>`; the newer `updatedAt` wins.

---

## 2. Turn on sync (Firebase, free tier)

Takes about ten minutes. You need a Google account.

### Create the project

1. Go to <https://console.firebase.google.com> → **Create a project** (or "Add project").
2. Name it `baby-hightower` → **Continue**.
3. Google Analytics: toggle **off** → **Create project** → wait → **Continue**.

### Create the database

4. Left sidebar → **Build** → **Firestore Database** → **Create database**.
5. Location: pick `us-west1` or `us-central1` (any is fine) → **Next**.
6. Choose **Start in production mode** → **Create**. (We'll paste our own rules next.)

### Lock it to your household code

7. Firestore → **Rules** tab. Delete everything in the editor and paste the
   contents of [`firestore.rules`](firestore.rules).
8. Replace `CHANGE-ME-household-code` with the exact code you'll type into the
   app (case-sensitive; make it long — it's the password). Example:
   `hightower-may11-sedona-2027`.
9. **Publish**.

   What this does: reads and writes are allowed *only* under
   `households/<your code>/…`. Every other path is denied, and no document may
   carry more than 40 fields. Anyone who knows the code can read/write your
   data, so don't reuse a guessable word.

### Register the web app and get the config

10. Click the **gear** next to "Project Overview" → **Project settings**.
11. Scroll to **Your apps** → click the **`</>`** (Web) icon.
12. Nickname `baby-hightower-web`. Leave "Firebase Hosting" unchecked → **Register app**.
13. Under "Add Firebase SDK", choose **Use npm** or **CDN** — either way, copy
    just the `firebaseConfig = { ... }` object → **Continue to console**.
14. In this folder: copy `firebase-config.example.js` to `firebase-config.js`
    and paste your values in. It's gitignored; never commit it.

    ```bash
    cp firebase-config.example.js firebase-config.js
    ```

15. Reload the app. The dot in the header turns **green** and Settings shows
    "Syncing". If it turns red with "Sync blocked", the household code in the
    app doesn't match the one in the rules.

### Authorized domains (only if you deploy)

16. Firestore doesn't need domain allow-listing for this setup. If you later
    add Firebase Auth, add your GitHub Pages domain under **Authentication →
    Settings → Authorized domains**.

### Optional hardening

The API key in `firebase-config.js` is not a secret (it only identifies the
project); the household code in the rules is what gates access. If you want a
second lock, enable **Authentication → Sign-in method → Anonymous**, add
`request.auth != null &&` to the rule, and call `signInAnonymously()` in
`js/sync.js` before the listeners start.

---

## 3. Deploy to GitHub Pages

Repo will live at `github.com/pokerbrainupgrade-a11y/baby-hightower`; the app
will be at `https://pokerbrainupgrade-a11y.github.io/baby-hightower/`.
All paths in the app are relative, so it works from that sub-path as-is.

1. On GitHub: **New repository** → name `baby-hightower` → **Private** → don't
   add a README (we have one) → **Create repository**.
2. Push:

   ```bash
   git remote add origin git@github.com:pokerbrainupgrade-a11y/baby-hightower.git
   ```

   ```bash
   git push -u origin main
   ```

3. Repo → **Settings** → **Pages** → Source: **Deploy from a branch** → Branch:
   `main`, folder `/ (root)` → **Save**. First deploy takes ~1 minute.

4. **The config file.** `firebase-config.js` is gitignored, so Pages won't have
   it and the deployed app will run local-only. Two options:

   * **Simplest (recommended for a private repo):** remove `firebase-config.js`
     from `.gitignore` and commit it. The Firebase API key isn't a secret; the
     rules do the gating. Since the repo is private, nobody else sees it anyway.
   * **Keep it out of git:** create a GitHub Actions workflow that writes the
     file from a repository secret at deploy time. Ask and I'll add it.

5. Every deploy that changes app files: bump `VERSION` in `sw.js` and
   `APP_VERSION` in `js/config.js`, commit, push. Installed phones show an
   **"Update ready → Reload"** toast the next time they open the app.

GitHub Pages private-repo note: Pages on a private repo requires GitHub Pro or
an organization plan; on a free personal account the repo must be public for
Pages to serve. If that's the case, keep `firebase-config.js` committed only if
you're comfortable with the API key being visible (it's standard practice for
Firebase web apps — the rules are the security boundary), or use the Actions
secret approach.

---

## 4. Add to Home Screen

Do this on **both phones**, then type the **same household code** in each.

**iPhone (Safari — must be Safari, not Chrome):**
1. Open the app URL in Safari.
2. Tap the **Share** button (square with arrow, bottom centre).
3. Scroll the sheet → **Add to Home Screen** → **Add**.
4. Open "Baby H" from the home screen. It runs full-screen with no browser
   chrome. Pick who you are and type the household code.

**Android (Chrome):**
1. Open the app URL in Chrome.
2. Tap **⋮** (top right) → **Install app** (or "Add to Home screen") → **Install**.
3. Open it from the launcher / app drawer.

To confirm it's installed: Settings (gear, top right) → "Installed: Home screen app".

---

## 5. Backups

Settings → **Export everything as JSON**. On iPhone this opens the share sheet
(save to Files, AirDrop to the Mac, etc.); elsewhere it downloads a file. The
export contains every check, note, question and event state. The seed content
(timeline, guide, list items) lives in the app itself.

---

## 6. Things to know

* **Week math.** Weeks count from LMP (Aug 3), exactly as v1 did: the due date
  is 40w1d and every "WEEK N" Tuesday on the timeline is Nw1d. The countdown
  counts to May 11. One nuance: by strict counting the third trimester (28w0d)
  begins Mon Feb 15, one day before v1's "Feb 16" line — the app follows the
  math, the timeline text is verbatim. If the dating ultrasound moves the due
  date, change `LMP`/`DUE` in `js/config.js` and re-run `npm test`.
* **Two phones, one item, both offline.** Last write wins per document when
  they reconnect. Nothing merges character-by-character — that's by design.
* **Identity** is per phone (Settings → Switch) and stamped on every write.
* **Offline.** The service worker precaches the whole app; the Firebase SDK is
  cached after first load. Writes made offline go to IndexedDB immediately and
  push when the network is back (Firestore's own offline queue handles the
  in-flight ones).
* **Seed edits.** Change text in v1 → `npm run seed` → commit. Item ids are
  positional (`gobag-3`), so inserting an item mid-list shifts ids after it
  (checks on those would move); append instead.
