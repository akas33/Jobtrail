# Privacy Policy — JobTrail

Last updated: 2026

## The short version

JobTrail doesn't have a server. There is no backend operated by the developer that your data passes through. Everything this extension does happens directly between your own browser and services you've personally connected — your Google account, your AI provider, your job-search API. The developer of this extension never sees, collects, stores, or has access to any of it.

## What the extension reads, and where it goes

- **Job listings**: when you click "Scan this page," the extension reads job postings already rendered in your own browser tab (LinkedIn, Naukri, or Google search results) and a job-search API (Adzuna or JSearch) if you've configured one. This data stays in the extension's popup and in your own browser's local/sync storage, until you choose to export it.
- **Resume / job description text**: when you use the resume-matching or outreach-drafting features, that text is sent directly from your browser to whichever AI provider you've configured (Google Gemini or Groq), using your own API key. It is not sent to, or stored by, the developer of this extension in any way.
- **Google Sheets / Google Forms**: if you connect a Google Sheet or Form, exported job data is sent directly from your browser to Google's APIs, using your own Google account's permission. The developer has no access to your spreadsheet or form data.
- **LinkedIn contact information**: the "Find contacts" feature reads names, headlines, and profile links already visible on a LinkedIn search results page you're viewing. It does not look up, guess, or retrieve email addresses or any other contact information.

## What's stored, and where

The extension uses `chrome.storage.sync` (and, for some features, `chrome.storage.local`) to remember your settings (API keys, spreadsheet/form configuration), a list of jobs you've already exported (so they're not shown again), an outreach/follow-up log, and your application-tracking status. This storage is part of your own Chrome/Google account sync — the same mechanism Chrome uses for your bookmarks and extension settings — and is never transmitted to the developer.

## What is never collected

- No analytics or usage tracking
- No advertising identifiers
- No data is sold, rented, or shared with any third party by the developer
- No account or sign-up with the developer is required or possible

## Third-party services you choose to connect

If you add an API key or connect an account (Google, Gemini, Groq, Adzuna, JSearch), your use of that service is governed by that provider's own privacy policy and terms — this extension is simply a client that makes API calls on your behalf, using credentials only you hold.

## Open source

The full source code is publicly available, so you (or anyone) can verify everything above directly rather than taking it on faith.

## Contact

Questions about this policy can be raised via the project's GitHub repository issues page.
