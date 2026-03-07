(function () {
  function getHeaders() {
    var headers = { "Content-Type": "application/json" };
    var token = String(window.SkyeStandaloneSession && typeof window.SkyeStandaloneSession.readToken === "function"
      ? window.SkyeStandaloneSession.readToken()
      : window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.readToken === "function"
        ? window.SkyeAuthUnlock.readToken()
        : localStorage.getItem("kx.api.accessToken") || "").trim();
    var email = String(window.SkyeStandaloneSession && typeof window.SkyeStandaloneSession.readTokenEmail === "function"
      ? window.SkyeStandaloneSession.readTokenEmail()
      : window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.readTokenEmail === "function"
        ? window.SkyeAuthUnlock.readTokenEmail()
        : localStorage.getItem("kx.api.tokenEmail") || "").trim().toLowerCase();
    var corr = window.SkyeCorrelation && window.SkyeCorrelation.next ? window.SkyeCorrelation.next("telemetry") : "";
    if (token) headers.Authorization = "Bearer " + token;
    if (email) headers["X-Token-Email"] = email;
    if (corr) headers["X-Correlation-Id"] = corr;
    return headers;
  }

  async function emit(payload) {
    try {
      await fetch("/api/telemetry-ingest", {
        method: "POST",
        credentials: "include",
        headers: getHeaders(),
        body: JSON.stringify(payload || {}),
      });
    } catch (_) {
      // Telemetry must not break user flows.
    }
  }

  window.SkyeTelemetry = window.SkyeTelemetry || {};
  window.SkyeTelemetry.emit = emit;
})();
