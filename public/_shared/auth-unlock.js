(function () {
  const ACCESS_TOKEN_KEY = "kx.api.accessToken";
  const TOKEN_EMAIL_KEY = "kx.api.tokenEmail";
  const KEY_ALIAS = "kaixu_api_key";
  const HAS_PIN_KEY = "kx.auth.hasPin";
  const PIN_UNLOCKED_AT_KEY = "kx.auth.pinUnlockedAt";
  const KAIXU_SYNC_EVENT = "kaixu:key-sync";

  function readToken() {
    return String(localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(KEY_ALIAS) || "").trim();
  }

  function readTokenEmail() {
    return String(localStorage.getItem(TOKEN_EMAIL_KEY) || "").trim().toLowerCase();
  }

  function broadcastKeySync(token, lockedEmail) {
    const detail = {
      hasKey: Boolean(String(token || "").trim()),
      lockedEmail: String(lockedEmail || "").trim().toLowerCase(),
    };
    try {
      window.dispatchEvent(new CustomEvent(KAIXU_SYNC_EVENT, { detail }));
    } catch {}
  }

  function persistUnlockedToken(token, lockedEmail) {
    const nextToken = String(token || "").trim();
    const nextEmail = String(lockedEmail || "").trim().toLowerCase();
    localStorage.setItem(ACCESS_TOKEN_KEY, nextToken);
    localStorage.setItem(TOKEN_EMAIL_KEY, nextEmail);
    localStorage.setItem(PIN_UNLOCKED_AT_KEY, new Date().toISOString());
    if (nextToken) localStorage.setItem(KEY_ALIAS, nextToken);
    else localStorage.removeItem(KEY_ALIAS);
    broadcastKeySync(nextToken, nextEmail);
  }

  function clearUnlockedToken() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(TOKEN_EMAIL_KEY);
    localStorage.removeItem(PIN_UNLOCKED_AT_KEY);
    localStorage.removeItem(KEY_ALIAS);
    broadcastKeySync("", "");
  }

  async function jsonRequest(path, body, method) {
    const res = await fetch(path, {
      method: method || (body ? "POST" : "GET"),
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) throw new Error(data && data.error ? data.error : `${path} failed (${res.status})`);
    return data;
  }

  async function readSessionMeta() {
    const data = await jsonRequest("/api/auth-me", null, "GET");
    localStorage.setItem(HAS_PIN_KEY, data && data.has_pin ? "1" : "0");
    return data;
  }

  async function issueSessionToken(email, labelPrefix) {
    const data = await jsonRequest("/api/token-issue", {
      count: 1,
      ttl_preset: "quarter",
      label_prefix: labelPrefix || "standalone-auto",
      locked_email: String(email || "").trim().toLowerCase() || undefined,
      scopes: ["generate"],
    }, "POST");
    const issued = data && Array.isArray(data.issued) ? data.issued[0] : null;
    if (!issued || !issued.token) throw new Error("Token issue succeeded but no token was returned.");
    persistUnlockedToken(issued.token, issued.locked_email || email || "");
    return issued;
  }

  async function unlockWithPin(pin, labelPrefix) {
    const data = await jsonRequest("/api/auth-pin-unlock", {
      pin: String(pin || "").trim(),
      label_prefix: labelPrefix || "session-unlock",
      ttl_preset: "day",
    }, "POST");
    if (!data || !data.token) throw new Error("Unlock succeeded but no token was returned.");
    persistUnlockedToken(data.token, data.locked_email || "");
    localStorage.setItem(HAS_PIN_KEY, "1");
    return data;
  }

  async function ensureUnlockedAccess(options) {
    const token = readToken();
    if (token) {
      return {
        ok: true,
        reused: true,
        token,
        locked_email: readTokenEmail() || null,
      };
    }

    const settings = options || {};
    const me = await readSessionMeta();
    if (!me || !me.email) throw new Error("Sign in first.");

    if (me.has_pin) {
      if (settings.prompt === false) {
        return { ok: false, pin_required: true, email: me.email };
      }
      const pin = window.prompt(settings.pinPrompt || `Enter your session PIN for ${me.email}`) || "";
      if (!String(pin).trim()) throw new Error("PIN unlock canceled.");
      const unlocked = await unlockWithPin(pin, settings.labelPrefix || "session-unlock");
      return {
        ok: true,
        reused: false,
        unlocked: true,
        token: unlocked.token,
        locked_email: unlocked.locked_email || me.email,
      };
    }

    const issued = await issueSessionToken(me.email, settings.labelPrefix || "session-auto");
    return {
      ok: true,
      reused: false,
      unlocked: false,
      token: issued.token,
      locked_email: issued.locked_email || me.email,
    };
  }

  function authHeaders() {
    const headers = { "Content-Type": "application/json" };
    const token = readToken();
    const email = readTokenEmail();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (email) headers["X-Token-Email"] = email;
    return headers;
  }

  window.SkyeAuthUnlock = {
    authHeaders,
    clearUnlockedToken,
    ensureUnlockedAccess,
    issueSessionToken,
    KAIXU_SYNC_EVENT,
    persistUnlockedToken,
    readKaixuKey: readToken,
    readSessionMeta,
    readToken,
    readTokenEmail,
    unlockWithPin,
  };
})();