# Developing Testimony

Notes for people who build, test or publish the extension. For end-user documentation see the
[README](README.md).

Testimony is a Manifest V3 Chrome extension with **no runtime dependencies and no build step**: the files in
this folder are what Chrome loads. It needs Chrome 102 or later (`minimum_chrome_version`).

## Run it locally

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select this folder.
3. Pin the extension. After editing code, press the reload icon on its card in `chrome://extensions`.

Debugging: the service worker has its own DevTools console (the **service worker** link on the extension card).
The popup and editor are ordinary pages, so right-click > Inspect works. The recorder (`content.js`) logs to
the console of the page being tested.

## Repository layout

| Path | Purpose |
|---|---|
| `manifest.json` | Permissions, shortcuts, popup. No install-time host access (see below) |
| `background.js` | Service worker: recording state, screenshots, recording scope, badge |
| `content.js` | Recorder injected into allowed sites: clicks, typing, Enter, dropdowns |
| `modes.js` | The two modes (guide / test run): mode helpers, step numbering, file names. Pure functions |
| `placeholder.js` | The grey image used when a screenshot cannot be taken |
| `popup.html/js/css` | Toolbar popup: site access, start/stop, options, allowed sites |
| `editor.html/js/css` | Full-page editor: notes, Pass/Fail, annotation, History, PDF export |
| `annotate.js` | Canvas drawing shared by the editor preview, annotator and PDF, and the zoom crop |
| `pdf.js` | Dependency-free PDF writer: the evidence report and the guide layouts |
| `html.js` | Builds the self-contained HTML export of a session (guide or evidence report) |
| `markdown.js` | Builds the Markdown export and lists the screenshots it refers to (`images/step-01.jpg`...) |
| `csv.js` | Builds the CSV export (one row per step) |
| `zip.js` | Dependency-free ZIP writer (stored, UTF-8 names, path-checked) used to package Markdown plus images |
| `db.js` | IndexedDB storage: current session, metadata, session history |
| `sites.js` | Pure helpers for validating and describing site match patterns |
| `test/` | Node tests and browser harnesses |
| `store-assets/` | Chrome Web Store graphics and the pages that generate them |
| `docs/` | The website served by GitHub Pages: landing page and privacy policy |
| `.github/workflows/` | CI (tests and package build) and the tag-triggered release |
| `build.sh` | Runs all tests and writes the store zip |
| `PRIVACY.md` | Privacy policy (also the text to host for the store listing) |

## Tests

All tests are plain Node scripts, run from this folder, and need no install step.

```
node test/sites.test.mjs        # site pattern validation (rejects "*" and "*.com")
node test/background.test.mjs   # service worker: start/stop, grants, shortcuts, state reset
node test/tabs.test.mjs         # tab scope, tab numbering, "!" badge detection
node test/capture.test.mjs      # capture delay, event kinds, duplicates, final screenshot
node test/history.test.mjs      # session archive, restore, 5-session limit
node test/fastclicks.test.mjs   # bursts of fast actions: nothing lost, in order, within Chrome's screenshot quota
node test/recorder.test.mjs     # the real content.js in a sandbox: link detection, early screenshots, double-clicks
node test/navclicks.test.mjs    # link clicks on the service-worker side: early screenshots, page-changed label
node test/modes.test.mjs        # mode helpers, zoom crop, guide and evidence PDFs
node test/html.test.mjs         # HTML export: escaping, self-contained, byte-identical images, both modes
node test/zip.test.mjs          # ZIP writer, checked against the real unzip and Python's zipfile
node test/markdown.test.mjs     # Markdown export: hostile text stays inert, structure, image package
node test/csv.test.mjs          # CSV export: RFC 4180 quoting, formula injection, columns, both modes
node test/pdf.test.mjs          # PDF structure and tab labels
```

The service worker tests run `background.js` against fakes of `chrome.*` and IndexedDB in
`test/fakes.mjs`. They wait on conditions instead of fixed delays, because several features are timing-based.
If you add one, avoid fixed `sleep`s that race the capture queue.

`./build.sh` runs all of the above and then packages the extension.

**Browser harnesses** (serve this folder over HTTP, for example `python3 -m http.server`, then open the page):

- `test/popup-harness.html` loads the real popup against a mocked `chrome` API. Add `?tab=<url>` to choose the
  tab URL. The mock is exposed as `window.__mock`.
- `test/recorder-harness.html` loads the real `content.js` against a mocked `chrome` API on a page with awkward
  buttons (same-named buttons in a list, a button that removes itself on mouse-down, a page that stops click
  propagation). Add `?startupDelay=2500` to simulate slow start-up. Use it with real (trusted) clicks: the
  recorder ignores synthetic events by design.
- `test/legacy-db.html` builds a version-1 database and then opens the editor, to check the storage upgrade.
- `editor.html` works without the extension APIs, so it can be opened over HTTP and seeded through `db.js`.

Always serve with caching disabled while testing, or the browser may run stale scripts.

## Building the store package

```
./build.sh
```

This runs the tests, then writes `dist/testimony-<version>.zip` containing only the runtime files with
`manifest.json` at the zip root. If you add a runtime file, **add it to the `zip` line in `build.sh`**, or it
will be missing from the package. `dist/` is git-ignored.

## How it works

### Site access (why there is no `<all_urls>`)
The manifest declares `optional_host_permissions` for `http://*/*` and `https://*/*` and nothing at install.
The popup calls `chrome.permissions.request` for a single host pattern, and only from a click (a Chrome
requirement). While recording, `background.js` registers `content.js` with `chrome.scripting.registerContentScripts`
for exactly the granted origins, injects it into matching tabs that are already open, and unregisters it when
recording stops. `activeTab` covers manual screenshots on any tab without a prompt.

`sites.js` normalises what a user types into `scheme://host/*` and rejects patterns that would widen access
to every site.

The permission prompt can close the popup before its promise resolves, so the popup writes a short-lived
`pendingStart` marker and the service worker finishes starting the recording when `permissions.onAdded` fires.
Starting from a keyboard shortcut cannot prompt, so it requires a site to be allowed already.

### Capture pipeline
`content.js` reports each action to the service worker, which queues it. Design goals: **never lose an action**, keep
order, and respect Chrome's screenshot quota.

- **Recorder (`content.js`)** is injected at `document_start` and listens on `window` in the capture phase, so it
  is ready before the page's own scripts and cannot be pre-empted by a page that stops propagation. Actions in the
  first milliseconds wait for the recording flag instead of being dropped.
- **Clicks that never arrive.** Pages that act on mouse-down and remove the element send no usable `click`. Every
  press is therefore remembered; if no click follows within 350 ms and the pressed element has left the DOM, the
  press is reported as the click it was. If a click arrives on something else, the press is described instead.
- **Double-click vs quick repeats.** Only a true double-click (`detail > 1`, same spot, within 300 ms) collapses
  into one step. Two deliberate clicks on the same control are two steps. The service worker does no
  title-based de-duplication.
- **Links change the page.** A screenshot taken after the usual delay would show the *next* page, with no way to place
  the click marker. The recorder therefore treats a click on a link with a real destination (not `#...`, `javascript:`,
  `mailto:`, a download, or a menu toggle) specially: at the mouse *press* it asks the worker for an early
  screenshot (`pre-shot` message), and the click that follows carries `nav: true` and the press id (`pre`) and uses that
  picture, marker included, with no delay. A press that never becomes a click is discarded after 8 s. Taking the picture
  at the press rather than the click gives it the 80 to 150 ms the button is held down as a head start on pages that
  navigate instantly. If a page still changes during a normal delayed capture, the step carries a "Page changed after
  this click" label instead of a misleading marker or silence.
- **Delivery.** Messages carry an id and are retried twice, so a lost message is re-sent and a re-sent one is
  recorded once.
- **Pacing (`background.js`).** Clicks and Enter wait `captureDelayMs` (default 700 ms) so the page can react,
  but a step is photographed *before the user's next action* (100 ms ahead of it) when one has already arrived,
  so a fast sequence does not get the later steps' results. Typing and dropdown changes are captured at once.
- **Quota.** `captureVisibleTab` allows 2 calls per second. The worker allows a burst of 2 per 1.1 s window and
  waits for the next slot, so a burst is served as fast as Chrome permits without errors.
- **Failures.** A failed screenshot is retried (3 attempts). If it still fails, the step is saved with the grey
  `placeholder.js` image, `captureFailed: true`, and a note drawn on it, rather than being lost.
- A Stop right after a click cannot overtake it (events are queued synchronously), and a delayed capture drops its
  click marker if the tab navigated in the meantime.

Typing is recorded when a field is committed (`change` or Enter), never per keystroke, and the value is never
read. Clicks into text fields and selects are ignored, because their own events produce the step.

### Modes
A session is a *guide* or a *test run*: `meta.mode` is `'guide'` or absent/`'test'` (so existing sessions are test
runs). The mode only affects presentation and export; data is never converted or deleted when it changes.

| Concern | Where |
|---|---|
| Mode helpers, numbering that skips headings and text steps, file names, history labels | `modes.js` |
| Mode switch, fields, step cards | `popup.js`, `editor.html/js/css` (body class `mode-guide` / `mode-test` and `data-only` attributes) |
| Final screenshot default (on for tests, off for guides; separate settings `finalShot` / `finalShotGuide`) | `background.js` |
| Layout of the document | `pdf.js` picks the guide or evidence layout from `meta.mode` |

Step fields added for the modes: `expected`, `actual` (test runs), `callout` (`tip` / `warning` / `note`) and
`zoom` (guides). Steps with `kind: 'heading'` or `'text'` have no image (`image: null`) and are not numbered. Guide
fields in `meta`: `guideTitle`, `summary`, `prereq`, `author`, `version`, `date`. There is no database schema change.

### Recording scope
`chrome.storage.session` holds the scope: the window recording started in, plus tabs opened from members
(`openerTabId`), with a stable number per tab. After tab events the worker pings the active tab. If the recorder
does not answer, the badge shows `!`.

### Storage
IndexedDB database `uat-capture` (the name predates the product name and is kept so existing data survives).

| Version | Stores |
|---|---|
| 1 | `steps`, `meta` |
| 2 | adds `sessions` (archived sessions, newest 5 kept) |

Screenshots are stored as Blobs. If you change a schema, bump `DB_VERSION` in `db.js`, make the upgrade
additive, and test the old shape with `test/legacy-db.html`.

### PDF
`pdf.js` writes the file directly. Screenshots are embedded as JPEG without re-compression, text uses the
built-in Helvetica fonts in WinAnsi encoding, which is why non-Latin characters become `?`. The editor renders each
step to a canvas first (with annotations, and the zoom crop for guides) and hands `pdf.js` plain data, so the writer
itself has no DOM dependency and is unit tested in Node.

### HTML export
`html.js` turns the same prepared data as the PDF into one HTML file (`editor.js` `prepareSteps` renders the
screenshots once for both). Rules it keeps, all covered by `test/html.test.mjs`:
- **Everything typed is escaped**, in every field including meta, URLs and image `alt` text. Tests feed hostile
  strings through each field and check that every `<img>` is exactly the shape the builder emits.
- **Self-contained and inert:** screenshots are `data:` URIs, styles are inline, there is no script, link, iframe or
  external URL, and a `Content-Security-Policy` meta tag (`default-src 'none'; img-src data:`) backs that up.
- **Images are byte-identical** to what was rendered, so a recipient can extract them.
- It has print, dark and small-screen styles, and a contents list for guides with two or more headings.

### Markdown, CSV and ZIP exports
Every export starts from the editor's `prepareSteps` (images) or the raw steps (CSV needs none). The editor's
`FORMATS` table (`pdf`, `html`, `md`, `csv`) is the one list of formats: it fills the picker beside the Download button,
labels the button, and fills the Export dropdown on each History row. Rendered screenshots are cached for the live
session (keyed by step, annotations, zoom, width and quality), so exporting a second format is quick; editing
anything a picture depends on makes a new entry. Rules each builder keeps, covered by its tests:
- **Markdown** escapes everything a person typed (`\ ` * _ [ ] |` backslash-escaped, `& < >` as entities), plus characters
  that only matter at the start of a line (`#`, `1.`, `-`, `---`), so user text cannot become a heading, link, image or
  HTML in whatever renders it. URLs go in code spans with `<` and `>` percent-encoded. Line breaks are kept.
- **CSV** follows RFC 4180 (CRLF, quoted cells), starts with a UTF-8 byte-order mark so Excel reads other scripts, and
  prefixes cells that start with `= + - @`, tab or carriage return with an apostrophe (formula injection).
- **ZIP** stores entries uncompressed (the screenshots are already JPEG) with UTF-8 names. It refuses unsafe names
  (`..`, absolute paths, backslashes, duplicates), which would let an unpacked archive write outside its folder. The
  Markdown and its images sit in one top-level folder so unzipping never spills files into the current directory.
- The screenshot file names (`step-01.jpg`, zero-padded to the step count) come from `imageName` in `modes.js`, so the
  Markdown, the images in the ZIP and the CSV's `Screenshot` column always agree.

## Store assets

`store-assets/` holds the images uploaded to the Web Store (1280x800 screenshots, a 440x280 tile, a 1400x560
marquee) and the pages that make them:

- `seed.html` fills the extension's database with a generic demo session ("Acme Orders", `example.com`) and
  then opens the editor. Use it to photograph the editor and annotator.
- `popups.html`, `pdf.html`, `promo.html`, `marquee.html` are composed pages for the other images.

Serve this folder over HTTP, render each page at the exact target size in a light-mode browser window, and
export as JPEG or 24-bit PNG without alpha (the store rejects transparency). Use only demo data in graphics.

## Website

`docs/` is a static site with no build step, scripts, trackers or third-party fonts. Files: `index.html` (product
page), `privacy.html` (privacy policy), `styles.css`, `assets/` (copies of the store graphics and icons).

- **Publish it:** in the GitHub repo go to Settings > Pages, set Source to *Deploy from a branch*, branch `main`,
  folder `/docs`. It is then served at https://kyashwanth.github.io/testimony/. A private repo needs a paid
  GitHub plan for Pages, so make the repo public first on a free plan.
- **Preview locally:** `cd docs && python3 -m http.server`, then open http://localhost:8000.
- **Keep the policy in sync:** `PRIVACY.md` and `docs/privacy.html` carry the same text. Edit both, and update the
  "Last updated" date.
- **When the extension is published:** in `docs/index.html` replace the "Coming soon to the Chrome Web Store"
  badge with a link to the listing, and update the install line in `README.md`.
- **Canonical and social URLs** in the page `<head>` assume the address above. Change them if you add a custom domain.

## Automation (GitHub Actions)

Two workflows in `.github/workflows/` build and publish everything on GitHub, so the package that reaches the
store is always built from a known commit after the tests pass.

| Workflow | Runs when | What it does |
|---|---|---|
| `ci.yml` | every push to `main` and every pull request | Checks nothing sensitive is tracked, runs `./build.sh` (all tests, then the zip), checks the zip contains only runtime files, and attaches it to the run as the `testimony-extension` artifact (30 days) |
| `release.yml` | a tag like `v2.0.1` is pushed | Checks the tag matches `manifest.json` and the commit is on `main`, runs `./build.sh`, writes a SHA-256 checksum, and publishes a GitHub Release with the zip and checksum attached |

Notes:
- Neither workflow uses secrets. CI has read-only access; only the release job can write, and only to releases.
- This repo has **release immutability** on: once a release is published, its tag and files cannot be changed. The
  workflow therefore creates a draft, attaches the files and only then publishes. If a run fails part-way, delete the
  draft release and the tag on GitHub, fix the problem, and tag again.
- The actions used are GitHub's own (`checkout`, `setup-node`, `upload-artifact`) at major-version tags, on versions
  that run on Node 24. GitHub is retiring Node 20 for actions, so when a similar warning appears in a run, look up
  each action's `runs.using` in its `action.yml` and move to a newer major.
- The guard step in `ci.yml` looks for key files and credential patterns. It is a safety net, not a replacement
  for reviewing what you commit.

## Releasing

1. Bump `version` in `manifest.json` (the store rejects a version that is not higher), commit and push to `main`.
2. Wait for the **CI** run on that commit to pass.
3. Do the manual check below in a real Chrome profile.
4. Tag and push: `git tag v<version> && git push origin v<version>`. The **Release** workflow publishes
   `testimony-<version>.zip` at https://github.com/kyashwanth/testimony/releases.
5. Download that zip from the release and upload **that exact file** in the Chrome Web Store Developer Dashboard.
6. Update the Chrome Web Store listing text if features or permissions changed, and make sure the privacy
   declarations still match the code.

You can still build locally with `./build.sh`, for quick testing.

### Manual check before every release
The automated tests use fakes, so these need a real browser:

- [ ] Load unpacked, press **Allow site & start recording**, and confirm the permission prompt appears and
      recording starts afterwards (the popup may close on the prompt).
- [ ] Click through a flow on an allowed site. Steps appear with the right titles and markers.
- [ ] Open a link in a new tab. It becomes "Tab 2", and the badge shows `!` on a site that is not allowed.
- [ ] Type in a field, press Enter, pick a dropdown option. One step each, and the typed text is not recorded.
- [ ] Press Stop in a **test run**: a "Final state" step is added and the editor opens. In a **guide** none is added
      by default.
- [ ] Click quickly, one after another, through a list of buttons with the same name. Every click is a step, in
      order. A double-click is one step.
- [ ] Use a page where a button disappears on mouse-down, and click a link straight after a page loads. Both are
      recorded.
- [ ] Switch between **Guide** and **Test run** in the popup and in the editor. Fields and the PDF layout change,
      and no data is lost when you switch back.
- [ ] In a guide, add a heading and a text paragraph, set a tip and a warning, turn on zoom, and export. The
      PDF has numbered steps, callouts and no Pass/Fail.
- [ ] **New session** saves to History. **Restore** and the history **PDF** work.
- [ ] Remove a site under **Allowed sites** while recording. The recorder stops on that site.
- [ ] Download a PDF and check the annotations, redactions and Pass/Fail markers.
- [ ] Download the HTML in both modes and open it in a browser: images show, nothing is requested from a server, and
      it prints cleanly.
- [ ] Download Markdown + images, unzip it, and open the `.md` in a Markdown viewer: every image shows. Download the CSV
      and open it in Excel or Numbers: columns line up and accented text is intact.
- [ ] Reload the extension mid-recording. State resets cleanly.

## Privacy rules for contributors

Keep these true, because the privacy policy and store declarations depend on them:

- No network requests and no remote code (no `eval`, no external scripts).
- Never read or store the text a user types or the values of fields.
- Request host access only for sites the user chose, and only record while recording is on.
- Use only generic demo data in tests, docs and graphics. Do not commit real URLs, tickets, names or screenshots.
