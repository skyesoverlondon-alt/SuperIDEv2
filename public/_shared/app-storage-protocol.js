(function () {
  const APP_BRIDGE_EVENT_KEY = "kx.app.bridge";
  const VAULT_PENDING_IMPORT_KEY = "kx.vaultpro.pending.import";

  function safeParseJson(value) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  function resolveElement(target) {
    if (!target) return null;
    if (typeof target === "string") return document.getElementById(target);
    return target;
  }

  function emitBridge(payload) {
    const envelope = { type: APP_BRIDGE_EVENT_KEY, payload };
    const serialized = JSON.stringify(envelope);
    localStorage.setItem(APP_BRIDGE_EVENT_KEY, serialized);
    try {
      window.parent?.postMessage(envelope, window.location.origin);
    } catch (_) {}
    try {
      window.top?.postMessage(envelope, window.location.origin);
    } catch (_) {}
  }

  function setStatus(node, message, tone) {
    if (!node) return;
    node.textContent = String(message || "");
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  }

  function create(options) {
    const settings = options || {};
    const appId = String(settings.appId || "standalone-surface").trim() || "standalone-surface";
    const recordApp = String(settings.recordApp || appId).trim() || appId;
    const wsId = String(settings.wsId || "primary-workspace").trim() || "primary-workspace";
    const getState = typeof settings.getState === "function" ? settings.getState : function () { return {}; };
    const serialize = typeof settings.serialize === "function" ? settings.serialize : function (model) { return model; };
    const deserialize = typeof settings.deserialize === "function" ? settings.deserialize : function (payload) { return payload; };
    const buildVaultPayload = typeof settings.buildVaultPayload === "function" ? settings.buildVaultPayload : function (model) { return model; };
    const getTitle = typeof settings.getTitle === "function" ? settings.getTitle : function () { return `${recordApp} Workspace`; };
    const applyState = typeof settings.applyState === "function" ? settings.applyState : function () {};
    const vaultStatusNode = resolveElement(settings.vaultStatusElementId);
    const pushVaultButton = resolveElement(settings.pushVaultButtonId);
    const openVaultButton = resolveElement(settings.openVaultButtonId);
    const targetAliases = new Set(
      [appId, recordApp]
        .concat(Array.isArray(settings.targetAliases) ? settings.targetAliases : [])
        .map(function (value) { return String(value || "").trim(); })
        .filter(Boolean)
    );

    const workspaceSync = window.SkyeWorkspaceRecordSync && typeof window.SkyeWorkspaceRecordSync.create === "function"
      ? window.SkyeWorkspaceRecordSync.create({
          appId,
          recordApp,
          wsId,
          statusElementId: settings.statusElementId,
          debounceMs: settings.debounceMs,
          sizeLimit: settings.sizeLimit,
          getState,
          applyState,
          serialize,
          deserialize,
          getTitle,
          onSaveError: settings.onSaveError,
          onLoadError: settings.onLoadError,
          onTooLarge: settings.onTooLarge,
        })
      : null;

    function setVaultStatus(message, tone) {
      setStatus(vaultStatusNode, message, tone);
    }

    function matchesTarget(target) {
      return targetAliases.has(String(target || "").trim());
    }

    async function importFromVault(payload, envelope) {
      applyState(deserialize(payload));
      if (workspaceSync) {
        await workspaceSync.save({ prompt: false, silent: true, successText: "Imported" });
      }
      setVaultStatus(String((envelope && envelope.detail) || "Vault payload imported"), "ok");
      return payload;
    }

    function handleBridgePayload(payload) {
      if (!payload || typeof payload !== "object") return;
      if (payload.kind === "vault-pro-import") {
        const targetApp = payload.targetApp || payload.appId;
        if (!matchesTarget(targetApp) || !payload.payload || typeof payload.payload !== "object") return;
        importFromVault(payload.payload, payload).catch(function (error) {
          console.error(`${recordApp} vault import failed`, error);
          setVaultStatus("Vault import failed", "error");
        });
        return;
      }
      if (payload.kind === "vault-pro-status") {
        const targetApp = payload.appId || payload.targetApp;
        if (!targetApp || matchesTarget(targetApp)) {
          setVaultStatus(String(payload.detail || "Vault status updated"), payload.tone || "idle");
        }
      }
    }

    function bindBridgeListeners() {
      function onStorage(event) {
        if (event.key !== APP_BRIDGE_EVENT_KEY || !event.newValue) return;
        const parsed = safeParseJson(event.newValue);
        if (!parsed || parsed.type !== APP_BRIDGE_EVENT_KEY) return;
        handleBridgePayload(parsed.payload);
      }

      function onMessage(event) {
        if (event.origin !== window.location.origin) return;
        const data = event.data;
        if (!data || data.type !== APP_BRIDGE_EVENT_KEY) return;
        handleBridgePayload(data.payload);
      }

      window.addEventListener("storage", onStorage);
      window.addEventListener("message", onMessage);
    }

    function buildVaultEnvelope(stageOptions) {
      const opts = stageOptions || {};
      const model = serialize(getState());
      return {
        id: `vault-sync-${Date.now()}`,
        format: "superide-vault-bridge-v1",
        sourceApp: recordApp,
        workspace_id: wsId,
        exported_at: new Date().toISOString(),
        title: String(getTitle(model) || `${recordApp} Workspace Snapshot`),
        detail: String(opts.detail || `${recordApp} staged a vault snapshot.`),
        payload: buildVaultPayload(model),
      };
    }

    function openVault(openOptions) {
      const opts = openOptions || {};
      const note = String(opts.note || `${recordApp} opened SkyeVault Pro.`);
      try {
        if (window.SkyeStandaloneSession && typeof window.SkyeStandaloneSession.openApp === "function") {
          window.SkyeStandaloneSession.openApp("SkyeVault-Pro-v4.46", { source: recordApp, note });
        } else {
          window.open(`/SkyeVault-Pro-v4.46/drive/index.html?ws_id=${encodeURIComponent(wsId)}`, "_blank", "noopener,noreferrer");
        }
        if (!opts.suppressStatus) setVaultStatus("Vault opened", "ok");
        return true;
      } catch (error) {
        if (!opts.suppressStatus) setVaultStatus("Vault open failed", "error");
        throw error;
      }
    }

    async function stageToVault(stageOptions) {
      const opts = stageOptions || {};
      if (workspaceSync && opts.syncBeforeVault !== false) {
        await workspaceSync.save({ prompt: false, silent: !!opts.silentSync, successText: "Synced" });
      }
      const envelope = buildVaultEnvelope(opts);
      localStorage.setItem(VAULT_PENDING_IMPORT_KEY, JSON.stringify(envelope));
      emitBridge({
        kind: "open-app",
        source: recordApp,
        appId: "SkyeVault-Pro-v4.46",
        note: String(opts.detail || `${recordApp} staged a vault import snapshot.`),
      });
      setVaultStatus("Vault snapshot staged", "ok");
      if (opts.openApp !== false) {
        openVault({ note: String(opts.detail || `${recordApp} opened SkyeVault Pro after staging a snapshot.`), suppressStatus: true });
        setVaultStatus("Vault snapshot staged", "ok");
      }
      return envelope;
    }

    if (pushVaultButton && !pushVaultButton.dataset.vaultBound) {
      pushVaultButton.dataset.vaultBound = "1";
      pushVaultButton.addEventListener("click", function () {
        stageToVault().catch(function (error) {
          console.error(`${recordApp} vault stage failed`, error);
          setVaultStatus("Vault stage failed", "error");
        });
      });
    }

    if (openVaultButton && !openVaultButton.dataset.vaultBound) {
      openVaultButton.dataset.vaultBound = "1";
      openVaultButton.addEventListener("click", function () {
        try {
          openVault();
        } catch (error) {
          console.error(`${recordApp} vault open failed`, error);
          setVaultStatus("Vault open failed", "error");
        }
      });
    }

    bindBridgeListeners();

    if (!vaultStatusNode) {
      setVaultStatus("Vault status unavailable", "warn");
    } else if (!vaultStatusNode.textContent) {
      setVaultStatus("Vault ready", "idle");
    }

    return {
      workspaceSync,
      load: workspaceSync ? workspaceSync.load.bind(workspaceSync) : async function () { return null; },
      save: workspaceSync ? workspaceSync.save.bind(workspaceSync) : async function () { return null; },
      debouncedSave: workspaceSync ? workspaceSync.debouncedSave.bind(workspaceSync) : function () {},
      setStatus: workspaceSync ? workspaceSync.setStatus.bind(workspaceSync) : function () {},
      setVaultStatus,
      buildVaultEnvelope,
      stageToVault,
      openVault,
    };
  }

  window.SkyeAppStorageProtocol = { create };
})();