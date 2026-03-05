(function () {
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isRetryableStatus(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  async function fetchWithRetry(url, options, config) {
    var opts = options || {};
    var cfg = config || {};
    var maxAttempts = Number(cfg.maxAttempts || 3);
    var baseDelayMs = Number(cfg.baseDelayMs || 250);
    var maxDelayMs = Number(cfg.maxDelayMs || 2000);

    var lastError = null;
    for (var attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        var response = await fetch(url, opts);
        if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
          return response;
        }
        var backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        await sleep(backoff);
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) throw error;
        var networkBackoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        await sleep(networkBackoff);
      }
    }

    throw lastError || new Error("fetchWithRetry failed without response");
  }

  window.SkyeGateway = window.SkyeGateway || {};
  window.SkyeGateway.fetchWithRetry = fetchWithRetry;
})();
