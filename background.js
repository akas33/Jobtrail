importScripts("lib/ai.js", "lib/sheets.js", "lib/jobApis.js", "lib/googleForm.js");

// Open the side panel when the toolbar icon is clicked.
// The side panel stays open while you browse — unlike a popup which
// closes the moment you click anywhere outside it.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

const MAX_SEEN_ENTRIES = 4000; // safety cap so chrome.storage.sync's ~100KB quota is never exceeded

function pickJobScraperScript(urlString) {
  const { hostname, pathname } = new URL(urlString);
  if (hostname === "www.linkedin.com" && !pathname.startsWith("/search/results/people")) {
    return "content-scripts/linkedin.js";
  }
  if (hostname === "www.naukri.com") return "content-scripts/naukri.js";
  if (hostname === "www.google.com") return "content-scripts/google-jobs.js";
  return null;
}

function pickContactsScraperScript(urlString) {
  const { hostname, pathname } = new URL(urlString);
  if (hostname === "www.linkedin.com" && pathname.startsWith("/search/results/people")) {
    return "content-scripts/linkedin-people.js";
  }
  return null;
}

function passesFilter(job, filters) {
  const { titleKeyword, requiredKeywords, excludeKeywords, city, minSalary, includeNoSalary, maxAgeDays } = filters;
  const searchText = `${job.title} ${job.description}`.toLowerCase();
  const titleText = job.title.toLowerCase();

  // Smart title matching: split query into words, require ALL words to appear
  // in the title in any order. So "technical support manager" matches
  // "Manager, Technical Support" and "Support Manager Technical" etc.
  if (titleKeyword) {
    const words = titleKeyword.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length > 0 && !words.every(w => titleText.includes(w))) return false;
  }

  // Required keywords: all must appear somewhere in title or description
  if (requiredKeywords) {
    const required = requiredKeywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
    if (required.some(k => !searchText.includes(k))) return false;
  }

  // Exclude keywords: any match drops the job
  if (excludeKeywords) {
    const excluded = excludeKeywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
    if (excluded.some(k => searchText.includes(k))) return false;
  }

  if (city && job.location && !job.location.toLowerCase().includes(city.toLowerCase())) return false;

  if (maxAgeDays && job.postedAt) {
    const ageDays = (Date.now() - new Date(job.postedAt).getTime()) / 86400000;
    if (ageDays > maxAgeDays) return false;
  }

  if (!job.salary) return includeNoSalary;

  if (minSalary) {
    const numbers = job.salary.match(/[\d,.]+/g);
    if (numbers) {
      const biggest = Math.max(...numbers.map((n) => parseFloat(n.replace(/,/g, ""))));
      if (biggest < minSalary) return false;
    }
  }
  return true;
}

// Stable identity for a job listing, used for the "already exported" dedupe.
// Falls back to a composite key when a source doesn't give a per-job URL.
function jobKey(job) {
  return job.url || `${job.title}::${job.company}::${job.location}`;
}

// Compact, deterministic hash (cyrb53-style) so the synced seen-list stores
// ~12 characters per job instead of a full URL — keeps far more history
// inside chrome.storage.sync's per-item/total quota.
function hashKey(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// Stored in chrome.storage.sync — follows you to any device signed into the
// same Chrome profile, no server involved. Dedupe is a nice-to-have, so any
// storage failure (quota, sync disabled, offline) fails soft rather than
// blocking a scan or export.
async function getSeenSet() {
  try {
    const { seenJobHashes = [] } = await chrome.storage.sync.get("seenJobHashes");
    return new Set(seenJobHashes);
  } catch {
    return new Set();
  }
}

async function filterAndDedupe(jobs, filters) {
  const passed = jobs.filter((job) => passesFilter(job, filters));
  if (!filters.hideSeen) return { jobs: passed, hiddenCount: 0 };

  const seen = await getSeenSet();
  const visible = passed.filter((job) => !seen.has(hashKey(jobKey(job))));
  return { jobs: visible, hiddenCount: passed.length - visible.length };
}

async function markJobsSeen(jobs) {
  try {
    const seen = await getSeenSet();
    jobs.forEach((job) => seen.add(hashKey(jobKey(job))));
    let list = Array.from(seen);
    if (list.length > MAX_SEEN_ENTRIES) list = list.slice(list.length - MAX_SEEN_ENTRIES);
    await chrome.storage.sync.set({ seenJobHashes: list });
  } catch {}
}

async function getFormSubmittedSet() {
  try {
    const { formSubmittedHashes = [] } = await chrome.storage.sync.get("formSubmittedHashes");
    return new Set(formSubmittedHashes);
  } catch { return new Set(); }
}

async function markJobsFormSubmitted(jobs) {
  try {
    const submitted = await getFormSubmittedSet();
    jobs.forEach(job => submitted.add(hashKey(jobKey(job))));
    let list = Array.from(submitted);
    if (list.length > MAX_SEEN_ENTRIES) list = list.slice(list.length - MAX_SEEN_ENTRIES);
    await chrome.storage.sync.set({ formSubmittedHashes: list });
  } catch {}
}

function jobsNotYetSubmittedToForm(jobs) {
  return getFormSubmittedSet().then(submitted =>
    jobs.filter(j => !submitted.has(hashKey(jobKey(j))))
  );
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error("No active tab found.");
  return tab;
}

async function scanActiveTab() {
  const tab = await getActiveTab();
  const scriptFile = pickJobScraperScript(tab.url);
  if (!scriptFile) {
    throw new Error(
      "This page isn't a supported job site. Open a LinkedIn or Naukri job search results page, or a Google search for '<role> jobs', then try again."
    );
  }
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [scriptFile] });
  return result || [];
}

async function scanContactsActiveTab() {
  const tab = await getActiveTab();
  const scriptFile = pickContactsScraperScript(tab.url);
  if (!scriptFile) {
    throw new Error(
      "Open LinkedIn's People search (search a role + company, e.g. \"recruiter Acme Corp\", filtered to People), then try again."
    );
  }
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [scriptFile] });
  return result || [];
}

const FOLLOW_UP_DAYS = 5; // change this to adjust how long to wait before nudging a follow-up

async function updateFollowUpBadge() {
  try {
    const { outreachLog = [] } = await chrome.storage.sync.get("outreachLog");
    const now = Date.now();
    const due = outreachLog.filter(
      (r) => r.status === "sent" && (now - new Date(r.sentAt).getTime()) / 86400000 >= FOLLOW_UP_DAYS
    ).length;
    await chrome.action.setBadgeText({ text: due > 0 ? String(due) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#0F6E56" });
  } catch {
    // Badge is a nice-to-have; never let this break anything else.
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.outreachLog) updateFollowUpBadge();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("checkFollowUps", { periodInMinutes: 60 });
  updateFollowUpBadge();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("checkFollowUps", { periodInMinutes: 60 });
  updateFollowUpBadge();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkFollowUps") updateFollowUpBadge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "SCAN_ACTIVE_TAB") {
        const rawJobs = await scanActiveTab();
        const { jobs, hiddenCount } = await filterAndDedupe(rawJobs, message.filters);
        sendResponse({ ok: true, jobs, hiddenCount });
      } else if (message.type === "SEARCH_JOB_API") {
        const rawJobs = await searchJobApi(message.payload);
        const { jobs, hiddenCount } = await filterAndDedupe(rawJobs, message.filters);
        sendResponse({ ok: true, jobs, hiddenCount });
      } else if (message.type === "RUN_RESUME_MATCH") {
        const result = await runResumeMatch(message.payload);
        sendResponse({ ok: true, result });
      } else if (message.type === "PUSH_TO_SHEET") {
        const result = await appendJobsToSheet(message.payload);
        sendResponse({ ok: true, result });
      } else if (message.type === "UPDATE_JOB_STATUS") {
        updateJobStatusInSheet(message.payload).catch(() => {});
        sendResponse({ ok: true });
      } else if (message.type === "UPDATE_JOB_SCORE_IN_SHEET") {
        updateJobScoreInSheet(message.payload).catch(() => {});
        sendResponse({ ok: true });
      } else if (message.type === "PUSH_TO_FORM") {
        // Filter out jobs already submitted to the form
        const newJobs = await jobsNotYetSubmittedToForm(message.payload.jobs);
        const skipped = message.payload.jobs.length - newJobs.length;
        if (newJobs.length === 0) {
          sendResponse({ ok: true, result: { submitted: 0, skipped } });
        } else {
          const result = await submitJobsToForm({ ...message.payload, jobs: newJobs });
          await markJobsFormSubmitted(newJobs);
          sendResponse({ ok: true, result: { ...result, skipped } });
        }
      } else if (message.type === "SUBMIT_ANALYSIS_TO_FORM") {
        // Fire and forget — auto-triggered after scoring, doesn't block UI
        submitAnalysisToForm(message.payload).catch(() => {});
        sendResponse({ ok: true });
      } else if (message.type === "MARK_JOBS_SEEN") {
        await markJobsSeen(message.jobs);
        sendResponse({ ok: true });
      } else if (message.type === "CLEAR_SEEN_JOBS") {
        await chrome.storage.sync.remove("seenJobHashes");
        sendResponse({ ok: true });
      } else if (message.type === "SCAN_CONTACTS") {
        const rawPeople = await scanContactsActiveTab();
        // Dedupe by normalized URL then by name
        const seenU = new Set(), seenN = new Set(), people = [];
        for (const p of rawPeople) {
          const u = p.profileUrl ? p.profileUrl.replace(/\/$/, "").toLowerCase() : null;
          const n = p.name ? p.name.trim().toLowerCase() : null;
          if (u && seenU.has(u)) continue;
          if (n && seenN.has(n)) continue;
          if (u) seenU.add(u);
          if (n) seenN.add(n);
          people.push(p);
        }
        sendResponse({ ok: true, people });
      } else if (message.type === "DRAFT_OUTREACH") {
        const text = await draftOutreachMessage(message.payload);
        sendResponse({ ok: true, text });
      } else if (message.type === "TEST_AI_KEY") {
        await testApiKey(message.payload);
        sendResponse({ ok: true });
      } else if (message.type === "TEST_JOB_API") {
        await searchJobApi({ ...message.payload, keywords: message.payload.keywords || "test", location: message.payload.location || "" });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep the message channel open for the async response
});
