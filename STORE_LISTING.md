# Chrome Web Store — Submission Kit v1.2.0

## Steps only you can do (in your browser/account)

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) — sign in, pay one-time registration fee
2. Take **3-5 screenshots** of the actual extension (reload it, screenshot each tab: Find Jobs with results, Resume Match with analysis, Find Contacts, Settings). Store requires real screenshots, not mockups.
3. Zip the `jobtrail` folder → Upload zip
4. Fill in the listing using the copy below
5. Set Privacy Policy URL to your GitHub raw link: `https://raw.githubusercontent.com/YOURNAME/jobtrail/main/PRIVACY.md`
6. Submit for review — expect a few days given the number of host permissions

---

## Short description (132 chars max)

```
Scan jobs on LinkedIn & Naukri, score them against your resume with AI, track applications, find referral contacts.
```

## Detailed description

```
JobTrail is a free, open-source job hunting assistant built around one idea: fewer, better-targeted applications are more effective than applying to everything faster.

WHAT IT DOES

Find jobs
• Scan LinkedIn, Naukri, or Google search results pages you're already viewing — or search via free job APIs (Adzuna, JSearch)
• Smart filtering: title keywords match in any word order ("technical support manager" finds "Manager, Technical Support"), plus required/exclude keywords, city, salary, posting age
• Already-exported jobs are hidden automatically — no duplicate scanning

Resume match & gap analysis
• Upload your resume once (PDF or DOCX) — saved permanently, no re-uploading each time
• Per-job analysis: fit score, matching skills with evidence from your resume, missing skills with specific gap descriptions (not just "not mentioned"), actionable resume suggestions, and a role-specific cover letter draft
• Score all scanned jobs at once and sort by fit

Export
• Download a Jobs CSV or Full Analysis CSV (matching skills, missing skills, suggestions, cover letter per job)
• Send to your own Google Sheet via Google Form — no Cloud Console or OAuth required
• Two forms: one for job details, one for the full analysis. Linked by a Job ID for VLOOKUP

Application tracker
• Applied / Interviewing / Rejected / Offer status on every job
• Follow-up reminders with a badge on the extension icon

Find contacts for referrals
• Scan LinkedIn People search results for contacts at a target company
• AI-drafted connection request for each — short and specific, not a generic template
• Mutual connections shown first

HOW IT WORKS
Everything runs in your browser. There is no server. Your resume and API keys never leave your machine — they go directly to whichever AI provider you've configured (Gemini or Groq, both free tiers). Scanning reads pages you're already viewing in your own logged-in session.

WHAT YOU NEED
A free AI API key (Google Gemini or Groq — both have free tiers, Settings has a Test button). Everything else is optional. Full setup guide in the README on GitHub.

This is open source and not a paid product. See GitHub for source code.
```

## Category
**Productivity**

## Permission justifications (paste into each field on the dashboard)

| Permission | Justification |
|---|---|
| `storage` | Saves settings (API keys, form links), resume text, scanned job results, application tracker, outreach log, and exported-job history to your own browser storage. Nothing is sent to any server operated by the developer. |
| `activeTab` + `scripting` | Reads job listings or LinkedIn People search results already rendered in your current browser tab, only when you click a scan button. Nothing runs automatically or in the background. |
| `identity` | Used only for the optional Google Sheets OAuth export feature. Only requested when the user explicitly clicks "Connect Google account" in Settings. |
| `alarms` | Checks once per hour whether any logged outreach messages are due for a follow-up reminder, and updates the extension icon badge count. |
| `sidePanel` | Opens JobTrail as a side panel that stays visible while you browse, instead of a popup that closes when you click away. |
| `linkedin.com` | Reads job search results and People search results on LinkedIn pages the user is already viewing. |
| `naukri.com` | Reads job search results on Naukri pages the user is already viewing. |
| `google.com` | Reads Google Jobs widget results and organic search results on Google search pages the user is already viewing. |
| `sheets.googleapis.com` | Used for the optional OAuth-based Google Sheets export feature. |
| `docs.google.com` | Used to submit job data to Google Forms the user has set up themselves for their own spreadsheet. |
| `generativelanguage.googleapis.com` | Calls the Google Gemini API using the user's own API key for resume matching and outreach message drafting. |
| `api.groq.com` | Calls the Groq API using the user's own API key as an alternative AI provider. |
| `api.adzuna.com` | Calls the Adzuna job search API using the user's own API credentials. |
| `jsearch.p.rapidapi.com` | Calls the JSearch API using the user's own API key. |

