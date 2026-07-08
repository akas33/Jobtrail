\# JobTrail



!\[License: MIT](https://img.shields.io/badge/license-MIT-0F6E56) !\[Cost](https://img.shields.io/badge/cost-free%20forever-0F6E56) !\[Backend](https://img.shields.io/badge/server-none-0F6E56) !\[Version](https://img.shields.io/badge/version-1.2.0-0F6E56)



A free, open-source Chrome extension that helps you job hunt smarter — not just faster.



Most job tools help you apply to more things. JobTrail is built around a different idea: score every job against your actual resume before spending time on it, understand the real gaps (not just "skill not mentioned"), find real people to reach out to, and track what's actually working.



No server. No account with us. No cost ever. You bring your own free API keys.



\---



\## What it does



\### Find jobs



Scan LinkedIn, Naukri, or Google search results pages you're already viewing



Or search via free job APIs (Adzuna, JSearch) — more stable than scraping, and returns full job descriptions



Filter by title (word-order-independent — "technical support manager" matches "Manager, Technical Support"), city, salary, posting age



Add required keywords (must appear in JD) and exclude keywords (e.g. "cloud, senior")



Jobs you've already exported are hidden automatically — no duplicate scanning across sessions



Scanned results persist across popup opens (stay visible even when you click away)



\### Resume match \& gap analysis



Upload your resume once as PDF or DOCX — saved permanently, no re-uploading



Paste a job description and get:



Fit score (0-100)



Matching skills — with specific evidence from your resume ("Led cross-functional teams of 12+ across 3 products")



Missing skills — comparative gap analysis ("AWS at scale: JD requires production experience on 10M+ user systems; resume mentions cloud adoption but no platform or scale specified")



Resume suggestions — specific, actionable edits with section references



Cover letter — specific to the company and role, not a template



\### Smart scoring



"Score all jobs" runs your resume against every scanned job at once, sorts by fit



"Score this job →" per-row for individual scoring with full analysis



Uses the full JD if you've pasted it in the Resume Match tab — much more accurate than scraped card text



Scores cached per job+resume combination — re-scanning doesn't burn your daily AI quota twice



\### Export



Download Jobs CSV — Title, Company, Location, Salary, Source, URL, Fit Score, Missing Skills, Status



Download Full Analysis CSV — detailed breakdown per job: matching skills, missing skills, resume suggestions, cover letter



Google Form (Jobs) — sends to your own linked Google Sheet, no Cloud Console needed



Google Form (Analysis) — second form for resume suggestions + cover letter, auto-submits after scoring. Both sheets linked by a stable Job ID for VLOOKUP



\### Application tracker



Applied / Interviewing / Rejected / Offer status dropdown on every job



Tracker tab with real counts — the only place to see if any of this is working



Status is included in the Google Form job export when configured



Follow-up reminders with badge on the extension icon — nudges after 5 days



\### Find contacts for referrals



Scan LinkedIn People search results for contacts at a target company



Get an AI-drafted connection request for each — short, specific, not a template



Mutual connections shown first



Works by reading what's already visible on your screen — no email lookup, no scraping hidden data



\---



\## Setup



\### 1. Install the extension



Load as unpacked from `chrome://extensions` (Developer mode on). Once published on the Chrome Web Store, this becomes a one-click install.



\### 2. Get a free AI key (pick one)



Gemini: aistudio.google.com/app/apikey — free tier (\~20 req/day on `gemini-2.5-flash`). Check your real limits at aistudio.google.com/rate-limit



Groq: console.groq.com/keys — free tier, more generous daily limit, hosts Llama models



Add both and turn on "If my main provider hits its quota, try the other one" in Settings — they pool their separate free quotas.



\### 3. Get a free job-search API key (optional but recommended)



Adzuna: developer.adzuna.com — free, good India coverage



JSearch via RapidAPI: rapidapi.com/.../jsearch — free tier



These give full job descriptions = more accurate scoring than scraped card text.



\### 4. Set up Google Forms export (no Cloud Console needed)



Two forms, two linked sheets. Each person makes their own copy — you share a template link, nothing from your account is visible to them.



Jobs Form (click "Make a copy" in Settings, or build from scratch with 11 Short answer/Paragraph questions):



`JC\_JOBID` `JC\_TITLE` `JC\_COMPANY` `JC\_LOCATION` `JC\_SALARY` `JC\_SOURCE` `JC\_URL` `JC\_FITSCORE` `JC\_MATCHING` `JC\_MISSING` `JC\_STATUS`



Analysis Form (click "Make a copy" in Settings, or 3 questions):



`JC\_JOBID` `JC\_SUGGESTIONS` `JC\_COVERLETTER`



Job ID is a stable hash — use VLOOKUP on it to join both sheets.



After copying each form: link it to a spreadsheet (Responses → Sheets icon), go to ⋮ → Pre-fill form, fill in every placeholder with its `JC\_...` text, Get link, Copy link, paste in Settings.



\### 5. That's it — open the side panel and start scanning



Click the JobTrail icon in your toolbar. The side panel stays open while you browse.



\---



\## Why BYOK (bring your own key)?



Providers cap usage per account because AI inference costs real compute. A shared key baked into the extension would hit its daily limit almost immediately with multiple users. Free + no server + open source = each person uses their own free key. The Settings page has a "Test key" button so you know immediately if it's working.



\## If scrapers stop working



LinkedIn and Naukri change their page structure without notice. The extension uses `innerText` line parsing and stable attributes (not CSS class names) to reduce how often this breaks — but it will happen eventually. When it does: open a browser console on the affected site, inspect a job card, and update the selectors in the relevant file under `content-scripts/`. The scraper files have comments explaining exactly what to look for.



\## License



MIT — use it, fork it, build on it. Not a company, not a product. Just a tool.



