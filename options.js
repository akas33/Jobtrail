const FIELDS = [
  "provider", "geminiKey", "geminiModel", "groqKey", "groqModel", "useFallback",
  "jobApiProvider", "adzunaAppId", "adzunaAppKey", "jsearchKey",
  "spreadsheetId", "sheetName"
];

async function load() {
  const settings = await chrome.storage.sync.get(FIELDS);
  FIELDS.forEach((f) => {
    const el = document.getElementById(f);
    if (!el || settings[f] === undefined) return;
    if (el.type === "checkbox") el.checked = !!settings[f];
    else el.value = settings[f];
  });
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  const settings = {};
  FIELDS.forEach((f) => {
    const el = document.getElementById(f);
    settings[f] = el.type === "checkbox" ? el.checked : el.value.trim();
  });
  await chrome.storage.sync.set(settings);
  const status = document.getElementById("saveStatus");
  status.textContent = "Saved.";
  status.className = "status ok";
  setTimeout(() => (status.textContent = ""), 2000);
});

document.getElementById("connectBtn").addEventListener("click", () => {
  const status = document.getElementById("connectStatus");
  status.textContent = "Opening Google sign-in…";
  status.className = "status";
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (chrome.runtime.lastError || !token) {
      status.textContent = chrome.runtime.lastError?.message || "Could not connect.";
      status.className = "status error";
    } else {
      status.textContent = "Connected.";
      status.className = "status ok";
    }
  });
});

const PLACEHOLDER_TO_KEY = {
  // Form 1 — Jobs
  JC_JOBID:    "jobid",
  JC_TITLE:    "title",
  JC_COMPANY:  "company",
  JC_LOCATION: "location",
  JC_SALARY:   "salary",
  JC_SOURCE:   "source",
  JC_URL:      "url",
  JC_FITSCORE: "fitscore",
  JC_MATCHING: "matching",
  JC_MISSING:  "missing",
  JC_STATUS:   "status",
  // Form 2 — Analysis
  JC_SUGGESTIONS:  "suggestions",
  JC_COVERLETTER:  "coverletter"
};

function parseFormLink(link) {
  let parsed;
  try {
    parsed = new URL(link);
  } catch {
    throw new Error("That doesn't look like a valid link — paste the full URL you copied from 'Get pre-filled link'.");
  }

  const match = parsed.pathname.match(/\/forms\/d\/e\/([^/]+)\/viewform/);
  if (!match) {
    throw new Error("Couldn't find a form ID in that link. Make sure you copied the full 'Get pre-filled link' URL.");
  }

  const fieldMap = {};
  for (const [param, value] of parsed.searchParams.entries()) {
    if (param.startsWith("entry.") && PLACEHOLDER_TO_KEY[value]) {
      fieldMap[PLACEHOLDER_TO_KEY[value]] = param;
    }
  }

  if (Object.keys(fieldMap).length === 0) {
    throw new Error("No placeholders detected — did you type the exact JC_... text into each question before copying the link?");
  }

  return { formId: match[1], fieldMap };
}

document.getElementById("parseFormBtn").addEventListener("click", async () => {
  const status = document.getElementById("formStatus");
  const link = document.getElementById("formPrefillLink").value.trim();

  try {
    const { formId, fieldMap } = parseFormLink(link);
    await chrome.storage.sync.set({ googleFormId: formId, googleFormFieldMap: fieldMap });
    const count = Object.keys(fieldMap).length;
    status.textContent = `Saved — ${count} field(s) detected: ${Object.keys(fieldMap).join(", ")}. Missing skills/matching/fitscore fields? Add those questions to your form and re-paste a new pre-fill link.`;
    status.className = count >= 3 ? "status ok" : "status error";
  } catch (err) {
    status.textContent = err.message;
    status.className = "status error";
  }
});

async function checkFormStatus() {
  const { googleFormId, googleFormFieldMap } = await chrome.storage.sync.get(["googleFormId", "googleFormFieldMap"]);
  if (googleFormId) {
    const count = Object.keys(googleFormFieldMap || {}).length;
    const status = document.getElementById("formStatus");
    status.textContent = `Jobs form connected (${count} field(s) detected).`;
    status.className = "status ok";
  }
}
checkFormStatus();

document.getElementById("testKeyBtn").addEventListener("click", async () => {
  const status = document.getElementById("testKeyStatus");
  const provider = document.getElementById("provider").value;
  const apiKey = provider === "groq" ? document.getElementById("groqKey").value.trim() : document.getElementById("geminiKey").value.trim();
  const model = provider === "groq"
    ? (document.getElementById("groqModel").value.trim() || "llama-3.3-70b-versatile")
    : (document.getElementById("geminiModel").value.trim() || "gemini-2.5-flash");

  if (!apiKey) {
    status.textContent = "Paste a key above first.";
    status.className = "status error";
    return;
  }

  status.textContent = "Testing…";
  status.className = "status";
  const res = await chrome.runtime.sendMessage({ type: "TEST_AI_KEY", payload: { provider, apiKey, model } });
  if (res.ok) {
    status.textContent = "Key works.";
    status.className = "status ok";
  } else {
    status.textContent = res.error;
    status.className = "status error";
  }
});

document.getElementById("testJobApiBtn").addEventListener("click", async () => {
  const status = document.getElementById("testJobApiStatus");
  const provider = document.getElementById("jobApiProvider").value;
  const payload = {
    provider,
    appId: document.getElementById("adzunaAppId").value.trim(),
    appKey: document.getElementById("adzunaAppKey").value.trim(),
    apiKey: document.getElementById("jsearchKey").value.trim(),
    countryCode: "in"
  };

  status.textContent = "Testing…";
  status.className = "status";
  const res = await chrome.runtime.sendMessage({ type: "TEST_JOB_API", payload });
  if (res.ok) {
    status.textContent = "Connection works.";
    status.className = "status ok";
  } else {
    status.textContent = res.error;
    status.className = "status error";
  }
});

document.getElementById("parseAnalysisFormBtn").addEventListener("click", async () => {
  const status = document.getElementById("analysisFormStatus");
  const link = document.getElementById("analysisFormPrefillLink").value.trim();
  try {
    const { formId, fieldMap } = parseFormLink(link);
    await chrome.storage.sync.set({ analysisFormId: formId, analysisFormFieldMap: fieldMap });
    const count = Object.keys(fieldMap).length;
    status.textContent = `Saved — ${count} of 3 fields detected: ${Object.keys(fieldMap).join(", ")}.${count < 3 ? " Missing fields will be left blank." : " All fields mapped correctly."}`;
    status.className = count >= 2 ? "status ok" : "status error";
  } catch (err) {
    status.textContent = err.message;
    status.className = "status error";
  }
});

async function checkAnalysisFormStatus() {
  const { analysisFormId, analysisFormFieldMap } = await chrome.storage.sync.get(["analysisFormId", "analysisFormFieldMap"]);
  if (analysisFormId) {
    const count = Object.keys(analysisFormFieldMap || {}).length;
    const status = document.getElementById("analysisFormStatus");
    status.textContent = `Analysis form connected (${count} of 3 fields). Auto-submits when you score a job.`;
    status.className = "status ok";
    document.getElementById("analysisFormPrefillLink").value = "";
  }
}
checkAnalysisFormStatus();

document.getElementById("clearHistoryBtn").addEventListener("click", async () => {
  await chrome.storage.sync.remove("seenJobHashes");
  const status = document.getElementById("clearHistoryStatus");
  status.textContent = "Cleared. Previously exported jobs will show up again, on every device signed into this Chrome profile.";
  status.className = "status ok";
});

load();
