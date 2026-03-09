(function () {
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function createStatusMarkup(iconClass, text, extraClass) {
    return `<i class="${escapeHtml(iconClass)}"></i> <span class="${escapeHtml(extraClass || "")}">${escapeHtml(text)}</span>`;
  }

  function create(options) {
    const settings = options || {};
    const standaloneSession = window.SkyeStandaloneSession || null;
    const appId = String(settings.appId || "standalone-surface").trim() || "standalone-surface";
    const recordApp = String(settings.recordApp || appId).trim() || appId;
    const wsId = String(settings.wsId || "primary-workspace").trim() || "primary-workspace";
    const statusEl = settings.statusElementId ? document.getElementById(settings.statusElementId) : null;
    const debounceMs = Number.isFinite(settings.debounceMs) ? Number(settings.debounceMs) : 2000;
    const sizeLimit = Number.isFinite(settings.sizeLimit) ? Number(settings.sizeLimit) : 1000000;
    const getState = typeof settings.getState === "function" ? settings.getState : function () { return {}; };
    const applyState = typeof settings.applyState === "function" ? settings.applyState : function () {};
    const serialize = typeof settings.serialize === "function" ? settings.serialize : function (model) { return model; };
    const deserialize = typeof settings.deserialize === "function" ? settings.deserialize : function (payload) { return payload; };
    const getTitle = typeof settings.getTitle === "function" ? settings.getTitle : function () { return `${recordApp} Workspace`; };
    const onSaveError = typeof settings.onSaveError === "function" ? settings.onSaveError : function () {};
    const onLoadError = typeof settings.onLoadError === "function" ? settings.onLoadError : function () {};
    const onTooLarge = typeof settings.onTooLarge === "function" ? settings.onTooLarge : function () {};

    let saveTimer = null;
    let isSaving = false;

    function setStatus(iconClass, text, extraClass) {
      if (!statusEl) return;
      statusEl.innerHTML = createStatusMarkup(iconClass, text, extraClass);
    }

    function setSignedOutStatus() {
      setStatus("fa-solid fa-lock", "Sign in to sync", "text-amber-500");
    }

    async function request(path, requestOptions, prompt) {
      if (!standaloneSession || typeof standaloneSession.request !== "function") {
        throw new Error("Standalone session bridge unavailable.");
      }
      return standaloneSession.request(path, requestOptions || {}, {
        appId,
        labelPrefix: appId,
        prompt: Boolean(prompt),
      });
    }

    async function load(prompt) {
      setStatus("fa-solid fa-cloud-arrow-down", "Loading...");
      try {
        const listed = await request(`/api/app-record-list?ws_id=${encodeURIComponent(wsId)}&app=${encodeURIComponent(recordApp)}&limit=1`, {
          method: "GET",
        }, prompt);
        const payload = listed && Array.isArray(listed.records) && listed.records[0] ? listed.records[0].payload : null;
        if (payload && typeof payload === "object") {
          applyState(deserialize(payload));
          setStatus("fa-solid fa-cloud", "Synced");
          return payload;
        }
        setStatus("fa-solid fa-cloud", "Ready");
        return null;
      } catch (error) {
        const message = String(error && error.message ? error.message : error || "");
        if (/sign in first|unauthorized|pin unlock canceled/i.test(message)) {
          setSignedOutStatus();
        } else {
          setStatus("fa-solid fa-cloud-bolt", "Sync Error", "text-red-500");
        }
        onLoadError(error);
        if (prompt) throw error;
        return null;
      }
    }

    async function save(options) {
      const opts = options || {};
      if (isSaving) return null;
      const model = serialize(getState());
      const modelJson = JSON.stringify(model);
      if (modelJson.length > sizeLimit) {
        setStatus("fa-solid fa-triangle-exclamation", "Sync Limit Reached", "text-amber-500");
        onTooLarge(modelJson.length);
        return { ok: false, too_large: true };
      }

      isSaving = true;
      setStatus("fa-solid fa-circle-notch fa-spin", "Syncing...");
      try {
        const saved = await request("/api/app-record-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ws_id: wsId,
            app: recordApp,
            title: getTitle(model),
            model,
          }),
        }, opts.prompt);
        setStatus("fa-solid fa-cloud", opts.successText || "Synced");
        return saved;
      } catch (error) {
        const message = String(error && error.message ? error.message : error || "");
        if (/sign in first|unauthorized|pin unlock canceled/i.test(message)) {
          setSignedOutStatus();
        } else {
          setStatus("fa-solid fa-cloud-bolt", "Sync Error", "text-red-500");
        }
        onSaveError(error);
        if (!opts.silent) throw error;
        return null;
      } finally {
        window.setTimeout(function () {
          isSaving = false;
        }, 500);
      }
    }

    function debouncedSave() {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(function () {
        save({ prompt: false, silent: true });
      }, debounceMs);
    }

    if (statusEl && !statusEl.dataset.syncClickBound) {
      statusEl.dataset.syncClickBound = "1";
      statusEl.style.cursor = "pointer";
      statusEl.title = "Click to sign in and sync";
      statusEl.addEventListener("click", function () {
        load(true).catch(function (error) {
          console.error(`${recordApp} sync prompt failed`, error);
        });
      });
    }

    return {
      wsId,
      load,
      save,
      debouncedSave,
      setStatus,
    };
  }

  window.SkyeWorkspaceRecordSync = { create };
})();