# Testimony

*Pics or It Didn't Happen.*

[![CI](https://github.com/kyashwanth/testimony/actions/workflows/ci.yml/badge.svg)](https://github.com/kyashwanth/testimony/actions/workflows/ci.yml)

**Website:** https://kyashwanth.github.io/testimony/  ·  [Privacy policy](https://kyashwanth.github.io/testimony/privacy.html)

Testimony is a Chrome extension that turns what you do in the browser into a document. Click through a task and
it captures each step with a screenshot. Then choose what to make:

- **A guide:** a clean step-by-step how-to or SOP, with tips and warnings.
- **Test evidence:** proof you can attach to a ticket, with Pass or Fail for each step.

Annotate the screenshots, add your notes, and download everything as a single PDF.

**Install:** from the Chrome Web Store (the link will be added here once the listing is live).
Early testers can download the latest zip from [Releases](https://github.com/kyashwanth/testimony/releases); the
release notes explain how to load it. Requires Chrome 102 or later.

## Quick start

1. Open the site you are using and click the Testimony icon in the toolbar.
2. Choose **Create a guide** or **Run a test**. For a guide, give it a title. For a test, enter the **ticket** and
   **environment** (for example `PROJ-123` and `UAT, build 2026.10.18`).
3. Press **Allow site & start recording**. Chrome asks you to allow Testimony on that one site. Approve it.
4. Work as you normally would. Every click, typed field and dropdown choice becomes a step with a screenshot.
5. Press the icon again and choose **Stop & review**. The editor opens with all your steps.
6. Edit and annotate, choose a **format** next to the Download button, and press **Download**.

Attach a test PDF to your ticket, or publish a guide wherever your team keeps its how-tos.

## Two modes

Switch at any time with the **Guide / Test run** buttons in the popup or at the top of the editor. The mode only
changes how the session is edited and exported, so one recording can become either document and nothing is lost
when you switch.

| | Guide (how-to or SOP) | Test run (evidence) |
|---|---|---|
| Purpose | Teach someone how to do something | Prove a test passed or failed |
| Details | Title, overview, author, version, last updated, what to know first | Ticket, environment, tester, date, overall result |
| Each step | The instruction, plus an optional **tip, warning or note** | Pass or Fail, **expected** and **actual**, notes |
| Extras | Section headings, text-only paragraphs, **zoom to the clicked area** | Overall result worked out from the steps |
| Final screenshot | Off by default | On by default |
| PDF | A clean numbered how-to with no results | An evidence report with the result badge |

## What Testimony records

| You do this | You get this step |
|---|---|
| Click a button or link | "Click the 'Save' button", with a red marker on the click |
| Type in a field and move on | "Typed in the 'Email' field", with the field boxed |
| Press Enter in a field | "Pressed Enter in the 'Search' field" |
| Click a link | "Click the 'Orders' link", photographed **as you click**, so the screenshot shows the link on the page you left |
| Choose from a dropdown | "Selected 'INR' in the 'Currency' dropdown" |
| Press Stop | A "Final state" screenshot, so the session ends with the outcome on screen |

- **Screenshots wait a moment after each click** (0.7 seconds by default), so success messages and new
  table rows are in the picture. Change this under **Options** in the popup: instant, 0.7, 1.5 or 3 seconds.
- **What you type is never read.** Only the name of the field is recorded. Password fields are named
  generically.
- **Need a shot of something else?** Press `Alt+Shift+S` to capture the current tab at any time, or paste
  or drop an image into the editor.

## Editing and exporting

In the editor you can:

- Rename any step and add a note, such as what you expected and what actually happened.
- Mark each step **Pass** or **Fail**. The overall result is worked out from the steps, or you can set it
  yourself to Pass, Fail or Blocked.
- Fill in the ticket, environment, tester, date and an optional summary. These appear at the top of the PDF.
- In a **guide**: edit each instruction, add a tip, warning or note, **zoom** into the clicked area, and add section
  headings or paragraphs that have no screenshot.
- In a **test run**: write what you expected and what actually happened for each step.
- Click any screenshot to **annotate** it with a box, arrow, circle, highlight or text label, in five colours.
  Use **Redact** to black out anything sensitive before you export.
- Move steps up or down, or delete them.
- Add extra screenshots by pasting, dropping or uploading images.

### Formats

Pick the format next to the **Download** button. Your choice is remembered.

| Format | What you get | Good for |
|---|---|---|
| **PDF** | A paginated document | Attaching to a ticket, sending as sign-off, printing |
| **HTML** | One self-contained web page with the screenshots inside, a contents list for guides, and print styles | Emailing, a wiki or intranet, any language or emoji |
| **Markdown + images** | A `.zip` holding a folder with the Markdown file and an `images/` folder | Confluence, GitHub, Notion, a docs site or any editor |
| **CSV** | One row per step: ticket or guide details, step, result, expected, actual, notes, page, time and screenshot file name | Spreadsheets and test-management imports |

- **HTML** has no scripts and never contacts a server.
- **Markdown**: unzip it and keep the `images/` folder beside the `.md` file so the pictures show. Anything you typed
  is escaped, so it shows exactly as written and cannot add links or HTML in the tool you paste it into.
- **CSV** opens in Excel with accents and other scripts intact. A cell that begins with `=`, `+`, `-` or `@` gets an
  apostrophe in front so a spreadsheet shows it as text and never runs it as a formula. The `Screenshot` column holds the
  file names used in the Markdown package.

A test PDF contains the ticket, environment, tester, date, overall result and summary, followed by every step
with its screenshot, expected and actual results, note, page address and Pass or Fail status. A guide PDF has the
title, author, version, overview and prerequisites, then numbered steps with their tips and warnings.

## Sessions and History

**New session** saves your current session to **History** before clearing the editor, so you never lose
work by accident. History keeps your **last 5 sessions**. For each one you can **Restore** it, download its
**PDF**, or **Delete** it.

## Testing across several tabs

Testimony follows your test. It records the window you started in, plus any tab or window opened from it,
such as a link that opens in a new tab or a payment pop-up. Steps are labelled "Tab 1", "Tab 2" and so on
in the editor and the PDF when a session uses more than one tab. Other windows are ignored.

## Your privacy

- **Nothing leaves your computer.** There is no account, no server and no tracking. Screenshots and notes
  are stored in your browser only.
- **Testimony asks for access one site at a time.** Nothing is granted when you install it. You approve each
  site yourself, and you can remove any site from the popup under **Allowed sites**.
- **It only watches while you record**, and only on sites you allowed.
- Screenshots show whatever is on screen, so check them (and use **Redact**) before sharing a PDF.

| Permission | Why |
|---|---|
| Access to a site (asked per site) | To record your clicks and capture screenshots while you test it |
| Active tab | To capture the tab you are on when you press the icon or `Alt+Shift+S` |
| Storage | To save your steps, settings and History on your computer |
| Scripting | To start the recorder on the sites you allowed, only while recording |

Read the full [privacy policy](PRIVACY.md).

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+S` | Capture a screenshot of the current tab as a step |
| `Alt+Shift+R` | Stop recording (or start it, if you have already allowed the site) |

You can change these at `chrome://extensions/shortcuts`.

## Troubleshooting

**The icon shows a `!`.** The tab you are looking at is not being recorded, usually because its site has not
been allowed yet. This happens when a login redirects to another domain or you open a new site. Open the
Testimony popup on that tab and press **Allow this site**. `Alt+Shift+S` still captures it in the meantime.

**My clicks are not being recorded.** Check that the popup shows "is allowed" for the site, that you started
recording, and that the icon is not showing `!`. Clicks on sites you have not allowed are never recorded.

**`Alt+Shift+R` does not start recording.** Chrome cannot show a permission prompt from a shortcut. Start
the first recording from the popup, after which the shortcut works on that site.

**The screenshot shows the page before it finished updating.** Increase the delay under **Options** in the
popup, for example to 1.5 or 3 seconds.

**A step shows a grey "Screenshot could not be captured" picture.** Chrome refused the screenshot, usually
because a page was closing or the browser was busy. The step is kept so your sequence is complete. Capture the
screen again with `Alt+Shift+S` and replace the picture by pasting it into the editor.

**A step says "Page changed after this click".** The page navigated before the screenshot could be taken, so the picture
shows the next page and a click marker would point at the wrong thing. Links are normally photographed as you click
to avoid this; it mostly happens with buttons that move you to another page. The next step shows where you landed.

**Some characters in the PDF show as `?`.** The PDF supports Latin characters. Other scripts and emoji in
titles or notes are replaced with `?`. Choose the **HTML** format if you need them.

**I can't record `chrome://` pages or the Chrome Web Store.** Chrome does not allow extensions to capture them.

**Where is my data, and how do I delete it?** In your browser only. Delete a saved session from **History**,
or remove the extension to erase everything.

## Limitations

- Typing in rich-text editors and Tab key presses are not recorded as steps. Use `Alt+Shift+S` for those.
- A true double-click is recorded as one step. Two separate clicks are two steps, even quick ones.
- Chrome allows only about two screenshots per second. In a very fast sequence every action is still recorded, in
  order, but the screenshots are spaced out, and each is taken just before your next action.

## Feedback and support

Found a problem or have an idea? Please open an issue at
[github.com/kyashwanth/testimony/issues](https://github.com/kyashwanth/testimony/issues).

If Testimony saves you time and you would like to say thanks, you can
[buy me a coffee](https://buymeacoffee.com/kyashwanth). It is entirely optional.

Want to build or contribute? See [DEVELOPMENT.md](DEVELOPMENT.md).

## License

Testimony is released under the [MIT License](LICENSE).
