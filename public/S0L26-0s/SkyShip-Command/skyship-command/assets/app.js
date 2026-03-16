const STORAGE_KEY = "skyship-command-state-v1";

const state = {
  zipFile: null,
  zipObject: null,
  entries: [],
  treePreview: [],
  suggestedDeployRoot: "",
  logs: [],
  results: {},
  running: false,
};

const $ = (id) => document.getElementById(id);

const els = {};

function bindElements() {
  [
    "dropzone",
    "zip-input",
    "stat-zip-name",
    "stat-file-count",
    "stat-deploy-root",
    "stat-top-folders",
    "git-root",
    "deploy-root",
    "tree-preview",
    "tree-meta",
    "enable-github",
    "enable-netlify",
    "enable-cloudflare",
    "github-token",
    "github-owner",
    "github-repo",
    "github-branch",
    "github-message",
    "netlify-token",
    "netlify-site-id",
    "netlify-title",
    "cloudflare-token",
    "cloudflare-account-id",
    "cloudflare-project",
    "cloudflare-branch",
    "openai-key",
    "openai-model",
    "ai-question",
    "ai-response",
    "activity-log",
    "result-cards",
    "run-selected-btn",
    "github-only-btn",
    "netlify-only-btn",
    "cloudflare-only-btn",
    "ask-ai-btn",
    "run-state-badge",
    "reset-session-btn",
  ].forEach((id) => {
    els[id] = $(id);
  });
}

function timestamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function appendLog(message, kind = "info") {
  state.logs.unshift({ time: timestamp(), message, kind });
  renderLog();
}

function renderLog() {
  els["activity-log"].innerHTML = state.logs
    .map(
      (item) => `<div class="log-entry"><span class="log-time">${item.time}</span> · ${escapeHtml(item.message)}</div>`
    )
    .join("") || `<div class="empty-state">Nothing has happened yet.</div>`;
}

function renderResults() {
  const resultEntries = Object.entries(state.results);
  if (!resultEntries.length) {
    els["result-cards"].innerHTML = "Nothing has shipped yet.";
    els["result-cards"].classList.add("empty-state");
    return;
  }
  els["result-cards"].classList.remove("empty-state");
  els["result-cards"].innerHTML = resultEntries
    .map(([key, result]) => {
      const fields = [];
      Object.entries(result || {}).forEach(([field, value]) => {
        if (value === null || value === undefined || value === "") return;
        if (typeof value === "string" && /^https?:\/\//i.test(value)) {
          fields.push(`<div><strong>${escapeHtml(field)}:</strong> <a href="${escapeAttr(value)}" target="_blank" rel="noreferrer">open</a></div>`);
        } else if (typeof value !== "object") {
          fields.push(`<div><strong>${escapeHtml(field)}:</strong> ${escapeHtml(String(value))}</div>`);
        }
      });
      return `<article class="result-card"><h4>${escapeHtml(key)}</h4>${fields.join("")}</article>`;
    })
    .join("");
}

function setRunState(label, mode) {
  const badge = els["run-state-badge"];
  badge.textContent = label;
  badge.className = `badge ${mode}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function normalizeRoot(input) {
  const raw = String(input || "").trim().replace(/^\.\//, "").replace(/^\//, "");
  if (!raw) return "";
  return raw.replace(/\/+$/g, "");
}

function shouldIgnorePath(path) {
  const ignored = [
    /^__MACOSX\//,
    /(?:^|\/)\.DS_Store$/,
    /(?:^|\/)Thumbs\.db$/,
    /(?:^|\/)\.git\//,
  ];
  return ignored.some((pattern) => pattern.test(path));
}

function humanBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes || 0);
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function base64FromUint8(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function guessDeployRoot(paths) {
  const candidates = ["dist", "build", "out", "public", "www"];
  const score = new Map();
  for (const path of paths) {
    for (const candidate of candidates) {
      const prefix = `${candidate}/`;
      if (path.startsWith(prefix)) score.set(candidate, (score.get(candidate) || 0) + 1);
      const nested = path.match(new RegExp(`^([^/]+/${candidate})/`));
      if (nested?.[1]) score.set(nested[1], (score.get(nested[1]) || 0) + 1);
    }
  }
  const sorted = [...score.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || "";
}

function topFolders(paths) {
  const counts = new Map();
  for (const path of paths) {
    const top = path.split("/")[0] || "(root)";
    counts.set(top, (counts.get(top) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([folder, count]) => `${folder} (${count})`);
}

function saveSettings() {
  const snapshot = {
    gitRoot: els["git-root"].value,
    deployRoot: els["deploy-root"].value,
    enableGithub: els["enable-github"].checked,
    enableNetlify: els["enable-netlify"].checked,
    enableCloudflare: els["enable-cloudflare"].checked,
    githubToken: els["github-token"].value,
    githubOwner: els["github-owner"].value,
    githubRepo: els["github-repo"].value,
    githubBranch: els["github-branch"].value,
    githubMessage: els["github-message"].value,
    netlifyToken: els["netlify-token"].value,
    netlifySiteId: els["netlify-site-id"].value,
    netlifyTitle: els["netlify-title"].value,
    cloudflareToken: els["cloudflare-token"].value,
    cloudflareAccountId: els["cloudflare-account-id"].value,
    cloudflareProject: els["cloudflare-project"].value,
    cloudflareBranch: els["cloudflare-branch"].value,
    openaiKey: els["openai-key"].value,
    openaiModel: els["openai-model"].value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function restoreSettings() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    els["git-root"].value = snapshot.gitRoot || "";
    els["deploy-root"].value = snapshot.deployRoot || "";
    els["enable-github"].checked = snapshot.enableGithub ?? true;
    els["enable-netlify"].checked = snapshot.enableNetlify ?? true;
    els["enable-cloudflare"].checked = snapshot.enableCloudflare ?? false;
    els["github-token"].value = snapshot.githubToken || "";
    els["github-owner"].value = snapshot.githubOwner || "";
    els["github-repo"].value = snapshot.githubRepo || "";
    els["github-branch"].value = snapshot.githubBranch || "main";
    els["github-message"].value = snapshot.githubMessage || "";
    els["netlify-token"].value = snapshot.netlifyToken || "";
    els["netlify-site-id"].value = snapshot.netlifySiteId || "";
    els["netlify-title"].value = snapshot.netlifyTitle || "";
    els["cloudflare-token"].value = snapshot.cloudflareToken || "";
    els["cloudflare-account-id"].value = snapshot.cloudflareAccountId || "";
    els["cloudflare-project"].value = snapshot.cloudflareProject || "";
    els["cloudflare-branch"].value = snapshot.cloudflareBranch || "";
    els["openai-key"].value = snapshot.openaiKey || "";
    els["openai-model"].value = snapshot.openaiModel || "gpt-5.4";
  } catch {
    // ignore busted storage
  }
}

async function loadZip(file) {
  if (!file) return;
  if (!window.JSZip) {
    appendLog("JSZip did not load. Refresh and try again.", "error");
    return;
  }
  appendLog(`Reading ${file.name} (${humanBytes(file.size)})…`);
  const buffer = await file.arrayBuffer();
  const zip = await window.JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && !shouldIgnorePath(entry.name))
    .map((entry) => ({ path: entry.name, size: entry._data?.uncompressedSize || 0 }))
    .sort((a, b) => a.path.localeCompare(b.path));

  state.zipFile = file;
  state.zipObject = zip;
  state.entries = entries;
  state.treePreview = entries.slice(0, 220).map((entry) => entry.path);
  state.suggestedDeployRoot = guessDeployRoot(entries.map((entry) => entry.path));

  els["stat-zip-name"].textContent = `${file.name} · ${humanBytes(file.size)}`;
  els["stat-file-count"].textContent = String(entries.length);
  els["stat-deploy-root"].textContent = state.suggestedDeployRoot || "ZIP root";
  els["stat-top-folders"].textContent = topFolders(entries.map((entry) => entry.path)).join(", ") || "(root only)";
  els["tree-preview"].textContent = state.treePreview.join("\n") || "No files found.";
  els["tree-meta"].textContent = `${entries.length} files previewed${entries.length > state.treePreview.length ? ` · showing first ${state.treePreview.length}` : ""}`;

  if (!els["deploy-root"].value && state.suggestedDeployRoot) {
    els["deploy-root"].value = state.suggestedDeployRoot;
  }

  saveSettings();
  appendLog(`ZIP ready. Found ${entries.length} files. Suggested deploy root: ${state.suggestedDeployRoot || "ZIP root"}.`, "ok");
}

async function materializeFiles(root = "") {
  if (!state.zipObject) throw new Error("Load a ZIP first.");
  const normalizedRoot = normalizeRoot(root);
  const files = [];
  for (const [path, entry] of Object.entries(state.zipObject.files)) {
    if (entry.dir || shouldIgnorePath(path)) continue;
    if (normalizedRoot) {
      if (!(path === normalizedRoot || path.startsWith(`${normalizedRoot}/`))) continue;
    }
    const trimmed = normalizedRoot ? path.replace(new RegExp(`^${normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`), "") : path;
    if (!trimmed) continue;
    const bytes = await entry.async("uint8array");
    files.push({
      path: trimmed,
      originalPath: path,
      size: bytes.byteLength,
      contentBase64: base64FromUint8(bytes),
    });
  }
  if (!files.length) {
    throw new Error(normalizedRoot ? `No files were found under ${normalizedRoot}.` : "The ZIP did not produce any files.");
  }
  return files;
}

async function callApi(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

function buildContextSummary() {
  const entries = state.entries;
  return {
    zip_name: state.zipFile?.name || null,
    file_count: entries.length,
    suggested_deploy_root: state.suggestedDeployRoot || "",
    deploy_root: normalizeRoot(els["deploy-root"].value),
    git_root: normalizeRoot(els["git-root"].value),
    top_folders: topFolders(entries.map((entry) => entry.path)),
    sample_paths: entries.slice(0, 80).map((entry) => entry.path),
    latest_results: state.results,
    latest_logs: state.logs.slice(0, 12),
  };
}

async function runGithubLane() {
  const gitRoot = normalizeRoot(els["git-root"].value);
  const files = await materializeFiles(gitRoot);
  appendLog(`GitHub lane staging ${files.length} files from ${gitRoot || "ZIP root"}…`);
  const result = await callApi("/.netlify/functions/deploy-github", {
    token: els["github-token"].value.trim(),
    owner: els["github-owner"].value.trim(),
    repo: els["github-repo"].value.trim(),
    branch: els["github-branch"].value.trim() || "main",
    message: els["github-message"].value.trim() || `SkyShip Command update · ${new Date().toISOString()}`,
    files,
  });
  state.results.GitHub = result;
  renderResults();
  appendLog(`GitHub push complete on ${result.ref || result.branch || els["github-branch"].value || "main"}.`, "ok");
  return result;
}

async function runNetlifyLane() {
  const deployRoot = normalizeRoot(els["deploy-root"].value);
  const files = await materializeFiles(deployRoot);
  appendLog(`Netlify lane packaging ${files.length} files from ${deployRoot || "ZIP root"}…`);
  const result = await callApi("/.netlify/functions/deploy-netlify", {
    token: els["netlify-token"].value.trim(),
    siteId: els["netlify-site-id"].value.trim(),
    title: els["netlify-title"].value.trim() || `SkyShip Command deploy · ${new Date().toISOString()}`,
    files,
  });
  state.results.Netlify = result;
  renderResults();
  appendLog(`Netlify deploy created${result.url ? ` at ${result.url}` : ""}.`, "ok");
  return result;
}

async function runCloudflareLane(githubResult = null) {
  appendLog("Cloudflare lane requesting a fresh Pages deployment…");
  const branch = els["cloudflare-branch"].value.trim() || els["github-branch"].value.trim() || "main";
  const result = await callApi("/.netlify/functions/deploy-cloudflare", {
    token: els["cloudflare-token"].value.trim(),
    accountId: els["cloudflare-account-id"].value.trim(),
    projectName: els["cloudflare-project"].value.trim(),
    branch,
    commitMessage: els["github-message"].value.trim() || `SkyShip Command trigger · ${new Date().toISOString()}`,
    commitHash: githubResult?.commit_sha || githubResult?.commitSha || null,
  });
  state.results.Cloudflare = result;
  renderResults();
  appendLog(`Cloudflare Pages deployment requested for ${branch}.`, "ok");
  return result;
}

async function runSelected(which = "selected") {
  if (state.running) return;
  if (!state.zipObject) {
    appendLog("Load a ZIP before running lanes.", "error");
    return;
  }
  saveSettings();
  state.running = true;
  setRunState("Running", "running");
  try {
    let githubResult = null;
    const wantGithub = which === "github" || (which === "selected" && els["enable-github"].checked);
    const wantNetlify = which === "netlify" || (which === "selected" && els["enable-netlify"].checked);
    const wantCloudflare = which === "cloudflare" || (which === "selected" && els["enable-cloudflare"].checked);

    if (!wantGithub && !wantNetlify && !wantCloudflare) {
      throw new Error("No lanes are enabled.");
    }

    if (wantGithub) githubResult = await runGithubLane();
    if (wantNetlify) await runNetlifyLane();
    if (wantCloudflare) await runCloudflareLane(githubResult);

    setRunState("Done", "ok");
  } catch (error) {
    appendLog(error.message || "Something exploded during the run.", "error");
    setRunState("Error", "error");
  } finally {
    state.running = false;
  }
}

async function askOpenAI(promptOverride = "") {
  const question = (promptOverride || els["ai-question"].value || "").trim();
  if (!question) {
    appendLog("Ask something first. The robot is not psychic.", "error");
    return;
  }
  saveSettings();
  els["ai-response"].textContent = "Thinking…";
  appendLog("Sending context to OpenAI…");
  try {
    const result = await callApi("/.netlify/functions/ai-chat", {
      apiKey: els["openai-key"].value.trim(),
      model: els["openai-model"].value.trim() || "gpt-5.4",
      question,
      context: buildContextSummary(),
    });
    els["ai-response"].textContent = result.answer || "No answer came back.";
    appendLog("OpenAI answered.", "ok");
  } catch (error) {
    els["ai-response"].textContent = error.message || "AI call failed.";
    appendLog(error.message || "AI call failed.", "error");
  }
}

function resetSession() {
  state.zipFile = null;
  state.zipObject = null;
  state.entries = [];
  state.treePreview = [];
  state.suggestedDeployRoot = "";
  state.logs = [];
  state.results = {};
  els["zip-input"].value = "";
  els["stat-zip-name"].textContent = "No package loaded";
  els["stat-file-count"].textContent = "0";
  els["stat-deploy-root"].textContent = "—";
  els["stat-top-folders"].textContent = "—";
  els["tree-preview"].textContent = "Waiting for a package…";
  els["tree-meta"].textContent = "Load a ZIP to inspect the tree.";
  renderLog();
  renderResults();
  setRunState("Idle", "idle");
  appendLog("Session reset.");
}

function attachEvents() {
  const dropzone = els["dropzone"];
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
    const file = [...event.dataTransfer.files].find((item) => item.name.toLowerCase().endsWith(".zip"));
    if (!file) {
      appendLog("That was not a ZIP file.", "error");
      return;
    }
    await loadZip(file);
  });

  els["zip-input"].addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (file) await loadZip(file);
  });

  [
    "git-root",
    "deploy-root",
    "enable-github",
    "enable-netlify",
    "enable-cloudflare",
    "github-token",
    "github-owner",
    "github-repo",
    "github-branch",
    "github-message",
    "netlify-token",
    "netlify-site-id",
    "netlify-title",
    "cloudflare-token",
    "cloudflare-account-id",
    "cloudflare-project",
    "cloudflare-branch",
    "openai-key",
    "openai-model",
  ].forEach((id) => {
    els[id].addEventListener("input", saveSettings);
    els[id].addEventListener("change", saveSettings);
  });

  els["run-selected-btn"].addEventListener("click", () => runSelected("selected"));
  els["github-only-btn"].addEventListener("click", () => runSelected("github"));
  els["netlify-only-btn"].addEventListener("click", () => runSelected("netlify"));
  els["cloudflare-only-btn"].addEventListener("click", () => runSelected("cloudflare"));
  els["ask-ai-btn"].addEventListener("click", () => askOpenAI());
  els["reset-session-btn"].addEventListener("click", resetSession);
  document.querySelectorAll(".pill-btn").forEach((button) => {
    button.addEventListener("click", () => {
      els["ai-question"].value = button.dataset.prompt || "";
      askOpenAI(button.dataset.prompt || "");
    });
  });
}

function init() {
  bindElements();
  restoreSettings();
  renderLog();
  renderResults();
  setRunState("Idle", "idle");
  attachEvents();
  appendLog("SkyShip Command ready.");
}

document.addEventListener("DOMContentLoaded", init);
