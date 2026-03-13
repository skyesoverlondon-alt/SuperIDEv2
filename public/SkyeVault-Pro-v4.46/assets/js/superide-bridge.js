(function () {
  const APP_BRIDGE_EVENT_KEY = 'kx.app.bridge';
  const PENDING_IMPORT_KEY = 'kx.vaultpro.pending.import';
  const NEURAL_PENDING_IMPORT_KEY = 'kx.neural.pending.import';
  const CONSUMED_IMPORT_ID_KEY = 'kx.vaultpro.pending.import.last';
  const SHELL_URL = '/?app=SkyeVault-Pro-v4.46';
  const VALID_TARGETS = new Set(['SkyeDocs', 'SkyeSheets', 'SkyeSlides', 'SkyeForms', 'SkyeNotes', 'SkyeTasks', 'SkyeMail', 'SkyeChat', 'SkyeCalendar', 'SkyeDrive', 'Neural-Space-Pro', 'ContractorVerificationSuite']);

  function setStatus(message, tone) {
    const node = document.querySelector('#superide-bridge-status');
    if (!node) return;
    node.textContent = message;
    node.className = `status-box${tone ? ` ${tone}` : ''}`;
  }

  function emit(payload) {
    const envelope = { type: APP_BRIDGE_EVENT_KEY, payload };
    const serialized = JSON.stringify(envelope);
    localStorage.setItem(APP_BRIDGE_EVENT_KEY, serialized);
    try {
      window.parent?.postMessage(envelope, window.location.origin);
    } catch (_) {
    }
    try {
      window.top?.postMessage(envelope, window.location.origin);
    } catch (_) {
    }
  }

  function safeParseJson(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function normalizeName(value) {
    return String(value || 'snapshot')
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'snapshot';
  }

  async function readItemText(item, blob) {
    if (blob) {
      try {
        return await blob.text();
      } catch (_) {
      }
    }
    if (item?.plainText) return String(item.plainText);
    if (item?.htmlContent) return String(item.htmlContent);
    return '';
  }

  async function importPendingSnapshot(force) {
    const raw = localStorage.getItem(PENDING_IMPORT_KEY);
    if (!raw) {
      if (force) setStatus('No staged SuperIDE snapshot is waiting.', 'warn');
      return false;
    }
    const envelope = safeParseJson(raw);
    if (!envelope || typeof envelope !== 'object') {
      setStatus('Pending SuperIDE snapshot is invalid JSON.', 'danger');
      return false;
    }
    if (!force && envelope.id && envelope.id === localStorage.getItem(CONSUMED_IMPORT_ID_KEY)) return false;

    const sourceApp = String(envelope.sourceApp || 'SuperIDE').trim() || 'SuperIDE';
    const folderPath = `SuperIDE Imports/${normalizeName(sourceApp)}`;
    const fileName = `${normalizeName(sourceApp)}-${Date.now()}.superide.json`;
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });

    try {
      await window.SkyePersonalVault.createFolder('SuperIDE Imports', '');
    } catch (_) {
    }
    try {
      await window.SkyePersonalVault.createFolder(normalizeName(sourceApp), 'SuperIDE Imports');
    } catch (_) {
    }

    await window.SkyePersonalVault.upsertFile(blob, { folderPath, name: fileName });
    localStorage.setItem(CONSUMED_IMPORT_ID_KEY, String(envelope.id || fileName));
    setStatus(`Imported staged ${sourceApp} snapshot into ${folderPath}.`, 'good');
    emit({
      kind: 'vault-pro-status',
      source: 'SkyeVault-Pro-v4.46',
      appId: sourceApp,
      tone: 'ok',
      detail: `SkyeVault Pro imported the staged ${sourceApp} snapshot.`,
    });
    return true;
  }

  function buildFallbackPayload(targetApp, item, text) {
    if (targetApp === 'SkyeDocs') {
      const path = `vault/${normalizeName(item.name || 'vault-import')}.txt`;
      return { files: [{ path, content: text || '' }], active_path: path };
    }
    if (targetApp === 'SkyeNotes') {
      return {
        notes: [{
          id: `note-${Date.now()}`,
          title: String(item.name || 'Vault Import'),
          body: text || String(item.path || ''),
          tags: 'vault,import',
          owner: 'vault@skye.local',
          updated_at: new Date().toISOString(),
          notebook: 'Vault Imports',
          pinned: true,
        }],
      };
    }
    if (targetApp === 'SkyeForms') {
      return {
        questions: [{
          id: `form-${Date.now()}`,
          prompt: `Imported from ${item.name}`,
          type: 'long_text',
          required: false,
          owner: 'vault@skye.local',
          help_text: 'Imported from SkyeVault Pro.',
          options: [],
        }],
        responses: [],
      };
    }
    if (targetApp === 'SkyeSheets') {
      return {
        model: {
          title: `Vault Import ${item.name}`,
          columns: ['Name', 'Path', 'Preview'],
          rows: [{
            id: `row-${Date.now()}`,
            owner: 'vault@skye.local',
            updated_at: new Date().toISOString(),
            cells: [String(item.name || ''), String(item.path || ''), text.slice(0, 120)],
          }],
        },
      };
    }
    if (targetApp === 'SkyeSlides') {
      return {
        model: {
          title: `Vault Import ${item.name}`,
          slides: [{
            id: `slide-${Date.now()}`,
            title: String(item.name || 'Vault Import'),
            summary: text.slice(0, 280) || String(item.path || ''),
            speaker: 'vault@skye.local',
            status: 'draft',
            updated_at: new Date().toISOString(),
          }],
        },
      };
    }
    if (targetApp === 'SkyeTasks') {
      return [{
        id: `task-${Date.now()}`,
        title: String(item.name || 'Vault Import'),
        description: text.slice(0, 1200) || String(item.path || ''),
        status: 'backlog',
        priority: 'medium',
        assignee: 'vault@skye.local',
        due_at: '',
        updated_at: new Date().toISOString(),
      }];
    }
    if (targetApp === 'SkyeMail') {
      return {
        compose: {
          to: '',
          subject: `Vault Import · ${String(item.name || 'snapshot')}`,
          text: text.slice(0, 5000) || String(item.path || ''),
        },
      };
    }
    if (targetApp === 'SkyeChat') {
      return {
        compose: {
          channel: 'vault-imports',
          message: `[SkyeVault Pro] ${String(item.name || 'snapshot')}\n${(text || String(item.path || '')).slice(0, 1200)}`,
        },
      };
    }
    if (targetApp === 'SkyeCalendar') {
      return {
        events: [{
          id: `event-${Date.now()}`,
          title: `Review ${String(item.name || 'vault import')}`,
          start_date: new Date().toISOString(),
          end_date: new Date().toISOString(),
          owner: 'vault@skye.local',
          status: 'planned',
          notes: text.slice(0, 800) || String(item.path || ''),
        }],
      };
    }
    if (targetApp === 'SkyeDrive') {
      return {
        assets: [{
          id: `asset-${Date.now()}`,
          name: String(item.name || 'vault-import.txt'),
          kind: 'doc',
          size_kb: Math.max(1, Math.round((text || '').length / 1024)),
          owner: 'vault@skye.local',
          version: 1,
          shared_with: '',
          relative_path: `vault/${normalizeName(item.name || 'vault-import')}`,
          mime_type: item.mimeType || 'text/plain',
          source_app: 'SkyeVault-Pro-v4.46',
          saved_at: new Date().toISOString(),
        }],
      };
    }
    if (targetApp === 'ContractorVerificationSuite') {
      return {
        profile: [{
          id: 'primary-profile',
          legalName: 'Vault Imported Contractor',
          businessName: String(item.name || 'Vault Import'),
          serviceTypes: 'Imported vault artifact',
          regions: '',
          verificationLevel: 'Vault Imported',
          activeStatus: 'Active',
          summary: text.slice(0, 800) || String(item.path || ''),
        }],
        incomeRecords: [],
        expenseRecords: [],
        evidenceItems: [{
          id: `evidence-${Date.now()}`,
          title: String(item.name || 'Vault Import'),
          date: new Date().toISOString().slice(0, 10),
          type: 'Vault Import',
          client: 'SkyeVault Pro',
          ref: String(item.path || ''),
          summary: text.slice(0, 1200) || String(item.path || ''),
        }],
        invoices: [],
        cashflowItems: [],
        mileageTrips: [],
        credentials: [],
        disputes: [],
        clients: [],
        leads: [],
        taxPlans: [],
        packetTemplates: [],
        verificationLetters: [],
        receipts: [],
        settings: [],
      };
    }
    return null;
  }

  async function exportItemToSuperide(id) {
    if (!id) return;
    const item = await window.SkyePersonalVault.getItem(id);
    if (!item) {
      setStatus('That vault item no longer exists.', 'danger');
      return;
    }
    const blob = await window.SkyePersonalVault.getBlob(id);
    const text = await readItemText(item, blob);
    const parsed = text ? safeParseJson(text) : null;
    const defaultTarget = parsed && VALID_TARGETS.has(String(parsed.sourceApp || '')) ? String(parsed.sourceApp) : 'SkyeNotes';
    const target = String(window.prompt('Send this item into which SuperIDE app?', defaultTarget) || '').trim();
    if (!VALID_TARGETS.has(target)) {
      setStatus('Choose one of: SkyeDocs, SkyeSheets, SkyeSlides, SkyeForms, SkyeNotes, SkyeTasks, SkyeMail, SkyeChat, SkyeCalendar, SkyeDrive, Neural-Space-Pro, ContractorVerificationSuite.', 'warn');
      return;
    }

    const payload = parsed && parsed.format === 'superide-vault-bridge-v1' && parsed.payload && typeof parsed.payload === 'object'
      ? parsed.payload
      : buildFallbackPayload(target, item, text);
    if (!payload) {
      setStatus(`Unable to convert ${item.name} into ${target}.`, 'danger');
      return;
    }

    if (target === 'Neural-Space-Pro') {
      const envelope = {
        id: `neural-sync-${Date.now()}`,
        format: 'neural-suite-handoff-v1',
        sourceApp: 'SkyeVault-Pro-v4.46',
        exported_at: new Date().toISOString(),
        title: `Vault Import ${item.name}`,
        detail: `SkyeVault Pro sent ${item.name} into Neural Space Pro.`,
        payload,
      };
      localStorage.setItem(NEURAL_PENDING_IMPORT_KEY, JSON.stringify(envelope));
      emit({
        kind: 'neural-import',
        source: 'SkyeVault-Pro-v4.46',
        targetApp: 'Neural-Space-Pro',
        payload,
        envelope,
        detail: `SkyeVault Pro sent ${item.name} into Neural Space Pro.`,
      });
      emit({
        kind: 'open-app',
        source: 'SkyeVault-Pro-v4.46',
        appId: 'Neural-Space-Pro',
        note: `SkyeVault Pro sent ${item.name} into Neural Space Pro.`,
      });
      setStatus(`Sent ${item.name} into Neural Space Pro.`, 'good');
      return;
    }

    emit({
      kind: 'vault-pro-import',
      source: 'SkyeVault-Pro-v4.46',
      targetApp: target,
      payload,
      detail: `SkyeVault Pro sent ${item.name} into ${target}.`,
    });
    setStatus(`Sent ${item.name} into ${target}.`, 'good');
  }

  function bind(page) {
    document.querySelector('#superide-import-button')?.addEventListener('click', async () => {
      try {
        const imported = await importPendingSnapshot(true);
        if (imported) await page.refresh();
      } catch (error) {
        setStatus(error.message || 'SuperIDE import failed.', 'danger');
      }
    });
    document.querySelector('#superide-open-shell-button')?.addEventListener('click', () => {
      window.open(SHELL_URL, '_blank', 'noopener');
    });
    window.addEventListener('storage', async (event) => {
      if (event.key !== PENDING_IMPORT_KEY || !event.newValue) return;
      try {
        const imported = await importPendingSnapshot(false);
        if (imported) await page.refresh();
      } catch (error) {
        setStatus(error.message || 'SuperIDE import failed.', 'danger');
      }
    });
  }

  window.SkyeVaultSuperideBridge = {
    init(page) {
      bind(page);
      importPendingSnapshot(false)
        .then((imported) => imported && page.refresh())
        .catch((error) => setStatus(error.message || 'SuperIDE import failed.', 'danger'));
    },
    sync() {
      if (localStorage.getItem(PENDING_IMPORT_KEY)) {
        setStatus('A staged SuperIDE snapshot is ready to pull into the vault.', 'warn');
        return;
      }
      setStatus('SuperIDE bridge standing by.', '');
    },
    exportItemToSuperide,
    importPendingSnapshot,
  };
})();