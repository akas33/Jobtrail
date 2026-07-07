import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

let scannedJobs = [];

// --- Persistence helpers ---
// Resume: saved to LOCAL storage (5MB limit vs sync's 8KB per key —
// a resume can easily exceed 8KB causing silent sync failures).
// It follows you on this device; sync your resume by uploading it once per device.
async function saveResume(text) {
  try { await chrome.storage.local.set({ savedResume: text }); } catch (e) {
    console.warn("Resume save failed:", e);
  }
}
async function loadResume() {
  try {
    const { savedResume } = await chrome.storage.local.get("savedResume");
    return savedResume || "";
  } catch { return ""; }
}

// Scanned jobs: saved to session storage so they survive popup close/reopen
// within the same browser session. Cleared when Chrome closes.
async function saveScannedJobs(jobs) {
  try { await chrome.storage.session.set({ scannedJobs: jobs }); } catch {}
}
async function loadScannedJobs() {
  try {
    const { scannedJobs: saved } = await chrome.storage.session.get("scannedJobs");
    return saved || [];
  } catch { return []; }
}

// --- Init: restore state on popup open ---
(async function init() {
  // Check API key setup
  const settings = await chrome.storage.sync.get(["provider", "geminiKey", "groqKey"]);
  const provider = settings.provider || "gemini";
  const hasKey = provider === "groq" ? !!settings.groqKey : !!settings.geminiKey;
  if (!hasKey) document.getElementById("setupBanner").style.display = "block";

  // Restore saved resume
  const savedResume = await loadResume();
  if (savedResume) {
    document.getElementById("resumeText").value = savedResume;
    const status = document.getElementById("resumeFileStatus");
    setStatus(status, `Resume loaded (${savedResume.length} characters) — upload a new file to replace.`, "ok");
  }

  // Restore last scanned jobs so popup reopening doesn't wipe the list
  const saved = await loadScannedJobs();
  if (saved.length) {
    scannedJobs = saved;
    renderResults();
    const scanStatus = document.getElementById("scanStatus");
    setStatus(scanStatus, `${scannedJobs.length} job(s) from your last scan — scan again to refresh.`, "");
  }
})();

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "contacts") renderFollowUps();
    if (btn.dataset.tab === "tracker") renderTracker();
  });
});

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = "status" + (kind ? ` ${kind}` : "");
}

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function getFilters() {
  return {
    titleKeyword: document.getElementById("titleKeyword").value.trim(),
    requiredKeywords: document.getElementById("requiredKeywords").value.trim(),
    excludeKeywords: document.getElementById("excludeKeywords").value.trim(),
    city: document.getElementById("city").value.trim(),
    minSalary: parseFloat(document.getElementById("minSalary").value) || null,
    maxAgeDays: parseFloat(document.getElementById("maxAgeDays").value) || null,
    includeNoSalary: document.getElementById("includeNoSalary").checked,
    hideSeen: document.getElementById("hideSeen").checked
  };
}

function hiddenNote(hiddenCount) {
  return hiddenCount ? ` (${hiddenCount} already exported, hidden)` : "";
}

// Shared by resume match, outreach drafting, and bulk scoring — one place
// that knows how to resolve which provider/key/model is active, and builds
// a fallback config if the user opted into combining both providers' quotas.
async function getAiSettings() {
  const settings = await chrome.storage.sync.get(["provider", "geminiKey", "groqKey", "geminiModel", "groqModel", "useFallback"]);
  const provider = settings.provider || "gemini";
  const apiKey = provider === "groq" ? settings.groqKey : settings.geminiKey;
  const model = provider === "groq" ? (settings.groqModel || "llama-3.3-70b-versatile") : (settings.geminiModel || "gemini-2.5-flash");

  let fallback = null;
  if (settings.useFallback) {
    const otherProvider = provider === "groq" ? "gemini" : "groq";
    const otherKey = otherProvider === "groq" ? settings.groqKey : settings.geminiKey;
    const otherModel = otherProvider === "groq" ? (settings.groqModel || "llama-3.3-70b-versatile") : (settings.geminiModel || "gemini-2.5-flash");
    if (otherKey) fallback = { provider: otherProvider, apiKey: otherKey, model: otherModel };
  }

  return { provider, apiKey, model, fallback };
}

function formatAge(postedAt) {
  if (!postedAt) return "";
  const days = Math.floor((Date.now() - new Date(postedAt).getTime()) / 86400000);
  if (Number.isNaN(days) || days < 0) return "";
  if (days === 0) return "Posted today";
  if (days === 1) return "Posted 1 day ago";
  if (days < 30) return `Posted ${days} days ago`;
  return `Posted ${Math.floor(days / 30)}mo ago`;
}

// Same identity logic as background.js's dedupe — kept as a small local
// copy since popup.js (a module) and background.js (a classic worker script)
// can't share code without extra build tooling for two lines of logic.
function jobIdentity(job) {
  return job.url || `${job.title}::${job.company}::${job.location}`;
}

// --- Score cache: avoid re-spending AI quota re-scoring the same job ---
// against the same resume across separate scan/search sessions.
const MAX_CACHE_ENTRIES = 1000;

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

async function getScoreCache() {
  try {
    const { scoreCache = {} } = await chrome.storage.sync.get("scoreCache");
    return scoreCache;
  } catch {
    return {};
  }
}

async function saveScoreCache(cache) {
  try {
    const entries = Object.entries(cache);
    const trimmed = entries.length > MAX_CACHE_ENTRIES
      ? Object.fromEntries(entries.sort((a, b) => (b[1].scoredAt || 0) - (a[1].scoredAt || 0)).slice(0, MAX_CACHE_ENTRIES))
      : cache;
    await chrome.storage.sync.set({ scoreCache: trimmed });
  } catch {
    // Cache is a nice-to-have; never let a storage hiccup break a scoring run that already succeeded.
  }
}

// --- Application tracker (Applied / Interviewing / Rejected / Offer) ---
// Stored in chrome.storage.sync, same as everything else here — follows you
// across devices, no server.
const MAX_TRACKED = 500;

async function getTrackedJobs() {
  const { trackedJobs = [] } = await chrome.storage.sync.get("trackedJobs");
  return trackedJobs;
}

async function updateTrackedStatus(key, status, defaults = {}) {
  const tracked = await getTrackedJobs();
  const idx = tracked.findIndex((t) => t.key === key);
  if (status === "") {
    if (idx !== -1) tracked.splice(idx, 1);
  } else if (idx !== -1) {
    tracked[idx] = { ...tracked[idx], status, statusUpdatedAt: new Date().toISOString() };
  } else {
    tracked.push({ key, status, statusUpdatedAt: new Date().toISOString(), ...defaults });
  }
  const trimmed = tracked.length > MAX_TRACKED ? tracked.slice(tracked.length - MAX_TRACKED) : tracked;
  await chrome.storage.sync.set({ trackedJobs: trimmed });
}

// --- Outreach log (for follow-up reminders) ---
const MAX_OUTREACH = 300;

async function getOutreachLog() {
  const { outreachLog = [] } = await chrome.storage.sync.get("outreachLog");
  return outreachLog;
}

async function logOutreachSent(person) {
  const log = await getOutreachLog();
  const key = person.profileUrl || person.name;
  const idx = log.findIndex((r) => r.key === key);
  const record = { key, name: person.name, profileUrl: person.profileUrl || "", sentAt: new Date().toISOString(), status: "sent" };
  if (idx !== -1) log[idx] = record;
  else log.push(record);
  const trimmed = log.length > MAX_OUTREACH ? log.slice(log.length - MAX_OUTREACH) : log;
  await chrome.storage.sync.set({ outreachLog: trimmed });
}

async function updateOutreachStatus(key, status) {
  const log = await getOutreachLog();
  const idx = log.findIndex((r) => r.key === key);
  if (idx === -1) return;
  if (status === "followed_up") {
    log[idx].sentAt = new Date().toISOString(); // resets the follow-up clock
    log[idx].status = "sent";
  } else {
    log[idx].status = status;
  }
  await chrome.storage.sync.set({ outreachLog: log });
}

const FOLLOW_UP_DAYS = 5;

async function renderFollowUps() {
  const log = await getOutreachLog();
  const now = Date.now();
  const due = log.filter((r) => r.status === "sent" && (now - new Date(r.sentAt).getTime()) / 86400000 >= FOLLOW_UP_DAYS);
  const container = document.getElementById("followUpsContainer");

  if (due.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="followup-banner">
      <strong>Follow up with ${due.length} ${due.length === 1 ? "person" : "people"}:</strong><br/>
      ${due.map((r) => {
        const daysAgo = Math.floor((now - new Date(r.sentAt).getTime()) / 86400000);
        return `${r.name} (sent ${daysAgo}d ago)
          <button class="mini-btn" data-key="${r.key}" data-action="followed_up">Mark followed up</button>
          <button class="mini-btn" data-key="${r.key}" data-action="responded">Got a reply</button>`;
      }).join("<br/>")}
    </div>
  `;

  container.querySelectorAll(".mini-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await updateOutreachStatus(btn.dataset.key, btn.dataset.action);
      renderFollowUps();
    });
  });
}

// --- Resume file upload (PDF/DOCX -> plain text) ---
async function extractTextFromPdf(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n\n");
}

async function extractTextFromDocx(arrayBuffer) {
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

document.getElementById("resumeFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const status = document.getElementById("resumeFileStatus");
  if (!file) return;

  setStatus(status, "Reading file…");
  try {
    const arrayBuffer = await file.arrayBuffer();
    let text;
    if (file.name.toLowerCase().endsWith(".pdf")) {
      text = await extractTextFromPdf(arrayBuffer);
    } else if (file.name.toLowerCase().endsWith(".docx")) {
      text = await extractTextFromDocx(arrayBuffer);
    } else {
      throw new Error("Only .pdf and .docx are supported (old .doc files: save as .docx first, or paste text).");
    }
    document.getElementById("resumeText").value = text.trim();
    await saveResume(text.trim());
    setStatus(status, `Loaded and saved ${file.name} (${text.trim().length} characters).`, "ok");
  } catch (err) {
    setStatus(status, err.message, "error");
  }
});

// Auto-save resume text whenever it's edited directly in the textarea
let resumeSaveTimer;
document.getElementById("resumeText").addEventListener("input", () => {
  clearTimeout(resumeSaveTimer);
  resumeSaveTimer = setTimeout(async () => {
    const text = document.getElementById("resumeText").value.trim();
    if (text.length > 100) await saveResume(text); // only save if it looks like real content
  }, 1500); // debounce — save 1.5s after they stop typing
});

// --- API job search ---
document.getElementById("apiSearchBtn").addEventListener("click", async () => {
  const status = document.getElementById("apiSearchStatus");
  const settings = await chrome.storage.sync.get(["jobApiProvider", "adzunaAppId", "adzunaAppKey", "jsearchKey"]);

  const filters = getFilters();

  const payload = {
    provider: settings.jobApiProvider || "adzuna",
    appId: settings.adzunaAppId,
    appKey: settings.adzunaAppKey,
    apiKey: settings.jsearchKey,
    keywords: document.getElementById("apiKeywords").value.trim(),
    location: document.getElementById("apiLocation").value.trim(),
    countryCode: document.getElementById("apiCountry").value.trim() || "in"
  };

  setStatus(status, "Searching…");
  const res = await sendMessage({ type: "SEARCH_JOB_API", payload, filters });

  if (!res.ok) {
    setStatus(status, res.error, "error");
    return;
  }

  scannedJobs = res.jobs;
  await saveScannedJobs(scannedJobs);
  setStatus(status, `Found ${scannedJobs.length} job(s) matching your filters.${hiddenNote(res.hiddenCount)}`, "ok");
  renderResults();
});

// --- Scan ---
document.getElementById("scanBtn").addEventListener("click", async () => {
  const scanStatus = document.getElementById("scanStatus");
  const filters = getFilters();

  setStatus(scanStatus, "Scanning the current page…");
  const res = await sendMessage({ type: "SCAN_ACTIVE_TAB", filters });

  if (!res.ok) {
    setStatus(scanStatus, res.error, "error");
    return;
  }

  scannedJobs = res.jobs;
  await saveScannedJobs(scannedJobs);
  setStatus(scanStatus, `Found ${scannedJobs.length} job(s) matching your filters.${hiddenNote(res.hiddenCount)}`, "ok");
  renderResults();
});

function scoreBadgeClass(score) {
  if (score >= 70) return "score-high";
  if (score >= 40) return "score-mid";
  return "score-low";
}

const STATUS_OPTIONS = [
  { value: "", label: "—" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
  { value: "rejected", label: "Rejected" },
  { value: "offer", label: "Offer" }
];

async function renderResults() {
  const container = document.getElementById("results");
  const tracked = await getTrackedJobs();
  const trackedByKey = Object.fromEntries(tracked.map((t) => [t.key, t.status]));

  container.innerHTML = "";
  scannedJobs.forEach((job, i) => {
    const row = document.createElement("div");
    row.className = "job-row";

    let metaLine;
    if (job.company || job.location) {
      metaLine = `${job.company || "Unknown company"} · ${job.location || "Location not listed"} · ${job.salary || "NA"}`;
    } else if (job.description) {
      metaLine = job.description.length > 140 ? job.description.slice(0, 140) + "…" : job.description;
    } else {
      metaLine = "No extra detail available";
    }

    const ageText = formatAge(job.postedAt);
    const scoreBadge = job.matchScore != null
      ? `<span class="score-tag ${scoreBadgeClass(job.matchScore)}" title="${job.scoreIsEstimate ? "Estimate based on limited job card text — paste the full JD in Resume Match for a precise score" : "Scored against full job description"}">${job.matchScore}%${job.scoreIsEstimate ? " ~est" : ""}</span>`
      : "";

    const currentStatus = trackedByKey[jobIdentity(job)] || "";
    const statusLabel = currentStatus
      ? STATUS_OPTIONS.find(o => o.value === currentStatus)?.label || "—"
      : "Track status";

    const statusOptionsHtml = STATUS_OPTIONS.map(
      (o) => `<option value="${o.value}" ${o.value === currentStatus ? "selected" : ""}>${o.label}</option>`
    ).join("");

    // Only show the dropdown visually prominent if a status is already set
    // Otherwise show as a small unobtrusive link that reveals on hover
    const statusClass = currentStatus
      ? `status-select status-set status-${currentStatus}`
      : "status-select status-unset";

    const scoreBtn = job.matchScore != null
      ? `<span class="score-tag ${scoreBadgeClass(job.matchScore)}">${job.matchScore}% fit</span>`
      : `<span class="use-jd score-one-btn" data-i="${i}">Score this job →</span>`;

    const analysisBtn = (job.matchScore != null && job.coverLetter)
      ? `<span class="use-jd send-analysis-btn" data-i="${i}">Send analysis to form →</span>`
      : "";

    row.innerHTML = `
      <input type="checkbox" class="job-check" data-i="${i}" checked />
      <div style="flex:1">
        <div class="job-title">${job.title} <span class="source-tag">${job.source}</span>${job.matchScore != null ? `<span class="score-tag ${scoreBadgeClass(job.matchScore)}">${job.matchScore}%${job.scoreIsEstimate ? " ~est" : ""}</span>` : ""}</div>
        <div class="job-meta">${metaLine}${ageText ? ` · <span class="age-tag">${ageText}</span>` : ""}</div>
        <div class="job-actions">
          <span class="use-jd" data-i="${i}">Use in resume match →</span>
          ${job.matchScore == null ? `<span class="use-jd score-one-btn" data-i="${i}">Score this job →</span>` : ""}
          ${analysisBtn}
          <select class="${statusClass}" data-i="${i}" title="Track your application status">${statusOptionsHtml}</select>
        </div>
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll(".use-jd:not(.score-one-btn):not(.send-analysis-btn)").forEach((el) => {
    el.addEventListener("click", () => {
      const job = scannedJobs[el.dataset.i];
      document.getElementById("jdText").value = `${job.title} at ${job.company}\n${job.location}\n${job.description || ""}`;
      document.querySelector('[data-tab="match"]').click();
    });
  });

  // Manual send-analysis button — always available on scored jobs as a fallback
  container.querySelectorAll(".send-analysis-btn").forEach((el) => {
    el.addEventListener("click", async () => {
      const job = scannedJobs[el.dataset.i];
      const aSettings = await chrome.storage.sync.get(["analysisFormId", "analysisFormFieldMap"]);
      if (!aSettings.analysisFormId) {
        el.textContent = "No analysis form set up in Settings";
        return;
      }
      el.textContent = "Sending…";
      const res = await sendMessage({
        type: "SUBMIT_ANALYSIS_TO_FORM",
        payload: { formId: aSettings.analysisFormId, fieldMap: aSettings.analysisFormFieldMap, job }
      });
      el.textContent = res.ok ? "Sent ✓" : "Failed — check Settings";
      setTimeout(() => { el.textContent = "Send analysis to form →"; }, 3000);
    });
  });

  // Per-job score button — scores just that one job without running all
  container.querySelectorAll(".score-one-btn").forEach((el) => {
    el.addEventListener("click", async () => {
      const i = parseInt(el.dataset.i);
      const job = scannedJobs[i];
      const resume = document.getElementById("resumeText").value.trim();

      if (!resume) {
        const scanStatus = document.getElementById("scanStatus");
        setStatus(scanStatus, "Add your resume in the 'Resume match' tab first.", "error");
        return;
      }

      el.textContent = "Scoring…";
      el.style.pointerEvents = "none";

      const { provider, apiKey, model, fallback } = await getAiSettings();

      // Use full JD from Resume Match tab if it matches this job — gives much
      // better analysis than just the scraped card text (which is usually empty)
      const jdBoxText = document.getElementById("jdText").value.trim();
      const jdBoxMatchesJob = jdBoxText && (
        jdBoxText.toLowerCase().includes(job.title.toLowerCase()) ||
        (job.company && jdBoxText.toLowerCase().includes(job.company.toLowerCase()))
      );
      const jobDescription = jdBoxMatchesJob
        ? jdBoxText
        : `${job.title} at ${job.company}\n${job.location}\n${job.description || ""}`;

      if (!jdBoxMatchesJob && (!job.description || job.description.length < 100)) {
        el.textContent = "For better results: paste the full JD in Resume Match tab first, then score";
        el.style.color = "#B7791F";
        await new Promise(r => setTimeout(r, 3000));
        el.style.color = "";
      }

      const res = await sendMessage({
        type: "RUN_RESUME_MATCH",
        payload: { provider, apiKey, model, fallback, resume, jobDescription, mode: "full" }
      });

      if (res.ok) {
        job.matchScore = res.result.match_score;
        job.missingSkills = res.result.missing_skills || [];
        job.matchingSkills = res.result.matching_skills || [];
        job.resumeSuggestions = res.result.resume_suggestions || [];
        job.coverLetter = res.result.cover_letter || "";
        job.scoreIsEstimate = !jdBoxMatchesJob && (!job.description || job.description.length < 200);
        await saveScannedJobs(scannedJobs);

        // Auto-submit to analysis form if configured
        const aSettings = await chrome.storage.sync.get(["analysisFormId", "analysisFormFieldMap"]);
        if (aSettings.analysisFormId && aSettings.analysisFormFieldMap && Object.keys(aSettings.analysisFormFieldMap).length > 0) {
          const analysisSent = await sendMessage({
            type: "SUBMIT_ANALYSIS_TO_FORM",
            payload: { formId: aSettings.analysisFormId, fieldMap: aSettings.analysisFormFieldMap, job }
          });
          el.textContent = analysisSent.ok
            ? `${job.matchScore}% — analysis sent to sheet ✓`
            : `${job.matchScore}% — analysis form send failed`;
        } else {
          el.textContent = `${job.matchScore}% fit`;
        }
        el.style.pointerEvents = "auto";

        // Auto-update the sheet row if sheet is configured
        if (job.url) {
          const settings = await chrome.storage.sync.get(["spreadsheetId", "sheetName"]);
          if (settings.spreadsheetId) {
            sendMessage({
              type: "UPDATE_JOB_SCORE_IN_SHEET",
              payload: {
                spreadsheetId: settings.spreadsheetId,
                sheetName: settings.sheetName || "Sheet1",
                jobUrl: job.url,
                matchScore: job.matchScore,
                missingSkills: job.missingSkills
              }
            });
          }
        }
        await renderResults();
      } else {
        el.textContent = "Score failed — try again";
        el.style.pointerEvents = "auto";
      }
    });
  });

  container.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const job = scannedJobs[sel.dataset.i];
      await updateTrackedStatus(jobIdentity(job), sel.value, {
        title: job.title, company: job.company, location: job.location, url: job.url
      });

      // Auto-sync to Google Sheet if one is configured — fire and forget
      if (job.url && sel.value) {
        const settings = await chrome.storage.sync.get(["spreadsheetId", "sheetName"]);
        if (settings.spreadsheetId) {
          sendMessage({
            type: "UPDATE_JOB_STATUS",
            payload: {
              spreadsheetId: settings.spreadsheetId,
              sheetName: settings.sheetName || "Sheet1",
              jobUrl: job.url,
              status: sel.value
            }
          });
        }
      }

      // Re-render just this row so the dropdown colour updates immediately
      await renderResults();
    });
  });

  document.getElementById("pushBtn").disabled = scannedJobs.length === 0;
  document.getElementById("csvBtn").disabled = scannedJobs.length === 0;
  document.getElementById("formBtn").disabled = scannedJobs.length === 0;
  document.getElementById("scoreAllBtn").disabled = scannedJobs.length === 0;
  document.getElementById("analysisBtn").disabled = !scannedJobs.some(j => j.matchScore != null);
}

async function renderTracker() {
  const tracked = await getTrackedJobs();
  const counts = { applied: 0, interviewing: 0, rejected: 0, offer: 0 };
  tracked.forEach((t) => { if (counts[t.status] !== undefined) counts[t.status]++; });

  document.getElementById("trackerSummary").textContent =
    `Applied: ${counts.applied} · Interviewing: ${counts.interviewing} · Rejected: ${counts.rejected} · Offer: ${counts.offer}`;

  const sorted = [...tracked].sort((a, b) => new Date(b.statusUpdatedAt) - new Date(a.statusUpdatedAt));
  const container = document.getElementById("trackerList");

  if (sorted.length === 0) {
    container.innerHTML = `<p class="hint">Nothing tracked yet — set a status on any job in the "Find jobs" tab.</p>`;
    return;
  }

  container.innerHTML = sorted.map((t) => `
    <div class="job-row">
      <div style="flex:1">
        <div class="job-title">${t.title || "(untitled)"}</div>
        <div class="job-meta">${t.company || ""}${t.url ? ` · <a href="${t.url}" target="_blank">link</a>` : ""}</div>
      </div>
      <select class="status-select tracker-status-select" data-key="${t.key}">
        <option value="applied" ${t.status === "applied" ? "selected" : ""}>Applied</option>
        <option value="interviewing" ${t.status === "interviewing" ? "selected" : ""}>Interviewing</option>
        <option value="rejected" ${t.status === "rejected" ? "selected" : ""}>Rejected</option>
        <option value="offer" ${t.status === "offer" ? "selected" : ""}>Offer</option>
        <option value="">Remove</option>
      </select>
    </div>
  `).join("");

  container.querySelectorAll(".tracker-status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      await updateTrackedStatus(sel.dataset.key, sel.value);
      renderTracker();
    });
  });
}

// --- Score all scanned jobs against the resume, sort by fit ---
document.getElementById("scoreAllBtn").addEventListener("click", async () => {
  const status = document.getElementById("scoreAllStatus");
  const resume = document.getElementById("resumeText").value.trim();

  if (!resume) {
    setStatus(status, "Add your resume in the 'Resume match' tab first.", "error");
    return;
  }

  const { provider, apiKey, model, fallback } = await getAiSettings();
  if (!apiKey) {
    setStatus(status, "No API key set yet — add one in Settings.", "error");
    return;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cache = await getScoreCache();
  let failures = 0;
  let cached = 0;

  for (let i = 0; i < scannedJobs.length; i++) {
    const job = scannedJobs[i];
    const cacheKey = jobIdentity(job);
    const hit = cache[cacheKey];

    // A job already scored against this exact resume in a prior session
    // doesn't need a fresh call — saves real quota on re-scans/re-searches.
    if (hit && hit.resumeHash === hashString(resume)) {
      job.matchScore = hit.matchScore;
      job.missingSkills = hit.missingSkills;
      job.matchingSkills = hit.matchingSkills || [];
      cached++;
      continue;
    }

    setStatus(status, `Scoring ${i + 1} of ${scannedJobs.length}…`);
    const jobDescription = `${job.title} at ${job.company}\n${job.location}\n${job.description || ""}`;
    try {
      const res = await sendMessage({
        type: "RUN_RESUME_MATCH",
        payload: { provider, apiKey, model, fallback, resume, jobDescription, mode: "quick" }
      });
      if (res.ok) {
        job.matchScore = res.result.match_score;
        job.missingSkills = res.result.missing_skills || [];
        job.matchingSkills = res.result.matching_skills || [];
        job.resumeSuggestions = res.result.resume_suggestions || [];
        job.coverLetter = res.result.cover_letter || "";
        // quick mode doesn't return suggestions/cover letter — that's intentional
        job.scoreIsEstimate = !jdBoxMatchesJob && (!job.description || job.description.length < 200);
        cache[cacheKey] = {
          matchScore: job.matchScore,
          missingSkills: job.missingSkills,
          matchingSkills: job.matchingSkills,
          resumeHash: hashString(resume),
          scoredAt: Date.now()
        };
      } else {
        failures++;
      }
    } catch {
      failures++;
    }
    if (i < scannedJobs.length - 1) await sleep(2000); // free-tier per-minute limits can be very low — pace requests out
  }

  await saveScoreCache(cache);

  scannedJobs.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
  await saveScannedJobs(scannedJobs);
  const failNote = failures > 0 ? ` — ${failures} failed (likely hit your AI provider's daily/rate limit)` : "";
  const cacheNote = cached > 0 ? ` (${cached} reused from a previous scoring run, no quota used)` : "";
  setStatus(status, `Scored ${scannedJobs.length - failures} of ${scannedJobs.length} job(s)${cacheNote}${failNote} — sorted by fit.`, failures > 0 ? "error" : "ok");
  renderResults();
});

function getCheckedJobs() {
  return Array.from(document.querySelectorAll(".job-check:checked")).map((cb) => scannedJobs[cb.dataset.i]);
}

function csvEscape(field) {
  const s = String(field ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// --- CSV download (works with zero setup) ---
document.getElementById("csvBtn").addEventListener("click", async () => {
  const pushStatus = document.getElementById("pushStatus");
  const checked = getCheckedJobs();
  if (checked.length === 0) {
    setStatus(pushStatus, "Select at least one job first.", "error");
    return;
  }

  // Pull current tracked statuses so they show in the CSV
  const tracked = await getTrackedJobs();
  const trackedByKey = Object.fromEntries(tracked.map((t) => [t.key, t.status]));

  const header = ["Title", "Company", "Location", "Salary", "Source", "URL", "Fit Score", "Missing Skills", "Resume Suggestions", "Status"];
  const rows = checked.map((j) => {
    const status = trackedByKey[jobIdentity(j)] || "";
    const statusLabel = STATUS_OPTIONS.find(o => o.value === status)?.label || "";
    return [
      j.title,
      j.company,
      j.location,
      j.salary || "NA",
      j.source,
      j.url,
      j.matchScore != null ? `${j.matchScore}%${j.scoreIsEstimate ? " (estimate)" : ""}` : "Not scored",
      (j.missingSkills || []).length ? j.missingSkills.join("\n") : j.matchScore != null ? "None" : "—",
      (j.resumeSuggestions || []).length ? j.resumeSuggestions.join("\n") : "—",
      statusLabel
    ];
  });

  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "jobtrail-results.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus(pushStatus, `Downloaded ${checked.length} job(s) as CSV.`, "ok");
  sendMessage({ type: "MARK_JOBS_SEEN", jobs: checked });
});

// --- Download Full Analysis CSV (per-job detailed breakdown) ---
document.getElementById("analysisBtn").addEventListener("click", async () => {
  const pushStatus = document.getElementById("pushStatus");
  const scored = scannedJobs.filter(j => j.matchScore != null);

  if (scored.length === 0) {
    setStatus(pushStatus, "Score at least one job first — use 'Score this job →' or 'Score all against my resume'.", "error");
    return;
  }

  const tracked = await getTrackedJobs();
  const trackedByKey = Object.fromEntries(tracked.map((t) => [t.key, t.status]));

  // Build a detailed multi-section CSV:
  // Each job gets a header row + detail rows so it reads well in a spreadsheet.
  // Section rows are prefixed with their type so you can filter by column A.
  const rows = [];
  rows.push(["Section", "Job Title", "Company", "URL", "Fit Score", "Status", "Detail"]);

  for (const j of scored) {
    const status = trackedByKey[jobIdentity(j)] || "";
    const statusLabel = STATUS_OPTIONS.find(o => o.value === status)?.label || "";
    const score = `${j.matchScore}%${j.scoreIsEstimate ? " (estimate)" : ""}`;

    // Summary row
    rows.push(["SUMMARY", j.title, j.company, j.url, score, statusLabel, ""]);

    // Matching skills — one row each
    (j.matchingSkills || j.matching_skills || []).forEach(skill => {
      rows.push(["MATCHING SKILL", j.title, j.company, "", "", "", skill]);
    });

    // Missing skills — one row each
    (j.missingSkills || []).forEach(skill => {
      rows.push(["MISSING SKILL", j.title, j.company, "", "", "", skill]);
    });

    // Resume suggestions — one row each
    (j.resumeSuggestions || []).forEach((suggestion, idx) => {
      rows.push([`RESUME SUGGESTION ${idx + 1}`, j.title, j.company, "", "", "", suggestion]);
    });

    // Cover letter — single cell (may be long)
    if (j.coverLetter) {
      rows.push(["COVER LETTER", j.title, j.company, "", "", "", j.coverLetter]);
    }

    // Blank separator row between jobs
    rows.push(["---", "", "", "", "", "", ""]);
  }

  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "jobtrail-analysis.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus(pushStatus, `Downloaded full analysis for ${scored.length} scored job(s).`, "ok");
});
document.getElementById("formBtn").addEventListener("click", async () => {
  const pushStatus = document.getElementById("pushStatus");
  const btn = document.getElementById("formBtn");
  const checked = getCheckedJobs();
  if (checked.length === 0) {
    setStatus(pushStatus, "Select at least one job first.", "error");
    return;
  }

  const settings = await chrome.storage.sync.get(["googleFormId", "googleFormFieldMap"]);
  if (!settings.googleFormId) {
    setStatus(pushStatus, "No Google Form connected yet — set one up in Settings.", "error");
    return;
  }

  // Disable button immediately to prevent double/triple submission
  btn.disabled = true;

  const tracked = await getTrackedJobs();
  const trackedByKey = Object.fromEntries(tracked.map((t) => [t.key, t.status]));
  const jobsWithStatus = checked.map(j => ({
    ...j,
    status: trackedByKey[jobIdentity(j)] || ""
  }));

  setStatus(pushStatus, `Sending ${checked.length} job(s)… please wait.`);
  const res = await sendMessage({
    type: "PUSH_TO_FORM",
    payload: { formId: settings.googleFormId, fieldMap: settings.googleFormFieldMap, jobs: jobsWithStatus }
  });

  btn.disabled = false;

  if (!res.ok) {
    setStatus(pushStatus, res.error, "error");
  } else {
    const submitted = res.result?.submitted ?? checked.length;
    const skipped = res.result?.skipped ?? 0;
    const skipNote = skipped > 0 ? ` (${skipped} already sent before, skipped)` : "";
    if (submitted === 0) {
      setStatus(pushStatus, `All ${skipped} job(s) already in your form — no duplicates added.`, "ok");
    } else {
      setStatus(pushStatus, `Sent ${submitted} job(s)${skipNote} — check your linked spreadsheet.`, "ok");
      sendMessage({ type: "MARK_JOBS_SEEN", jobs: jobsWithStatus });
    }
  }
});

// --- Push to sheet ---
document.getElementById("pushBtn").addEventListener("click", async () => {
  const pushStatus = document.getElementById("pushStatus");
  const btn = document.getElementById("pushBtn");
  const settings = await chrome.storage.sync.get(["spreadsheetId", "sheetName"]);

  if (!settings.spreadsheetId) {
    setStatus(pushStatus, "Set a spreadsheet ID in Settings first.", "error");
    return;
  }

  const checked = getCheckedJobs();
  if (checked.length === 0) {
    setStatus(pushStatus, "Select at least one job first.", "error");
    return;
  }

  btn.disabled = true;

  const tracked = await getTrackedJobs();
  const trackedByKey = Object.fromEntries(tracked.map((t) => [t.key, t.status]));
  const jobsWithStatus = checked.map(j => ({
    ...j,
    status: trackedByKey[jobIdentity(j)] || ""
  }));

  setStatus(pushStatus, `Writing ${checked.length} job(s) to your sheet…`);
  const res = await sendMessage({
    type: "PUSH_TO_SHEET",
    payload: {
      spreadsheetId: settings.spreadsheetId,
      sheetName: settings.sheetName || "Sheet1",
      jobs: jobsWithStatus
    }
  });

  btn.disabled = false;

  if (!res.ok) {
    setStatus(pushStatus, res.error, "error");
  } else {
    setStatus(pushStatus, `Added ${checked.length} job(s) to your sheet.`, "ok");
    sendMessage({ type: "MARK_JOBS_SEEN", jobs: jobsWithStatus });
  }
});

// --- Find contacts (referrals) ---
document.getElementById("scanContactsBtn").addEventListener("click", async () => {
  const status = document.getElementById("contactsStatus");
  setStatus(status, "Scanning the current page…");
  const res = await sendMessage({ type: "SCAN_CONTACTS" });

  if (!res.ok) {
    setStatus(status, res.error, "error");
    return;
  }

  setStatus(status, `Found ${res.people.length} people.`, "ok");
  renderContacts(res.people);
});

function renderContacts(people) {
  const container = document.getElementById("contactResults");

  // Dedupe by URL first, then by name — covers cases where profile link wasn't captured
  const seenUrls = new Set();
  const seenNames = new Set();
  const unique = [];

  for (const p of people) {
    const urlKey = p.profileUrl ? p.profileUrl.replace(/\/$/, "").toLowerCase() : null;
    const nameKey = p.name ? p.name.trim().toLowerCase() : null;

    if (urlKey && seenUrls.has(urlKey)) continue;
    if (nameKey && seenNames.has(nameKey)) continue;

    if (urlKey) seenUrls.add(urlKey);
    if (nameKey) seenNames.add(nameKey);
    unique.push(p);
  }

  const shown = [...unique]
    .sort((a, b) => (b.mutualCount || 0) - (a.mutualCount || 0))
    .slice(0, 6);

  container.dataset.people = JSON.stringify(shown);
  container.innerHTML = "";

  if (shown.length === 0) {
    container.innerHTML = `<p class="hint">No contacts found. Make sure you're on LinkedIn's People search results tab (not Jobs or Posts).</p>`;
    return;
  }

  shown.forEach((person, i) => {
    const row = document.createElement("div");
    row.className = "job-row";
    const mutualNote = person.mutualCount > 0 ? ` · ${person.mutualCount} mutual` : "";
    row.innerHTML = `
      <div style="flex:1">
        <div class="job-title">${person.name}</div>
        <div class="job-meta">${person.headline || ""}${person.location ? " · " + person.location : ""}${mutualNote}</div>
        ${person.profileUrl ? `<a href="${person.profileUrl}" target="_blank" class="use-jd">View profile ↗</a> · ` : ""}
        <span class="use-jd draft-btn" data-i="${i}">Draft message →</span>
        <div class="draft-output" id="draft-${i}"></div>
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll(".draft-btn").forEach((el) => {
    el.addEventListener("click", () => draftOutreach(el.dataset.i));
  });
}

async function draftOutreach(index) {
  const container = document.getElementById("contactResults");
  const people = JSON.parse(container.dataset.people);
  const person = people[index];
  const out = document.getElementById(`draft-${index}`);
  out.textContent = "Drafting…";

  const role = document.getElementById("contactRole").value.trim();
  const { provider, apiKey, model, fallback } = await getAiSettings();

  const res = await sendMessage({
    type: "DRAFT_OUTREACH",
    payload: {
      provider, apiKey, model, fallback,
      contactName: person.name,
      contactHeadline: person.headline,
      role: role || "similar roles",
      context: ""
    }
  });

  if (!res.ok) {
    out.textContent = res.error;
    return;
  }

  out.innerHTML = `<textarea readonly>${res.text}</textarea><button class="secondary copy-btn">Copy</button><button class="secondary sent-btn">Mark as sent</button>`;
  out.querySelector(".copy-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(res.text);
  });
  out.querySelector(".sent-btn").addEventListener("click", async () => {
    await logOutreachSent(person);
    out.querySelector(".sent-btn").textContent = "Logged — I'll remind you to follow up";
    out.querySelector(".sent-btn").disabled = true;
  });
}

// --- Resume match ---
document.getElementById("matchBtn").addEventListener("click", async () => {
  const matchStatus = document.getElementById("matchStatus");
  const resume = document.getElementById("resumeText").value.trim();
  const jobDescription = document.getElementById("jdText").value.trim();

  if (!resume || !jobDescription) {
    setStatus(matchStatus, "Add both your resume and a job description.", "error");
    return;
  }

  const { provider, apiKey, model, fallback } = await getAiSettings();

  setStatus(matchStatus, "Analyzing… this can take a few seconds.");
  const res = await sendMessage({
    type: "RUN_RESUME_MATCH",
    payload: { provider, apiKey, model, fallback, resume, jobDescription }
  });

  if (!res.ok) {
    setStatus(matchStatus, res.error, "error");
    return;
  }

  setStatus(matchStatus, "Done.", "ok");
  renderMatchResult(res.result);

  // If this analysis was for a specific job (user clicked "Use in resume match"),
  // store the full result back on that job and auto-submit to analysis form
  const jdText = document.getElementById("jdText").value;
  const matchedJob = scannedJobs.find(j =>
    jdText.includes(j.title) && jdText.includes(j.company)
  );
  if (matchedJob) {
    matchedJob.matchScore = res.result.match_score;
    matchedJob.matchingSkills = res.result.matching_skills || [];
    matchedJob.missingSkills = res.result.missing_skills || [];
    matchedJob.resumeSuggestions = res.result.resume_suggestions || [];
    matchedJob.coverLetter = res.result.cover_letter || "";
    matchedJob.scoreIsEstimate = false; // full JD was used
    await saveScannedJobs(scannedJobs);
    renderResults();

    // Auto-submit to analysis form
    const aSettings = await chrome.storage.sync.get(["analysisFormId", "analysisFormFieldMap"]);
    if (aSettings.analysisFormId) {
      sendMessage({
        type: "SUBMIT_ANALYSIS_TO_FORM",
        payload: { formId: aSettings.analysisFormId, fieldMap: aSettings.analysisFormFieldMap, job: matchedJob }
      });
      setStatus(matchStatus, "Done. Analysis sent to your Analysis Form sheet.", "ok");
    }
  }
});

function renderMatchResult(result) {
  const container = document.getElementById("matchResult");
  container.innerHTML = `
    <div class="score">${result.match_score}/100</div>
    <h3>Matching skills</h3>
    <ul>${(result.matching_skills || []).map((s) => `<li>${s}</li>`).join("") || "<li>None found</li>"}</ul>
    <h3>Missing skills</h3>
    <ul>${(result.missing_skills || []).map((s) => `<li>${s}</li>`).join("") || "<li>None found</li>"}</ul>
    <h3>Resume suggestions</h3>
    <ul>${(result.resume_suggestions || []).map((s) => `<li>${s}</li>`).join("") || "<li>None</li>"}</ul>
    <h3>Cover letter draft</h3>
    <textarea readonly>${result.cover_letter || ""}</textarea>
  `;
}
