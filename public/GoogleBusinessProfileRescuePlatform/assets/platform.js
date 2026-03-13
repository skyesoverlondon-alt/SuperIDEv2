(function () {
  const params = new URLSearchParams(window.location.search);
  const isEmbed = params.get("embed") === "1";
  const wsId = params.get("ws_id") || "primary-workspace";
  const caseId = params.get("case_id") || `gbp-case-${wsId}`;
  const storageKey = `gbp-rescue-case:${caseId}`;
  const runtimeEnvelopeKey = `gbp-rescue-runtime:${wsId}`;
  const standaloneSession = window.SkyeStandaloneSession || null;
  const pageApp = document.body.dataset.app || "hub";
  const platformRoot = "/GoogleBusinessProfileRescuePlatform/";
  const runtimeAppId = "GoogleBusinessProfileRescuePlatform";
  const runtimeFormat = "gbp-rescue-platform-v1";
  const laneCatalog = [
    { id: "hub", label: "Hub", href: `${platformRoot}index.html`, kicker: "Platform Hub", summary: "Command center for the full rescue system." },
    { id: "intake", label: "Intake", href: `${platformRoot}apps/intake/index.html`, kicker: "App 01", summary: "Capture business identity, failure mode, and support context." },
    { id: "evidence", label: "Evidence", href: `${platformRoot}apps/evidence/index.html`, kicker: "App 02", summary: "Track documents, signage, threads, and packet readiness." },
    { id: "appeals", label: "Appeals", href: `${platformRoot}apps/appeals/index.html`, kicker: "App 03", summary: "Build reinstatement narratives and final appeal briefs." },
    { id: "outreach", label: "Outreach", href: `${platformRoot}apps/outreach/index.html`, kicker: "App 04", summary: "Generate support and client comms for execution." },
    { id: "monitoring", label: "Monitoring", href: `${platformRoot}apps/monitoring/index.html`, kicker: "App 05", summary: "Track follow-up windows and escalation triggers." },
  ];
  let deferredInstallPrompt = null;

  if (isEmbed) document.body.classList.add("embed");

  const fallbackAppUrls = {
    "AE-Flow": "/AE-Flow/index.html",
    ContractorNetwork: "/ContractorNetwork/index.html",
    GBPRescueSuite: "/GBPRescueSuite/index.html",
    SkyeChat: "/SkyeChat/index.html",
    SkyeMail: "/SkyeMail/index.html",
    SkyeAdmin: "/SkyeAdmin/index.html",
    "Neural-Space-Pro": "/Neural-Space-Pro/index.html",
    SkyeDrive: "/SkyeDrive/index.html",
  };
  let runtimeSaveTimer = null;
  let runtimeSyncMode = "Local only";

  function readKey() {
    return String(
      standaloneSession?.readToken?.() ||
      localStorage.getItem("kx.api.accessToken") ||
      localStorage.getItem("kaixu_api_key") ||
      ""
    ).trim();
  }

  function defaultState() {
    return {
      businessName: "",
      status: "suspended",
      market: "",
      evidenceStrength: "medium",
      issueType: "policy-suspension",
      owner: "",
      supportThread: "",
      notes: "",
      timeline: "",
      customerUpdate: "",
      reinstatementNarrative: "",
      evidenceNotes: "",
      monitoringNotes: "",
      nextReviewAt: "",
      checklist: {
        businessLicense: false,
        utilityBill: false,
        photos: false,
        appealHistory: false,
      },
      diagnosis: null,
      updatedAt: null,
    };
  }

  function mergeState(parsed) {
    const base = defaultState();
    return {
      ...base,
      ...(parsed || {}),
      checklist: {
        ...base.checklist,
        ...((parsed && parsed.checklist) || {}),
      },
    };
  }

  function readState() {
    try {
      return mergeState(JSON.parse(localStorage.getItem(storageKey) || "null"));
    } catch {
      return defaultState();
    }
  }

  function readRuntimeEnvelope() {
    try {
      const parsed = JSON.parse(localStorage.getItem(runtimeEnvelopeKey) || "null");
      if (!parsed || typeof parsed !== "object") return { format: runtimeFormat, cases: {} };
      return {
        format: runtimeFormat,
        cases: parsed.cases && typeof parsed.cases === "object" ? parsed.cases : {},
      };
    } catch {
      return { format: runtimeFormat, cases: {} };
    }
  }

  function writeRuntimeEnvelope(nextState) {
    const envelope = readRuntimeEnvelope();
    envelope.format = runtimeFormat;
    envelope.cases = envelope.cases && typeof envelope.cases === "object" ? envelope.cases : {};
    envelope.cases[caseId] = nextState;
    localStorage.setItem(runtimeEnvelopeKey, JSON.stringify(envelope));
    return envelope;
  }

  async function persistRuntimeEnvelope(envelope) {
    if (!standaloneSession?.request) {
      runtimeSyncMode = "Local only";
      render();
      return;
    }
    try {
      await standaloneSession.request(
        "/api/app-record-save",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ws_id: wsId,
            app: runtimeAppId,
            title: `GBP Rescue Cases · ${wsId}`,
            model: {
              format: runtimeFormat,
              active_case_id: caseId,
              cases: envelope.cases,
            },
          }),
        },
        { appId: runtimeAppId, prompt: false }
      );
      runtimeSyncMode = "Runtime synced";
      render();
    } catch {
      runtimeSyncMode = "Local fallback";
      render();
    }
  }

  function scheduleRuntimePersist(nextState, immediate) {
    const envelope = writeRuntimeEnvelope(nextState);
    if (runtimeSaveTimer) window.clearTimeout(runtimeSaveTimer);
    runtimeSaveTimer = window.setTimeout(() => {
      void persistRuntimeEnvelope(envelope);
    }, immediate ? 0 : 650);
  }

  async function hydrateRuntimeState() {
    if (!standaloneSession?.request) {
      runtimeSyncMode = "Local only";
      render();
      return;
    }
    try {
      const data = await standaloneSession.request(
        `/api/app-record-list?ws_id=${encodeURIComponent(wsId)}&app=${encodeURIComponent(runtimeAppId)}&limit=1`,
        { method: "GET" },
        { appId: runtimeAppId, prompt: false }
      );
      const record = Array.isArray(data?.records) ? data.records[0] : null;
      const payload = record && typeof record.payload === "object" ? record.payload : null;
      const cases = payload && payload.cases && typeof payload.cases === "object" ? payload.cases : null;
      const remote = cases && cases[caseId] ? mergeState(cases[caseId]) : null;
      if (remote) {
        const localStamp = Date.parse(state.updatedAt || "") || 0;
        const remoteStamp = Date.parse(remote.updatedAt || "") || 0;
        if (remoteStamp >= localStamp) {
          state = remote;
          localStorage.setItem(storageKey, JSON.stringify(state));
          writeRuntimeEnvelope(state);
        }
      }
      runtimeSyncMode = record ? "Runtime synced" : "Runtime ready";
      render();
    } catch {
      runtimeSyncMode = "Local fallback";
      render();
    }
  }

  let state = readState();

  function saveState(next, toastMessage) {
    state = mergeState({ ...next, updatedAt: new Date().toISOString() });
    localStorage.setItem(storageKey, JSON.stringify(state));
    scheduleRuntimePersist(state, Boolean(toastMessage));
    render();
    if (toastMessage) window.dispatchEvent(new CustomEvent("gbp-toast", { detail: toastMessage }));
    return state;
  }

  function scoreChecklist(checklist) {
    return Object.values(checklist || {}).filter(Boolean).length;
  }

  function buildDiagnosis(current) {
    const checklistScore = scoreChecklist(current.checklist);
    const policyRisk = current.status === "suspended" || /spam|guideline|keyword|duplicate|suspension/i.test(current.notes) ? "High" : current.status === "ranking-collapse" ? "Medium" : "Low";
    const ownershipRisk = current.status === "ownership-conflict" || /manager|owner|access|verification/i.test(current.notes) ? "High" : current.status === "verification-failure" ? "Medium" : "Low";
    const readiness = checklistScore >= 4 && current.evidenceStrength === "high" ? "Ready" : checklistScore >= 2 ? "Staging" : "Fragile";
    const priority = policyRisk === "High" || ownershipRisk === "High" ? "Immediate escalation" : "Operator follow-through";
    const summary = [
      `Business: ${current.businessName || "Unknown business"}`,
      `Case status: ${current.status}`,
      `Market: ${current.market || "Unknown market"}`,
      `Policy risk: ${policyRisk}`,
      `Ownership risk: ${ownershipRisk}`,
      `Readiness: ${readiness}`,
      `Priority: ${priority}`,
      current.notes ? `Operator notes: ${current.notes}` : "Operator notes: not captured yet.",
    ].join("\n");

    return { policyRisk, ownershipRisk, readiness, priority, summary };
  }

  function buildAppealBrief(current) {
    const diagnosis = current.diagnosis || buildDiagnosis(current);
    return [
      `GBP REINSTATEMENT BRIEF`,
      `Case ID: ${caseId}`,
      `Business: ${current.businessName || "Unknown business"}`,
      `Status: ${current.status}`,
      `Market: ${current.market || "Unknown market"}`,
      `Policy risk: ${diagnosis.policyRisk}`,
      `Ownership risk: ${diagnosis.ownershipRisk}`,
      `Readiness: ${diagnosis.readiness}`,
      `Issue type: ${current.issueType}`,
      `Owner / operator: ${current.owner || "Not assigned"}`,
      "",
      `Timeline: ${current.timeline || "Not documented yet."}`,
      `Evidence strength: ${current.evidenceStrength}`,
      `Operator notes: ${current.notes || "Not documented yet."}`,
      `Narrative: ${current.reinstatementNarrative || "No reinstatement narrative drafted yet."}`,
      "",
      "Directive:",
      `${diagnosis.priority}. Use the evidence lane to verify documents, then send the final appeal via outreach or Neural review.`,
    ].join("\n");
  }

  function buildEvidenceSummary(current) {
    const items = [];
    if (current.checklist.businessLicense) items.push("Business license / registration ready");
    if (current.checklist.utilityBill) items.push("Utility bill / lease ready");
    if (current.checklist.photos) items.push("Signage / storefront photos ready");
    if (current.checklist.appealHistory) items.push("Prior support thread or case IDs documented");
    return [
      `EVIDENCE SUMMARY`,
      `Case ID: ${caseId}`,
      `Business: ${current.businessName || "Unknown business"}`,
      `Evidence strength: ${current.evidenceStrength}`,
      `Checklist score: ${scoreChecklist(current.checklist)}/4`,
      items.length ? `Ready assets: ${items.join("; ")}` : "Ready assets: none confirmed yet.",
      `Evidence notes: ${current.evidenceNotes || "No evidence packet notes yet."}`,
    ].join("\n");
  }

  function buildOutreachDraft(current) {
    return [
      `Subject: Google Business Profile reinstatement escalation for ${current.businessName || "the business"}`,
      "",
      `Hello team,`,
      "",
      `We are escalating a ${current.status} case for ${current.businessName || "the business"} in ${current.market || "the assigned market"}.`,
      `Support thread / case IDs: ${current.supportThread || "not captured yet"}.`,
      `Evidence strength is currently ${current.evidenceStrength}.`,
      `Summary: ${current.notes || "Operator notes pending."}`,
      `Appeal narrative: ${current.reinstatementNarrative || "Pending final narrative."}`,
      "",
      `Requested action: review attached evidence and confirm the fastest reinstatement or verification path.`,
      "",
      `Regards,`,
      `${current.owner || "Rescue operator"}`,
    ].join("\n");
  }

  function buildMonitoringSummary(current) {
    return [
      `MONITORING DECK`,
      `Case ID: ${caseId}`,
      `Business: ${current.businessName || "Unknown business"}`,
      `Next review: ${current.nextReviewAt || "Not scheduled"}`,
      `Support thread: ${current.supportThread || "Not logged"}`,
      `Monitoring notes: ${current.monitoringNotes || "No monitoring notes yet."}`,
      `Client update: ${current.customerUpdate || "No customer update drafted yet."}`,
    ].join("\n");
  }

  async function recordSuiteIntent(targetApp, intentName, detail, payload) {
    if (!standaloneSession?.recordSuiteIntent) return null;
    return standaloneSession.recordSuiteIntent({
      target_app: targetApp,
      intent: { name: intentName, status: "ready", detail },
      detail,
      payload: payload || {},
    });
  }

  async function openApp(appId, note, payload) {
    const intentName = appId === "SkyeMail" ? "compose-mail" : appId === "SkyeChat" ? "open-thread" : appId === "SkyeAdmin" ? "admin-lane" : appId === "Neural-Space-Pro" ? "launch-neural" : "open-app";
    await recordSuiteIntent(appId, intentName, note || `Routed from GBP rescue platform into ${appId}.`, {
      case_id: caseId,
      workspace_id: wsId,
      ...payload,
    });
    if (standaloneSession?.openApp) {
      standaloneSession.openApp(appId, {
        note,
        case_id: caseId,
        workspace_id: wsId,
        ...payload,
      });
      return;
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: "kx.app.bridge",
        payload: {
          kind: "open-app",
          appId,
          options: {
            note,
            case_id: caseId,
            workspace_id: wsId,
            ...payload,
          },
        },
      }, window.location.origin);
      return;
    }
    const fallback = fallbackAppUrls[appId];
    if (fallback) {
      const url = new URL(fallback, window.location.origin);
      url.searchParams.set("ws_id", wsId);
      url.searchParams.set("case_id", caseId);
      if (note) url.searchParams.set("title", note);
      if (payload?.brief) url.searchParams.set("excerpt", payload.brief);
      if (payload?.draft) url.searchParams.set("excerpt", payload.draft);
      url.searchParams.set("source", "GoogleBusinessProfileRescuePlatform");
      window.location.href = url.toString();
    }
  }

  function copyText(text, message) {
    navigator.clipboard.writeText(text).then(() => {
      window.dispatchEvent(new CustomEvent("gbp-toast", { detail: message || "Copied." }));
    });
  }

  function withPlatformQuery(href) {
    const url = new URL(href, window.location.origin);
    url.searchParams.set("ws_id", wsId);
    url.searchParams.set("case_id", caseId);
    if (isEmbed) url.searchParams.set("embed", "1");
    return `${url.pathname}${url.search}`;
  }

  function bindQueryLinks() {
    document.querySelectorAll("[data-carry-query]").forEach((node) => {
      const url = new URL(node.getAttribute("href"), window.location.href);
      url.searchParams.set("ws_id", wsId);
      url.searchParams.set("case_id", caseId);
      if (isEmbed) url.searchParams.set("embed", "1");
      node.setAttribute("href", `${url.pathname}${url.search}`);
    });
  }

  function injectLaneRail() {
    const shell = document.querySelector(".shell");
    if (!shell || shell.querySelector("[data-platform-rail]")) return;
    const rail = document.createElement("section");
    rail.className = "card lane-rail";
    rail.setAttribute("data-platform-rail", "1");
    rail.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Platform Rail</h2>
          <p>Move between rescue apps without dropping the shared case state, then route execution into the suite surfaces.</p>
        </div>
        <div class="pill mono">${caseId}</div>
      </div>
      <div class="lane-link-grid">
        ${laneCatalog.map((lane) => `
          <a class="lane-link${lane.id === pageApp ? " active" : ""}" href="${withPlatformQuery(lane.href)}">
            <span class="app-kicker">${lane.kicker}</span>
            <strong>${lane.label}</strong>
            <span>${lane.summary}</span>
          </a>
        `).join("")}
      </div>
      <div class="suite-grid">
        <div class="tool-card">
          <h3>AE Flow</h3>
          <p>Move rescue follow-up into CRM execution when the case turns into outreach, pipeline, or operator work.</p>
          <div class="action-row slim"><button type="button" data-open-app="AE-Flow">Open AE Flow</button></div>
        </div>
        <div class="tool-card">
          <h3>ContractorNetwork</h3>
          <p>Hand field follow-up into ContractorNetwork when the rescue path needs local or operational execution.</p>
          <div class="action-row slim"><button type="button" data-open-app="ContractorNetwork">Open ContractorNetwork</button></div>
        </div>
        <div class="tool-card">
          <h3>SkyeChat</h3>
          <p>Push the active rescue brief into the operator thread.</p>
          <div class="action-row slim"><button type="button" data-open-app="SkyeChat">Open Rescue Ops</button></div>
        </div>
        <div class="tool-card">
          <h3>SkyeMail</h3>
          <p>Prepare escalation or client drafts from the current case.</p>
          <div class="action-row slim"><button type="button" data-open-app="SkyeMail">Open Outreach</button></div>
        </div>
        <div class="tool-card">
          <h3>SkyeAdmin</h3>
          <p>Escalate blocked rescue cases into the admin lane.</p>
          <div class="action-row slim"><button type="button" data-open-app="SkyeAdmin">Open Admin Lane</button></div>
        </div>
        <div class="tool-card">
          <h3>Neural Space Pro</h3>
          <p>Refine the appeal brief before final submission.</p>
          <div class="action-row slim"><button type="button" data-open-app="Neural-Space-Pro">Open Neural</button></div>
        </div>
        <div class="tool-card">
          <h3>SkyeDrive</h3>
          <p>Store and route the evidence packet into the document lane.</p>
          <div class="action-row slim"><button type="button" data-open-app="SkyeDrive">Open Evidence Storage</button></div>
        </div>
        <div class="tool-card">
          <h3>GBP Rescue Suite</h3>
          <p>Open the dedicated mini suite hub with the five rescue apps and support lanes grouped together.</p>
          <div class="action-row slim"><button type="button" data-open-app="GBPRescueSuite">Open Mini Suite</button></div>
        </div>
      </div>
    `;
    const hero = shell.querySelector(".hero");
    if (hero && hero.nextSibling) shell.insertBefore(rail, hero.nextSibling);
    else shell.appendChild(rail);
  }

  function hydrateFields() {
    document.querySelectorAll("[data-field]").forEach((node) => {
      const key = node.dataset.field;
      node.value = state[key] || "";
      node.addEventListener("input", () => saveFromInputs());
      node.addEventListener("change", () => saveFromInputs());
    });
    document.querySelectorAll("[data-check]").forEach((node) => {
      const key = node.dataset.check;
      node.checked = Boolean(state.checklist[key]);
      node.addEventListener("change", () => saveFromInputs());
    });
  }

  function saveFromInputs() {
    const next = { ...state, checklist: { ...state.checklist } };
    document.querySelectorAll("[data-field]").forEach((node) => {
      next[node.dataset.field] = String(node.value || "").trim();
    });
    document.querySelectorAll("[data-check]").forEach((node) => {
      next.checklist[node.dataset.check] = Boolean(node.checked);
    });
    next.diagnosis = buildDiagnosis(next);
    saveState(next);
  }

  function setText(selector, value) {
    document.querySelectorAll(`[data-bind="${selector}"]`).forEach((node) => {
      node.textContent = value;
    });
  }

  function render() {
    state.diagnosis = state.diagnosis || buildDiagnosis(state);
    setText("workspaceLabel", wsId);
    setText("modeLabel", isEmbed ? "Embedded" : "Standalone");
    setText("keyState", readKey() ? "Loaded" : "Missing");
    setText("businessName", state.businessName || "Not set");
    setText("status", state.status || "suspended");
    setText("market", state.market || "Not set");
    setText("evidenceStrength", state.evidenceStrength || "medium");
    setText("updatedAt", state.updatedAt ? new Date(state.updatedAt).toLocaleString() : "Not saved yet");
    setText("caseStatePill", state.updatedAt ? `${runtimeSyncMode} · ${new Date(state.updatedAt).toLocaleTimeString()}` : `${runtimeSyncMode} · Case not saved yet`);
    setText("policyRisk", state.diagnosis.policyRisk);
    setText("ownershipRisk", state.diagnosis.ownershipRisk);
    setText("readiness", state.diagnosis.readiness);
    setText("diagnosisSummary", state.diagnosis.summary);
    setText("appealBrief", buildAppealBrief(state));
    setText("outreachDraft", buildOutreachDraft(state));
    setText("evidenceSummary", buildEvidenceSummary(state));
    setText("monitoringSummary", buildMonitoringSummary(state));
    const standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    setText("installState", deferredInstallPrompt ? "Install ready" : standalone ? "Installed / standalone" : "Use browser install menu or wait for install prompt");
    document.querySelectorAll("[data-install-button]").forEach((node) => {
      node.hidden = !deferredInstallPrompt;
    });
  }

  function bootActions() {
    document.querySelectorAll("[data-open-app]").forEach((node) => {
      node.addEventListener("click", () => {
        const appId = node.dataset.openApp;
        openApp(appId, `Routed from GBP ${pageApp} lane.`, {
          brief: buildAppealBrief(state),
          evidence_summary: buildEvidenceSummary(state),
        });
      });
    });

    document.querySelectorAll("[data-action]").forEach((node) => {
      node.addEventListener("click", () => {
        const action = node.dataset.action;
        if (action === "save") saveFromInputs();
        if (action === "copy-appeal") copyText(buildAppealBrief(state), "Appeal brief copied.");
        if (action === "copy-evidence") copyText(buildEvidenceSummary(state), "Evidence summary copied.");
        if (action === "copy-outreach") copyText(buildOutreachDraft(state), "Outreach draft copied.");
        if (action === "copy-monitoring") copyText(buildMonitoringSummary(state), "Monitoring deck copied.");
        if (action === "send-mail") openApp("SkyeMail", "Prepared rescue outreach draft.", { draft: buildOutreachDraft(state) });
        if (action === "send-chat") openApp("SkyeChat", "Routed rescue brief into SkyeChat.", { brief: buildAppealBrief(state) });
        if (action === "send-neural") openApp("Neural-Space-Pro", "Routed GBP rescue case into Neural Space Pro.", { brief: buildAppealBrief(state) });
        if (action === "send-drive") openApp("SkyeDrive", "Store evidence package in SkyeDrive.", { evidence_summary: buildEvidenceSummary(state) });
        if (action === "send-admin") openApp("SkyeAdmin", "Escalated GBP rescue controls into SkyeAdmin.", { monitoring_summary: buildMonitoringSummary(state) });
        if (action === "install-app") {
          if (!deferredInstallPrompt) {
            window.dispatchEvent(new CustomEvent("gbp-toast", { detail: "Install prompt is not available yet in this browser context." }));
            return;
          }
          deferredInstallPrompt.prompt();
          deferredInstallPrompt.userChoice.finally(() => {
            deferredInstallPrompt = null;
            render();
          });
        }
      });
    });
  }

  function bootToast() {
    const toast = document.querySelector("[data-toast]");
    const toastText = document.querySelector("[data-toast-text]");
    if (!toast || !toastText) return;
    window.addEventListener("gbp-toast", (event) => {
      toastText.textContent = event.detail || "Saved.";
      toast.hidden = false;
      clearTimeout(window.__gbpToastTimer);
      window.__gbpToastTimer = setTimeout(() => {
        toast.hidden = true;
      }, 1800);
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/GoogleBusinessProfileRescuePlatform/sw.js").catch(() => {});
  }

  function bootInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      render();
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      window.dispatchEvent(new CustomEvent("gbp-toast", { detail: "Platform installed." }));
      render();
    });
  }

  injectLaneRail();
  bindQueryLinks();
  hydrateFields();
  bootActions();
  bootToast();
  bootInstallPrompt();
  registerServiceWorker();
  render();
  void hydrateRuntimeState();
})();