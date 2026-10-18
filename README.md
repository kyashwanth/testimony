# Testimony

*Pics or It Didn't Happen.*

Testimony is a Chrome extension that turns a manual test session into proof you can attach to a ticket.
Click through your test as normal and it captures each step with a screenshot. Then add notes, mark each
step Pass or Fail, annotate the screenshots, and download everything as a single PDF.

**Install:** from the Chrome Web Store (the link will be added here once the listing is live).
Requires Chrome 102 or later.

## Quick start

1. Open the site you are testing and click the Testimony icon in the toolbar.
2. Enter the **ticket** and **environment** (for example `PROJ-123` and `UAT, build 2026.10.18`).
3. Press **Allow site & start recording**. Chrome asks you to allow Testimony on that one site. Approve it.
4. Test as you normally would. Every click, typed field and dropdown choice becomes a step with a screenshot.
5. Press the icon again and choose **Stop & review**. The editor opens with all your steps.
6. Add notes, mark steps **Pass** or **Fail**, annotate the screenshots, then press **Download PDF**.

Attach the PDF to your ticket, or paste it into your test management tool.

## What Testimony records

| You do this | You get this step |
|---|---|
| Click a button or link | "Click the 'Save' button", with a red marker on the click |
| Type in a field and move on | "Typed in the 'Email' field", with the field boxed |
| Press Enter in a field | "Pressed Enter in the 'Search' field" |
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
- Click any screenshot to **annotate** it with a box, arrow, circle, highlight or text label, in five colours.
  Use **Redact** to black out anything sensitive before you export.
- Move steps up or down, or delete them.
- Add extra screenshots by pasting, dropping or uploading images.

The PDF contains the ticket, environment, tester, date, overall result and summary, followed by every step
with its screenshot, note, page address and Pass or Fail status.

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

**Some characters in the PDF show as `?`.** The PDF supports Latin characters. Other scripts and emoji in
titles or notes are replaced with `?`.

**I can't record `chrome://` pages or the Chrome Web Store.** Chrome does not allow extensions to capture them.

**Where is my data, and how do I delete it?** In your browser only. Delete a saved session from **History**,
or remove the extension to erase everything.

## Limitations

- Typing in rich-text editors and Tab key presses are not recorded as steps. Use `Alt+Shift+S` for those.
- Doing the same thing twice within about half a second (a double-click) is recorded as one step.
- Chrome limits how fast screenshots can be taken, so very fast sequences are spaced out. They stay in order.

## Feedback and support

Found a problem or have an idea? Please open an issue at
[github.com/kyashwanth/testimony/issues](https://github.com/kyashwanth/testimony/issues).

Want to build or contribute? See [DEVELOPMENT.md](DEVELOPMENT.md).
