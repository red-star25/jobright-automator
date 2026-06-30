# Jobright Outreach Autopilot

A Chrome extension that speeds up the Insider Connection outreach flow on
Jobright: drafting the referral email in Gmail with your resume attached,
and prepping the LinkedIn connection note, person by person.

You still click the final Send on both the email and the LinkedIn request,
nothing goes out without you reviewing it first.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked" and select this `jobright-automator` folder.
4. Pin the extension from the puzzle-piece icon in the toolbar so it's easy to reach.

## One-time setup

1. Click the extension icon, then "Manage resumes".
2. Upload your resume PDF(s). If you upload more than one, click "Set default"
   on the one you want used when you don't pick a different one in the popup.
3. In Chrome, make sure `mailto:` style links aren't required, this extension
   opens Gmail directly in a tab, it does not rely on your Mac's Mail app.

## Running it

1. Open a Jobright job page that has an "Insider Connection" section with people listed.
2. Click the extension icon, pick the resume to use, click "Start on this page".
3. Watch the status log in the popup. For each person it will:
   - Try the email icon. If Jobright finds an email, it opens a new Gmail tab
     with the to/subject/body already filled in and tries to attach your resume.
   - Try the LinkedIn icon. If a connect message is generated, it opens that
     person's LinkedIn profile in a new tab, clicks Connect, opens the note box,
     and pastes the message in.
   - If Jobright can't find an email for someone, that person is skipped automatically.
4. Go through the new Gmail and LinkedIn tabs it opened and hit Send on each one.

## Known rough edges (this is a first version)

Jobright's page structure wasn't available to inspect directly, so the
script finds people and buttons using visible text and rough shape (small
square icon buttons) rather than exact CSS classes. This is more durable
than guessing class names, but it can still miss things. If something
doesn't work:

- Open the page's DevTools console (right-click > Inspect > Console tab)
  before clicking Start, and copy any red errors or `[Jobright Autopilot]`
  log lines back to me.
- If it can't find the Insider Connection section at all, right-click that
  section on the page, choose Inspect, and send me a screenshot of the
  HTML panel that opens.
- The Gmail auto-attach step is the most fragile part (it simulates a file
  drag-and-drop). If it fails, the email is still fully drafted, you'd just
  attach the resume by hand for that one.

## Files

- `manifest.json` - extension configuration
- `popup.html` / `popup.js` - the Start button and status log
- `options.html` / `options.js` - resume upload and default selection
- `background.js` - passes data between the Jobright, Gmail, and LinkedIn tabs
- `content_jobright.js` - finds people and drives both flows
- `content_gmail.js` - attaches the resume in the new Gmail tab
- `content_linkedin.js` - clicks Connect and pastes the note
