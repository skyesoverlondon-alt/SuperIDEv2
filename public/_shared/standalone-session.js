(function () {
  const ACCESS_TOKEN_KEY = "kx.api.accessToken";
  const TOKEN_EMAIL_KEY = "kx.api.tokenEmail";

  function readToken() {
    if (window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.readToken === "function") {
      return window.SkyeAuthUnlock.readToken();
    }
    return String(localStorage.getItem(ACCESS_TOKEN_KEY) || "").trim();
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
    if (nextToken) localStorage.setItem("kaixu_api_key", nextToken);
  }

  function clearToken() {
    if (window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.clearUnlockedToken === "function") {
      window.SkyeAuthUnlock.clearUnlockedToken();
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(TOKEN_EMAIL_KEY);
    }
    localStorage.removeItem("kaixu_api_key");
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
    if (keyEl) keyEl.value = readToken() || localStorage.getItem("kaixu_api_key") || "";
    if (emailEl) emailEl.value = readTokenEmail() || "";
  }

  function saveManualToken(token, email) {
    persistToken(token, email);
  }

  window.SkyeStandaloneSession = {
    authHeaders,
    clearToken,
    ensureSignedIn,
    hydrateInputs,
    readToken,
    readTokenEmail,
    request,
    saveManualToken,
  };
})();