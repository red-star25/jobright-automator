# InsiderReach

Chrome extension for Jobright Insider Connection outreach: draft Gmail emails with your resume attached, prep LinkedIn connection notes, and optionally rewrite messages with Cloud AI.

You still click Send on every email and LinkedIn request — nothing goes out without your review.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension from the toolbar puzzle icon.

## Setup

1. Open the extension popup → **Manage resumes** and upload your resume PDF(s).
2. Sign in from **Settings** to use Cloud AI rewrites (no OpenAI key needed in the extension).
3. Set your default tone, name, and optional resume text for Rewrite Pro.

## Running outreach

1. Open a Jobright job page with an Insider Connection section.
2. In the popup, pick a resume, choose run mode and AI mode, then click **Preview + Start**.
3. For each person, the extension opens Gmail and/or LinkedIn tabs for you to review and send.
4. Progress logs appear in the browser DevTools console on the Jobright tab (`[InsiderReach]` prefix).

## Outreach log

Every sent email or LinkedIn connection is stored locally. The popup shows Today / Total / Reply rate; **View outreach log** opens the full dashboard with manual **Mark replied** tracking.

Duplicate detection skips people you've already contacted (by email, LinkedIn URL, or name + company).

## AI rewrite modes

- **Off** — use Jobright's original message.
- **Ask every time** — show the Rewrite / Rewrite Pro panel before continuing.
- **Auto Rewrite** / **Auto Rewrite Pro** — run AI automatically, then show a preview.

**Rewrite** rewrites the message in your chosen tone. **Rewrite Pro** adds job context and resume text for deeper personalization.

## Run modes

- **Email + LinkedIn** — full flow.
- **Email only** — Gmail drafts only.
- **LinkedIn only** — connection notes only.

## Project layout

| Path | Purpose |
|------|---------|
| `manifest.json` | Extension config |
| `background.js` | Tab coordination, outreach log, Cloud AI |
| `content_jobright.js` | Jobright automation |
| `content_gmail.js` | Resume attach in Gmail |
| `content_linkedin.js` | Connect + note paste on LinkedIn |
| `popup.*` / `options.*` / `dashboard.*` | UI |
| `config.js` / `auth.js` | API URLs and sign-in |
| `cloud-api/` | Railway backend (OpenAI, billing, usage) |
| `web/` | Sign-in and account web app (Vercel) |

## Troubleshooting

Open DevTools on the Jobright tab before starting a run and look for `[InsiderReach]` messages or red errors. For service worker / AI issues, inspect the extension background page at `chrome://extensions`.

If Gmail auto-attach fails, the draft is still filled — attach the resume manually for that message.
