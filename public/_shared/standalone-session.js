(function () {
  const ACCESS_TOKEN_KEY = "kx.api.accessToken";
  const TOKEN_EMAIL_KEY = "kx.api.tokenEmail";
  const KEY_ALIAS = "kaixu_api_key";
  const APP_BRIDGE_EVENT_KEY = "kx.app.bridge";
  const SUITE_LEDGER_ENDPOINT = "/api/suite-events";
  const SUITE_INTENT_VERSION = "suite-intent-v1";
  const SUITE_CARD_ID = "skye-suite-integration-card";

  const APP_TITLE_ALIASES = {
    "API Playground": "API-Playground",
    "Smokehouse": "Smokehouse-Standalone",
    "SkyeAdmin": "SkyeAdmin",
    "SkyeChat": "SkyeChat",
    "SkyeMail": "SkyeMail",
    "AE FLOW": "AE-Flow",
    "AE Flow": "AE-Flow",
    "SkyDex 4.6": "SkyDex4.6",
    "SkyeDocxPro": "SkyeDocxPro",
    "Google Business Profile Rescue": "GoogleBusinessProfileRescuePlatform",
    "Google Business Rescue": "GoogleBusinessProfileRescuePlatform",
    "Neural Space Pro": "Neural-Space-Pro",
    "SovereignVariables": "SovereignVariables",
    "SkyeAnalytics": "SkyeAnalytics",
  };

  function readToken() {
    if (window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.readToken === "function") {
      return window.SkyeAuthUnlock.readToken();
    }
    return String(localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(KEY_ALIAS) || "").trim();
  }

  function readTokenEmail() {
    if (window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.readTokenEmail === "function") {
      return window.SkyeAuthUnlock.readTokenEmail();
    }
    return String(localStorage.getItem(TOKEN_EMAIL_KEY) || "").trim().toLowerCase();
  }

  function persistToken(token, email) {
    const nextToken = String(token || "").trim();
    const nextEmail = String(email || "").trim().toLowerCase();
    if (window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.persistUnlockedToken === "function") {
      window.SkyeAuthUnlock.persistUnlockedToken(nextToken, nextEmail);
    } else {
      localStorage.setItem(ACCESS_TOKEN_KEY, nextToken);
      localStorage.setItem(TOKEN_EMAIL_KEY, nextEmail);
    }
    if (nextToken) localStorage.setItem(KEY_ALIAS, nextToken);
    else localStorage.removeItem(KEY_ALIAS);
  }

  function clearToken() {
    if (window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.clearUnlockedToken === "function") {
      window.SkyeAuthUnlock.clearUnlockedToken();
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(TOKEN_EMAIL_KEY);
    }
    localStorage.removeItem(KEY_ALIAS);
  }

  function authHeaders(appId) {
    const headers = {};
    const token = readToken();
    const email = readTokenEmail();
    const corr = window.SkyeCorrelation && typeof window.SkyeCorrelation.next === "function"
      ? window.SkyeCorrelation.next(appId || "standalone")
      : "";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (email) headers["X-Token-Email"] = email;
    if (corr) headers["X-Correlation-Id"] = corr;
    return headers;
  }

  async function parseJsonResponse(response, path) {
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) throw new Error(data && data.error ? data.error : `${path} failed (${response.status})`);
    return data;
  }

  async function basicRequest(path, options, appId) {
    const requestOptions = options || {};
    const response = await fetch(path, {
      credentials: "include",
      ...requestOptions,
      headers: {
        ...authHeaders(appId),
        ...(requestOptions.headers || {}),
      },
    });
    return parseJsonResponse(response, path);
  }

  function getWorkspaceId() {
    const query = new URLSearchParams(window.location.search);
    return String(query.get("ws_id") || localStorage.getItem("kx.workspace.id") || "primary-workspace").trim();
  }

  function toStringList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 100);
  }

  function inferCurrentAppId(explicitAppId) {
    if (explicitAppId) return String(explicitAppId).trim();
    const direct = document.body && document.body.getAttribute("data-app-id");
    if (direct) return String(direct).trim();
    const rawTitle = String(document.title || "")
      .replace(/\|.*$/, "")
      .replace(/Standalone|Workspace|Command Surface|Platform/gi, "")
      .trim();
    if (APP_TITLE_ALIASES[rawTitle]) return APP_TITLE_ALIASES[rawTitle];
    return APP_TITLE_ALIASES[rawTitle.replace(/\s+/g, " ")] || rawTitle.replace(/\s+/g, "-");
  }

  function normalizeIntent(input) {
    if (typeof input === "string") {
      return { name: input.trim().toLowerCase() || "open-proof", version: SUITE_INTENT_VERSION, status: "requested", summary: "" };
    }
    const next = input && typeof input === "object" ? input : {};
    const status = ["requested", "queued", "completed", "failed"].includes(String(next.status || "").trim().toLowerCase())
      ? String(next.status || "requested").trim().toLowerCase()
      : "requested";
    return {
      name: String(next.name || "open-proof").trim().toLowerCase() || "open-proof",
      version: SUITE_INTENT_VERSION,
      status,
      summary: String(next.summary || "").trim(),
    };
  }

  function normalizeContext(input, wsId) {
    const next = input && typeof input === "object" ? input : {};
    return {
      workspace_id: String(next.workspace_id || next.workspaceId || wsId || getWorkspaceId()).trim(),
      file_ids: toStringList(next.file_ids || next.fileIds),
      thread_id: next.thread_id ? String(next.thread_id).trim() : next.threadId ? String(next.threadId).trim() : null,
      channel_id: next.channel_id ? String(next.channel_id).trim() : next.channelId ? String(next.channelId).trim() : null,
      mission_id: next.mission_id ? String(next.mission_id).trim() : next.missionId ? String(next.missionId).trim() : null,
      draft_id: next.draft_id ? String(next.draft_id).trim() : next.draftId ? String(next.draftId).trim() : null,
      case_id: next.case_id ? String(next.case_id).trim() : next.caseId ? String(next.caseId).trim() : null,
      asset_ids: toStringList(next.asset_ids || next.assetIds),
    };
  }

  function buildSuiteDetail(sourceApp, targetApp, intent, detail) {
    const nextDetail = String(detail || "").trim();
    if (nextDetail) return nextDetail;
    if (targetApp) return `${sourceApp} ${intent.status} ${intent.name} -> ${targetApp}`;
    return `${sourceApp} ${intent.status} ${intent.name}`;
  }

  async function ensureSignedIn(options) {
    const settings = options || {};
    const email = String(settings.email || "").trim();
    const password = String(settings.password || "");
    const orgName = String(settings.orgName || "").trim() || settings.defaultOrgName || "Skye Workspace";
    const labelPrefix = String(settings.labelPrefix || settings.appId || "standalone-session").trim();

    if (email && password) {
      try {
        await basicRequest("/api/auth-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }, settings.appId);
      } catch {
        const signup = await basicRequest("/api/auth-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, orgName }),
        }, settings.appId);
        if (signup && signup.kaixu_token && signup.kaixu_token.token) {
          persistToken(signup.kaixu_token.token, signup.kaixu_token.locked_email || email.toLowerCase());
        }
      }
    }

    if (window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.ensureUnlockedAccess === "function") {
      return window.SkyeAuthUnlock.ensureUnlockedAccess({
        labelPrefix,
        prompt: settings.prompt !== false,
      });
    }

    if (!readToken()) throw new Error("Sign in first.");
    return { ok: true, reused: true, token: readToken(), locked_email: readTokenEmail() || null };
  }

  async function request(path, options, settings) {
    const requestOptions = options || {};
    const config = settings || {};
    if (!config.skipUnlock) {
      await ensureSignedIn({
        appId: config.appId,
        labelPrefix: config.labelPrefix,
        prompt: config.prompt,
      });
    }
    return basicRequest(path, requestOptions, config.appId);
  }

  function hydrateInputs(keyId, emailId) {
    const keyEl = typeof keyId === "string" ? document.getElementById(keyId) : keyId;
    const emailEl = typeof emailId === "string" ? document.getElementById(emailId) : emailId;
    if (keyEl) keyEl.value = readToken() || localStorage.getItem(KEY_ALIAS) || "";
    if (emailEl) emailEl.value = readTokenEmail() || "";
  }

  function saveManualToken(token, email) {
    persistToken(token, email);
  }

  function emitAppBridge(payload) {
    const envelope = { type: APP_BRIDGE_EVENT_KEY, payload: payload || {} };
    const serialized = JSON.stringify(envelope);
    localStorage.setItem(APP_BRIDGE_EVENT_KEY, serialized);
    window.postMessage(envelope, window.location.origin);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(envelope, window.location.origin);
    }
    return envelope;
  }

  async function postSuiteLedger(body, appId) {
    const response = await fetch(SUITE_LEDGER_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(appId),
      },
      body: JSON.stringify(body || {}),
    });
    return parseJsonResponse(response, SUITE_LEDGER_ENDPOINT);
  }

  async function fetchSuiteLedger(options) {
    const settings = options || {};
    const wsId = String(settings.wsId || getWorkspaceId()).trim();
    const appId = String(settings.appId || "").trim();
    if (!wsId) return { ok: false, items: [] };
    const query = new URLSearchParams();
    query.set("ws_id", wsId);
    query.set("limit", String(settings.limit || 60));
    if (appId) query.set("app_id", appId);
    try {
      const response = await fetch(`${SUITE_LEDGER_ENDPOINT}?${query.toString()}`, {
        method: "GET",
        credentials: "include",
        headers: authHeaders(appId || "standalone"),
      });
      const data = await parseJsonResponse(response, SUITE_LEDGER_ENDPOINT);
      return { ok: true, items: Array.isArray(data.items) ? data.items : [] };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error || "Failed to load suite ledger."), items: [] };
    }
  }

  async function recordSuiteIntent(options) {
    const settings = options || {};
    const wsId = String(settings.wsId || settings.workspaceId || getWorkspaceId()).trim();
    const sourceApp = inferCurrentAppId(settings.sourceApp || settings.appId);
    const targetApp = settings.targetApp ? String(settings.targetApp).trim() : "";
    const intent = normalizeIntent(settings.intent);
    const context = normalizeContext(settings.context, wsId);
    const detail = buildSuiteDetail(sourceApp, targetApp || null, intent, settings.detail || settings.note || intent.summary);
    const payload = {
      kind: "suite-intent",
      source: sourceApp,
      appId: targetApp || undefined,
      targetApp: targetApp || undefined,
      at: new Date().toISOString(),
      intent,
      context,
      detail,
      payload: settings.payload || {},
      tone: settings.tone || (intent.status === "failed" ? "fail" : intent.status === "completed" ? "ok" : "info"),
      badge: settings.badge || "",
    };

    emitAppBridge(payload);

    if (!wsId || settings.skipServer) {
      return { ok: true, localOnly: true, item: payload, recommendations: [] };
    }

    try {
      const result = await postSuiteLedger({
        ws_id: wsId,
        source_app: sourceApp,
        target_app: targetApp || undefined,
        intent,
        context,
        detail,
        payload: settings.payload || {},
        idempotency_key: settings.idempotencyKey || undefined,
      }, sourceApp);
      const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
      recommendations.forEach((item) => {
        emitAppBridge({
          kind: "action",
          source: item.source_app,
          appId: item.target_app,
          detail: item.detail,
          tone: "info",
        });
      });
      return { ok: true, item: result.item || payload, recommendations };
    } catch (error) {
      return { ok: false, item: payload, error: error && error.message ? error.message : String(error || "Suite ledger failed."), recommendations: [] };
    }
  }

  function subscribeSuiteIntents(appId, handler) {
    const targetApp = String(appId || inferCurrentAppId("")).trim();
    if (!targetApp || typeof handler !== "function") return function noop() {};

    const deliver = function (payload) {
      if (!payload || payload.kind !== "suite-intent") return;
      const payloadTarget = String(payload.targetApp || payload.target_app || payload.appId || "").trim();
      if (payloadTarget && payloadTarget !== targetApp) return;
      handler(payload);
    };

    const onStorage = function (event) {
      if (event.key !== APP_BRIDGE_EVENT_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        if (!parsed || parsed.type !== APP_BRIDGE_EVENT_KEY) return;
        deliver(parsed.payload);
      } catch {}
    };

    const onMessage = function (event) {
      if (event.origin !== window.location.origin) return;
      const data = event.data || null;
      if (!data || data.type !== APP_BRIDGE_EVENT_KEY) return;
      deliver(data.payload);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("message", onMessage);

    try {
      const existing = localStorage.getItem(APP_BRIDGE_EVENT_KEY);
      if (existing) {
        const parsed = JSON.parse(existing);
        if (parsed && parsed.type === APP_BRIDGE_EVENT_KEY) deliver(parsed.payload);
      }
    } catch {}

    return function unsubscribe() {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onMessage);
    };
  }

  function summarizeForApp(items, appId) {
    const relevant = (items || []).filter((item) => item && (item.source_app === appId || item.target_app === appId));
    const upstreamMap = new Map();
    const downstreamMap = new Map();
    let lastSuccessful = null;

    relevant.forEach((item) => {
      if (item.intent && item.intent.status === "completed") {
        if (!lastSuccessful || String(item.occurred_at || "") > String(lastSuccessful.occurred_at || "")) lastSuccessful = item;
      }
      if (item.target_app === appId && item.source_app) {
        const key = `${item.source_app}:${item.intent && item.intent.name ? item.intent.name : "unknown"}`;
        const current = upstreamMap.get(key) || { app_id: item.source_app, intent_name: item.intent && item.intent.name ? item.intent.name : "unknown", count: 0 };
        current.count += 1;
        upstreamMap.set(key, current);
      }
      if (item.source_app === appId && item.target_app) {
        const key = `${item.target_app}:${item.intent && item.intent.name ? item.intent.name : "unknown"}`;
        const current = downstreamMap.get(key) || { app_id: item.target_app, intent_name: item.intent && item.intent.name ? item.intent.name : "unknown", count: 0 };
        current.count += 1;
        downstreamMap.set(key, current);
      }
    });

    const toSorted = function (map) {
      return Array.from(map.values()).sort(function (a, b) { return b.count - a.count; }).slice(0, 4);
    };

    return {
      upstream: toSorted(upstreamMap),
      downstream: toSorted(downstreamMap),
      lastSuccessful,
    };
  }

  function ensureSuiteCardStyles() {
    if (document.getElementById("skye-suite-card-style")) return;
    const style = document.createElement("style");
    style.id = "skye-suite-card-style";
    style.textContent = [
      `#${SUITE_CARD_ID}{position:fixed;right:16px;bottom:72px;z-index:9998;width:min(360px,calc(100vw - 24px));padding:14px;border-radius:16px;`,
      `border:1px solid rgba(255,203,71,.26);background:linear-gradient(180deg,rgba(16,12,27,.94),rgba(6,11,18,.94));`,
      `box-shadow:0 18px 40px rgba(0,0,0,.28);color:#f6fbff;font:12px/1.45 "Space Grotesk",system-ui,sans-serif}`,
      `#${SUITE_CARD_ID}[data-state="hidden"]{display:none}`,
      `#${SUITE_CARD_ID} h3{margin:0 0 4px;font-size:13px;color:#ffcb47;text-transform:uppercase;letter-spacing:.08em}`,
      `#${SUITE_CARD_ID} p{margin:0;color:rgba(246,251,255,.78)}`,
      `#${SUITE_CARD_ID} .suite-mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}`,
      `#${SUITE_CARD_ID} .suite-mini-panel{border:1px solid rgba(191,238,255,.14);border-radius:12px;padding:10px;background:rgba(255,255,255,.03)}`,
      `#${SUITE_CARD_ID} .suite-mini-panel strong{display:block;margin-bottom:6px;color:#ffcb47;font-size:11px;text-transform:uppercase;letter-spacing:.08em}`,
      `#${SUITE_CARD_ID} ul{margin:0;padding-left:18px}`,
      `#${SUITE_CARD_ID} li{margin:0 0 5px}`,
      `#${SUITE_CARD_ID} .suite-last{margin-top:10px;padding:10px;border-radius:12px;background:rgba(44,230,255,.08);border:1px solid rgba(44,230,255,.18)}`,
      `#${SUITE_CARD_ID} .suite-muted{color:rgba(246,251,255,.62)}`,
      `#${SUITE_CARD_ID} .suite-close{position:absolute;top:8px;right:8px;border:0;background:transparent;color:#f6fbff;cursor:pointer;font-size:16px}`,
    ].join("");
    document.head.appendChild(style);
  }

  async function mountIntegrationCard(options) {
    const settings = options || {};
    const appId = inferCurrentAppId(settings.appId);
    if (!appId || !document.body || document.body.getAttribute("data-suite-card") === "off") return null;
    ensureSuiteCardStyles();

    let card = document.getElementById(SUITE_CARD_ID);
    if (!card) {
      card = document.createElement("aside");
      card.id = SUITE_CARD_ID;
      card.setAttribute("data-state", "ready");
      document.body.appendChild(card);
    }

    const bindClose = function () {
      const close = card.querySelector(".suite-close");
      if (close) {
        close.addEventListener("click", function () {
          card.setAttribute("data-state", "hidden");
        });
      }
    };

    const refresh = async function () {
      const result = await fetchSuiteLedger({ wsId: settings.wsId || getWorkspaceId(), appId, limit: 80 });
      if (!result.ok) {
        card.innerHTML = '<button type="button" class="suite-close" aria-label="Hide suite card">x</button><h3>Suite Integration</h3><p class="suite-muted">Sign in to load the shared suite ledger.</p>';
        bindClose();
        return;
      }
      const summary = summarizeForApp(result.items, appId);
      const upstream = summary.upstream.length
        ? `<ul>${summary.upstream.map((item) => `<li>${item.app_id} -> ${item.intent_name} (${item.count}x)</li>`).join("")}</ul>`
        : '<div class="suite-muted">No upstream handoffs recorded yet.</div>';
      const downstream = summary.downstream.length
        ? `<ul>${summary.downstream.map((item) => `<li>${item.intent_name} -> ${item.app_id} (${item.count}x)</li>`).join("")}</ul>`
        : '<div class="suite-muted">No downstream handoffs recorded yet.</div>';
      const last = summary.lastSuccessful
        ? `<div class="suite-last"><strong>Last Successful Handoff</strong><div>${summary.lastSuccessful.source_app}${summary.lastSuccessful.target_app ? ` -> ${summary.lastSuccessful.target_app}` : ""}</div><div class="suite-muted">${summary.lastSuccessful.intent.name} · ${summary.lastSuccessful.detail || summary.lastSuccessful.summary || "Completed"}</div></div>`
        : '<div class="suite-last"><strong>Last Successful Handoff</strong><div class="suite-muted">No completed suite handoff yet.</div></div>';
      card.innerHTML = [
        '<button type="button" class="suite-close" aria-label="Hide suite card">x</button>',
        '<h3>Suite Integration</h3>',
        `<p>${appId} now reports into the shared bridge ledger.</p>`,
        '<div class="suite-mini-grid">',
        `<div class="suite-mini-panel"><strong>Upstream Inputs</strong>${upstream}</div>`,
        `<div class="suite-mini-panel"><strong>Downstream Outputs</strong>${downstream}</div>`,
        '</div>',
        last,
      ].join("");
      bindClose();
    };

    await refresh();
    window.addEventListener("focus", function () { void refresh(); });
    return { refresh };
  }

  function openApp(appId, options) {
    const settings = options || {};
    if (!appId) throw new Error("appId is required.");
    return emitAppBridge({
      kind: "open-app",
      appId,
      source: String(settings.source || settings.appId || document.title || "standalone-session").trim(),
      note: String(settings.note || "").trim(),
      channel: String(settings.channel || "").trim() || undefined,
    });
  }

  function reportAction(detail, options) {
    const settings = options || {};
    if (!detail) throw new Error("detail is required.");
    return emitAppBridge({
      kind: "action",
      detail: String(detail),
      source: String(settings.source || settings.appId || document.title || "standalone-session").trim(),
      appId: settings.appId || undefined,
      tone: settings.tone || undefined,
    });
  }

  window.SkyeStandaloneSession = {
    authHeaders,
    clearToken,
    ensureSignedIn,
    emitAppBridge,
    fetchSuiteLedger,
    hydrateInputs,
    mountIntegrationCard,
    openApp,
    recordSuiteIntent,
    reportAction,
    readKaixuKey: readToken,
    readToken,
    readTokenEmail,
    request,
    saveManualToken,
    subscribeSuiteIntents,
  };

  const mountWhenReady = function () {
    if (!document.body || document.body.getAttribute("data-suite-card") === "off") return;
    void mountIntegrationCard({ appId: inferCurrentAppId("") });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWhenReady, { once: true });
  } else {
    mountWhenReady();
  }
})();