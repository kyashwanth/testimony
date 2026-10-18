# Chrome Web Store listing (copy/paste)

> Maintainer reference for filling in the Chrome Web Store form. Not user documentation: see
> [README.md](README.md) for users and [DEVELOPMENT.md](DEVELOPMENT.md) for developers.

Upload `dist/testimony-2.0.0.zip` (run `./build.sh`). Bump `version` in manifest.json for each re-upload.

## Name
Testimony: Pics or It Didn't Happen

## Summary (max 132 chars)
Record UAT steps with screenshots, annotate them, add notes and download a PDF as proof of testing.

## Category
Developer Tools

## Detailed description
Testimony turns a manual test session into evidence you can attach to a ticket.

- Press Start recording and test as normal. Every click, typed field and dropdown choice on a site you allowed becomes a step with a screenshot. Screenshots are taken just after the action, so success messages and new rows are in the shot, and a final screenshot is added when you stop.
- Follows new tabs and windows opened from the page you are testing, and labels each step with its tab.
- Warns you when the tab you are on is not being recorded, so there are no silent gaps.
- Capture a screenshot of any tab at any time with Alt+Shift+S, or paste/drop images into the editor.
- Review in the built-in editor: edit step titles, add notes, mark steps Pass or Fail, reorder or delete steps.
- Annotate with boxes, arrows, circles, highlights, text labels and redaction.
- Starting a new session saves the old one to History, which keeps your last 5 sessions to restore or export.
- Download a clean PDF with ticket, environment, tester, date, overall result, and every step with its screenshot and notes.

Privacy first: the extension asks for access one site at a time, only when you start recording there. Everything stays on your computer. No account, no servers, no tracking.

## Single purpose
Record manual test steps as annotated screenshots and export them as a PDF report.

## Permission justifications
- **activeTab**: Lets the toolbar button and the capture shortcut take a screenshot of the tab the user is on, on any site, without a broad permission.
- **optional_host_permissions (http/https)**: Requested at runtime, one site at a time, when the user presses "Allow site & start recording". Needed so the recorder can observe clicks on the site under test and capture that tab while the user navigates between its pages. Nothing is granted at install.
- **scripting**: Registers the click recorder only for the sites the user allowed, only while recording, and injects it into already-open tabs of those sites.
- **storage**: Stores the recording on/off flag, the user's two capture options, and which tabs belong to the current recording.
- **unlimitedStorage**: Screenshots are saved locally in IndexedDB; a long session can exceed the default quota.
- **Recorder script behaviour**: Sends only a short element label (for example "Typed in the 'Email' field" or "Click the 'Save' button"), the label of the option chosen in a dropdown, the page URL and the position of the element to the extension. The text a user types and the values of fields are never read.

## Privacy practices tab (Developer Dashboard)
Nothing leaves the device, but declare conservatively, because the extension does handle this data locally:
- Data types to tick: **Website content** (screenshots, element labels), **Web history** (page URLs on steps),
  **User activity** (clicks, typing events as step titles; typed text itself is never read).
- Tick all three certifications (not sold, not used for unrelated purposes, not used for creditworthiness).
- Remote code: **No**. Single purpose: paste the statement above.

## Data usage disclosures
- Does not collect, sell or transmit user data. Screenshots, notes and details stay in local browser storage.
- No remote code, no analytics, no network requests.
- Certify: not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

## Privacy policy
The store asks for a URL. Suggested text to host publicly (e.g. GitHub Pages):

> Testimony does not collect, store on any server, share or sell any personal data. Screenshots, notes and
> session details are saved only in your browser's local storage on your device and are deleted when you
> choose "New session" or remove the extension. The extension makes no network requests.

## Assets (generated, in `store-assets/`, not shipped in the zip)
Upload in this order under Store listing > Graphic assets:
1. `screenshot-1-editor-overview.jpg`  (1280x800)
2. `screenshot-2-annotate.jpg`  (1280x800)
3. `screenshot-3-allow-one-site.jpg`  (1280x800)
4. `screenshot-4-pdf-report.jpg`  (1280x800)
5. Small promo tile: `promo-tile-440x280.jpg`  (440x280)
- Store icon 128x128: taken from the package (`icons/icon128.png`).
- All screenshots use generic demo data ("Acme Orders", example.com). Regenerate with `store-assets/seed.html`
  (seeds a demo session) if the UI changes.
- Still optional: marquee promo 1400x560 and a YouTube demo link.

## Distribution: org first, public later
Same package, different visibility (Developer Dashboard → Distribution):
1. **Private / your organisation only.** Publish restricted to your Google Workspace domain (or a trusted-testers
   group). Only your people can install it and review is usually lighter.
2. **Roll out to everyone in the org.** Force-install it through your admin tooling (Google Admin console
   "Apps & extensions", or the `ExtensionInstallForcelist` policy via Intune/Group Policy) using the extension ID.
3. **Go public later** by switching visibility to Public. No repackaging needed. The optional-permission model
   means no "all websites" warning at install, which is what public review looks at most closely.
4. Users still see one prompt per site the first time they record there. That is by design; Chrome does not let an
   extension grant itself optional permissions silently.
