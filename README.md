# InsiderReach

Referral outreach, faster. InsiderReach is a Chrome extension that speeds up the Insider Connection outreach flow on Jobright: drafting the referral email in Gmail with your resume attached, and prepping the LinkedIn connection note, person by person.

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

## Outreach log and dashboard

Every email or LinkedIn connection sent through the autopilot gets recorded
locally (name, company, channel, date). Two things use this:

- **Automatic skipping**: if someone shows up again, on this job page or a
  different one at the same company, the autopilot checks this log first
  and skips them instead of messaging them twice.
- **Dashboard**: click "View outreach log" in the popup to see everyone
  you've contacted, today's count, total count, and a reply rate. There's
  no way to detect replies automatically, so it's a manual "Mark replied"
  button per person, click it whenever someone gets back to you.

The popup also shows a quick Today / Total / Reply rate summary without
needing to open the full dashboard.

## AI Rewrite toggle

The popup has an **AI Rewrite** switch:

- **On**: InsiderReach pauses on each Jobright email/LinkedIn popup and shows the floating Rewrite / Rewrite Pro panel.
- **Off**: InsiderReach skips the AI panel, uses Jobright's original message, and keeps the automation moving normally.

You can also change the same setting from **Manage resumes → AI Settings**.

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
  before clicking Start, and copy any red errors or `[InsiderReach]`
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

## AI rewrite features

InsiderReach now supports two optional AI actions inside the Jobright email and LinkedIn message popups:

- **Rewrite**: rewrites Jobright's existing message in the selected tone.
- **Rewrite Pro**: uses the message plus job/person context and your saved resume text to make the outreach more personalized.

Available tones: Professional, Friendly, Concise, Confident, Warm referral ask, Student/new grad, and Recruiter-style.

### AI setup

1. Open **Manage resumes** from the extension popup.
2. Add your OpenAI API key in **AI Settings**.
3. Choose a default tone.
4. Upload your resume PDF. InsiderReach will try to extract text from it for Rewrite Pro.
5. If the extracted resume text looks incomplete, paste your resume text manually into the Resume text box.

The local version stores your API key in Chrome local storage on your own browser. This is fine for personal testing, but if you share or publish the extension, move AI calls to a backend so the key is not exposed.

### AI flow

When an email or LinkedIn message popup opens, InsiderReach pauses and shows an **InsiderReach AI** panel. Nothing is sent to AI automatically. Click **Rewrite** or **Rewrite Pro** only when you want AI help, review/edit the result, then click **Use this message**. Click **Use original** to continue without AI.


## Rewrite Pro resume text note

InsiderReach can try to extract text from uploaded PDFs, but many resume PDFs store text in compressed or custom-font encoded form. If the extracted text looks like random symbols, paste clean resume text into **Options > AI Settings > Resume text for Rewrite Pro** or upload a `.txt` copy of your resume. Rewrite Pro now refuses to run when the resume text looks unreadable, instead of silently generating a weaker job-only message.

To inspect AI calls, open `chrome://extensions`, inspect the InsiderReach service worker, and check the Console/Network tabs. Logs show safe metadata only, such as mode, tone, job-section counts, and character counts. They do not log your API key or full resume text.


## New workflow controls

The popup now includes a **Run mode** selector:

- **Email + LinkedIn**: the normal person-by-person flow.
- **Email only**: drafts Gmail messages and skips LinkedIn.
- **LinkedIn only**: skips email and only prepares LinkedIn notes.

It also includes an **AI Rewrite mode** selector:

- **Off**: use Jobright's original message and keep automation moving.
- **Ask every time**: show the Rewrite / Rewrite Pro panel and wait for your choice.
- **Auto Rewrite**: automatically rewrite the message, then show a preview.
- **Auto Rewrite Pro**: automatically personalize with job + resume context, then show a preview.

## Rewrite Pro details

Rewrite Pro now extracts the Jobright job context from:

- Responsibilities
- Required qualifications
- Preferred qualifications
- Jobright matched skill tags

It combines that with the resume text in Options and your optional custom AI instructions. When the AI returns a result, the preview panel shows the concrete resume proof point it used so you can verify that it did not make something up.

## Duplicate detection

The outreach log now stores stronger identifiers. Email rows use the email address. LinkedIn rows store the LinkedIn profile URL when the LinkedIn page is opened, and still fall back to name + company when the URL is not available yet. This helps avoid double-contacting people across different job pages.


## AI safety tweaks

Rewrite Pro blocks dummy placeholders such as XYZ Corp, ABC, Acme, and Example Corp. If the AI tries to invent one, InsiderReach asks for a revision or shows an error instead of using it.


## 0.2.2 update

- Improved LinkedIn log names by reading the profile h1, Connect button aria-label, and invite modal name before saving the outreach log.

## 0.2.3 LinkedIn continue fix

- Prevents placeholder Jobright row names like "Unknown" and category labels from being used as duplicate-detection keys.
- Reads the real LinkedIn recipient name from the Jobright LinkedIn note (`Hi Name, ...`) before opening the LinkedIn profile.
- Marks a LinkedIn contact as locally contacted only after the LinkedIn step finishes, so one `Unknown` row cannot cause the rest of the list to be skipped.


## 0.2.2 duplicate handling fix

- LinkedIn profiles that already show Pending/Message/Connected now close automatically and allow the run to continue.
- LinkedIn duplicate detection now includes a company-scoped first-name fallback so a rerun can match Jobright's `Hi FirstName` note to a full LinkedIn log entry.


## LinkedIn profile targeting safety

The LinkedIn script now ignores Connect buttons in recommendation/right-rail sections like "More profiles for you" and verifies the invite dialog name matches the current profile before continuing.


## Stopping after completion

After InsiderReach finishes all visible people on a Jobright job page, it marks that page as completed for the current tab and ignores another Start click on the same page. Refresh the page if you intentionally want to rerun the same job.


## 0.2.8 performance update

- Caches the Jobright job context once per run instead of re-reading responsibilities, qualifications, matched skills, company, and title for every person.
- Caches the selected resume text once per run and passes it into Rewrite Pro directly.
- Adds an AI response cache for repeated Rewrite/Rewrite Pro requests with the same person, job, tone, message, resume, and instructions.
- Uses an indexed outreach lookup when saving log entries so duplicate checks scale better as the log grows.
- Replaces some polling waits with MutationObserver-backed waits so popups are detected as soon as they render.
- Adds a **Debug console logs** setting in Options. Keep it off for normal runs; turn it on only when troubleshooting.
- Clearing the outreach log now also clears the duplicate-detection index.

## Completion stop fix

- Completed Jobright job pages are now remembered in Chrome storage, not only in the current tab session.
- The completion key uses the canonical job URL so it does not change when company text is unavailable during rendering.
- Clicking Start again on a completed job page stops immediately instead of reopening categories and re-checking every person.
