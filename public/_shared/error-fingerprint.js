(function () {
  function fingerprint(error, context) {
    var message = String((error && error.message) || error || "unknown_error");
    var stack = String((error && error.stack) || "").slice(0, 240);
    var ctx = typeof context === "object" && context ? JSON.stringify(context) : String(context || "");
    var payload = [message, stack, ctx].join("|");
    var hash = 2166136261;
    for (var i = 0; i < payload.length; i += 1) {
      hash ^= payload.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return "E-" + Math.abs(hash >>> 0).toString(16).padStart(8, "0").slice(0, 8).toUpperCase();
  }

  window.SkyeError = window.SkyeError || {};
  window.SkyeError.fingerprint = fingerprint;
})();
