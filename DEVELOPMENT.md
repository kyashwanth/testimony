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
| `popup.html/js/css` | Toolbar popup: site access, start/stop, options, allowed sites |
| `editor.html/js/css` | Full-page editor: notes, Pass/Fail, annotation, History, PDF export |
| `annotate.js` | Canvas drawing shared by the editor preview, annotator and PDF |
| `pdf.js` | Dependency-free PDF writer (Helvetica text, JPEG screenshots) |
| `db.js` | IndexedDB storage: current session, metadata, session history |
| `sites.js` | Pure helpers for validating and describing site match patterns |
| `test/` | Node tests and browser harnesses |
| `store-assets/` | Chrome Web Store graphics and the pages that generate them |
| `docs/` | The website served by GitHub Pages: landing page and privacy policy |
| `build.sh` | Runs all tests and writes the store zip |
| `STORE-LISTING.md` | Copy and justifications for the Chrome Web Store form |
| `PRIVACY.md` | Privacy policy (also the text to host for the store listing) |

## Tests

All tests are plain Node scripts, run from this folder, and need no install step.

```
node test/sites.test.mjs        # site pattern validation (rejects "*" and "*.com")
node test/background.test.mjs   # service worker: start/stop, grants, shortcuts, state reset
node test/tabs.test.mjs         # tab scope, tab numbering, "!" badge detection
node test/capture.test.mjs      # capture delay, event kinds, duplicates, final screenshot
node test/history.test.mjs      # session archive, restore, 5-session limit
node test/pdf.test.mjs          # PDF structure and tab labels
```

The service worker tests run `background.js` against fakes of `chrome.*` and IndexedDB in
`test/fakes.mjs`. They wait on conditions instead of fixed delays, because several features are timing-based.
If you add one, avoid fixed `sleep`s that race the capture queue.

`./build.sh` runs all of the above and then packages the extension.

**Browser harnesses** (serve this folder over HTTP, for example `python3 -m http.server`, then open the page):

- `test/popup-harness.html` loads the real popup against a mocked `chrome` API. Add `?tab=<url>` to choose the
  tab URL. The mock is exposed as `window.__mock`.
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
`content.js` reports each action to the service worker, which queues it. Clicks and Enter wait
`captureDelayMs` (default 700 ms) so the page can react. Typing and dropdown changes are captured at once.
Captures are spaced by at least 550 ms because `captureVisibleTab` is rate limited. Events are queued
synchronously, so a Stop right after a click cannot overtake it. A delayed capture drops its click marker if the
tab navigated in the meantime. Identical steps within 600 ms are treated as a double-click.

Typing is recorded when a field is committed (`change` or Enter), never per keystroke, and the value is never
read. Clicks into text fields and selects are ignored, because their own events produce the step.

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
built-in Helvetica fonts in WinAnsi encoding, which is why non-Latin characters become `?`.

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

## Releasing

1. Bump `version` in `manifest.json`. The store rejects a package whose version is not higher.
2. Run `./build.sh` and confirm every suite passes.
3. Do the manual check below in a real Chrome profile.
4. Upload `dist/testimony-<version>.zip` in the Chrome Web Store Developer Dashboard.
5. Update the listing text from [`STORE-LISTING.md`](STORE-LISTING.md) if features or permissions changed, and
   make sure the privacy declarations still match the code.

### Manual check before every release
The automated tests use fakes, so these need a real browser:

- [ ] Load unpacked, press **Allow site & start recording**, and confirm the permission prompt appears and
      recording starts afterwards (the popup may close on the prompt).
- [ ] Click through a flow on an allowed site. Steps appear with the right titles and markers.
- [ ] Open a link in a new tab. It becomes "Tab 2", and the badge shows `!` on a site that is not allowed.
- [ ] Type in a field, press Enter, pick a dropdown option. One step each, and the typed text is not recorded.
- [ ] Press Stop. A "Final state" step is added and the editor opens.
- [ ] **New session** saves to History. **Restore** and the history **PDF** work.
- [ ] Remove a site under **Allowed sites** while recording. The recorder stops on that site.
- [ ] Download a PDF and check the annotations, redactions and Pass/Fail markers.
- [ ] Reload the extension mid-recording. State resets cleanly.

## Privacy rules for contributors

Keep these true, because the privacy policy and store declarations depend on them:

- No network requests and no remote code (no `eval`, no external scripts).
- Never read or store the text a user types or the values of fields.
- Request host access only for sites the user chose, and only record while recording is on.
- Use only generic demo data in tests, docs and graphics. Do not commit real URLs, tickets, names or screenshots.
