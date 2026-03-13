(function () {
  const body = document.body;
  if (!body || body.dataset.appId !== 'SkyeMail') return;

  const page = body.dataset.page || 'hub';
  const params = new URLSearchParams(window.location.search);
  const wsId = params.get('ws_id') || 'primary-workspace';
  const stateKey = 'skymail.platform.state';
  const launchDraftKey = 'skymail.platform.launchDraft';
  const deliveryKey = 'skymail.delivery.records';
  const standaloneSession = window.SkyeStandaloneSession || null;
  const sharedScriptSources = ['/ _shared/workspace-record-sync.js', '/_shared/app-storage-protocol.js'].map((value) => value.replace('/ ', '/'));
  const initialState = {
    handoffs: [],
    drafts: [],
    campaigns: [],
    opsNotes: [],
  };
  let storageProtocol = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value || null));
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(stateKey) || 'null');
      return { ...initialState, ...(parsed || {}) };
    } catch {
      return { ...initialState };
    }
  }

  function loadDeliveries() {
    try {
      const parsed = JSON.parse(localStorage.getItem(deliveryKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const state = loadState();

  function persist(options) {
    const settings = options || {};
    localStorage.setItem(stateKey, JSON.stringify(state));
    if (!settings.skipSync) storageProtocol?.debouncedSave();
  }

  function persistDeliveries(deliveries, options) {
    const settings = options || {};
    localStorage.setItem(deliveryKey, JSON.stringify(Array.isArray(deliveries) ? deliveries : []));
    if (!settings.skipSync) storageProtocol?.debouncedSave();
  }

  function withWorkspace(path, extras) {
    const next = new URL(path, window.location.origin);
    next.searchParams.set('ws_id', wsId);
    Object.entries(extras || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      next.searchParams.set(key, String(value));
    });
    return `${next.pathname}${next.search}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderText(selector, value) {
    document.querySelectorAll(`[data-bind="${selector}"]`).forEach((node) => {
      node.textContent = value;
    });
  }

  function renderList(selector, items, emptyText) {
    const node = document.querySelector(selector);
    if (!node) return;
    if (!items.length) {
      node.innerHTML = `<div class="list-entry"><strong>Nothing staged yet</strong><div class="entry-meta">${escapeHtml(emptyText)}</div></div>`;
      return;
    }
    node.innerHTML = items.map((item) => `
      <div class="list-entry">
        <strong>${escapeHtml(item.title || item.subject || item.name || 'Untitled')}</strong>
        <div>${escapeHtml(item.excerpt || item.text || item.note || item.summary || 'No detail provided.')}</div>
        <div class="entry-meta">${escapeHtml(item.source || item.status || item.audience || item.lane || 'platform')} · ${escapeHtml(item.channel || item.at || item.to || '')}</div>
      </div>
    `).join('');
  }

  function getPlatformModel() {
    return {
      state: clone(state) || { ...initialState },
      deliveries: loadDeliveries(),
    };
  }

  function applyImportedModel(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (payload.compose && typeof payload.compose === 'object') {
      const compose = payload.compose;
      state.drafts.unshift({
        to: compose.to || '',
        subject: compose.subject || 'Vault Import',
        text: compose.text || '',
        channel: compose.channel || 'vault-imports',
        source: 'SkyeVault Pro',
        at: new Date().toISOString(),
      });
      state.drafts = state.drafts.slice(0, 18);
      localStorage.setItem(launchDraftKey, JSON.stringify({ ws_id: wsId, ...compose }));
      rememberHandoff({
        source: 'SkyeVault Pro',
        channel: compose.channel || 'vault-imports',
        title: compose.subject || 'Vault Import',
        excerpt: compose.text || 'Imported compose payload.',
      }, { skipSync: true, skipRender: true });
      persist({ skipSync: true });
      render();
      return;
    }

    const nextState = payload.state && typeof payload.state === 'object'
      ? { ...initialState, ...payload.state }
      : { ...initialState, ...(payload || {}) };
    state.handoffs = Array.isArray(nextState.handoffs) ? nextState.handoffs : [];
    state.drafts = Array.isArray(nextState.drafts) ? nextState.drafts : [];
    state.campaigns = Array.isArray(nextState.campaigns) ? nextState.campaigns : [];
    state.opsNotes = Array.isArray(nextState.opsNotes) ? nextState.opsNotes : [];
    persist({ skipSync: true });

    if (Array.isArray(payload.deliveries)) {
      persistDeliveries(payload.deliveries, { skipSync: true });
    }
    render();
  }

  function injectRuntimeChrome() {
    if (document.getElementById('mailRuntimeBar')) return;
    const topbar = document.querySelector('.platform-topbar');
    const shell = document.querySelector('.platform-shell');
    if (!shell) return;
    const bar = document.createElement('section');
    bar.id = 'mailRuntimeBar';
    bar.className = 'platform-panel';
    bar.style.display = 'flex';
    bar.style.flexWrap = 'wrap';
    bar.style.alignItems = 'center';
    bar.style.justifyContent = 'space-between';
    bar.style.gap = '12px';
    bar.style.marginBottom = '24px';
    bar.style.padding = '14px 18px';
    bar.innerHTML = `
      <div class="button-row" style="align-items:center; gap:10px;">
        <span class="platform-kicker">Shared vault runtime</span>
        <span class="mini-card" style="padding:10px 14px; min-height:auto;">Workspace <strong id="mailWorkspaceBadge">${escapeHtml(wsId)}</strong></span>
        <span class="mini-card" id="mailSyncStatus" style="padding:10px 14px; min-height:auto;">Sync ready</span>
        <span class="mini-card" id="mailVaultStatus" style="padding:10px 14px; min-height:auto;">Vault ready</span>
      </div>
      <div class="button-row">
        <button class="platform-button ghost" id="mailPushVaultBtn" type="button">Push To Vault</button>
        <button class="platform-button ghost" id="mailOpenVaultBtn" type="button">Open Vault</button>
      </div>
    `;
    if (topbar && topbar.nextSibling) shell.insertBefore(bar, topbar.nextSibling);
    else shell.prepend(bar);
  }

  function ensureScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = () => {
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureSharedProtocol() {
    for (const src of sharedScriptSources) {
      await ensureScript(src);
    }
  }

  function rememberHandoff(entry, options) {
    const settings = options || {};
    state.handoffs.unshift({
      id: `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      source: 'suite',
      channel: 'inbox',
      title: 'Incoming mail handoff',
      excerpt: '',
      ...entry,
    });
    state.handoffs = state.handoffs.slice(0, 18);
    persist({ skipSync: settings.skipSync });
    if (!settings.skipRender) render();
  }

  function stageCommandDraft(draft) {
    localStorage.setItem(launchDraftKey, JSON.stringify({ ws_id: wsId, ...draft }));
  }

  function openPath(path, extras) {
    window.location.href = withWorkspace(path, extras);
  }

  function routeToCommand(draft) {
    stageCommandDraft(draft);
    openPath('/SkyeMail/apps/command/index.html', {
      to: draft.to || '',
      subject: draft.subject || '',
      text: draft.text || '',
      channel: draft.channel || '',
      status: draft.status || '',
    });
  }

  function seedFromQuery() {
    const title = params.get('title') || params.get('subject') || '';
    const excerpt = params.get('excerpt') || params.get('text') || params.get('message') || '';
    const source = params.get('source') || '';
    const channel = params.get('channel') || 'inbox';
    if (!title && !excerpt && !source && params.get('bridge_import') !== '1') return;
    rememberHandoff({
      source: source || 'suite route',
      channel,
      title: title || 'Imported mail draft',
      excerpt: excerpt || 'Suite handoff arrived without additional text.',
    });
  }

  function hydrateHubDraftInputs() {
    const toInput = document.getElementById('mailTo');
    const subjectInput = document.getElementById('mailSubject');
    const bodyInput = document.getElementById('mailBody');
    const channelInput = document.getElementById('mailChannel');
    const sourceInput = document.getElementById('mailSource');
    if (!toInput && !subjectInput && !bodyInput && !channelInput && !sourceInput) return;

    const title = params.get('subject') || params.get('title') || '';
    const text = params.get('text') || params.get('excerpt') || params.get('message') || '';
    const to = params.get('to') || '';
    const channel = params.get('channel') || '';
    const source = params.get('source') || '';

    if (toInput && to && !toInput.value) toInput.value = to;
    if (subjectInput && title && !subjectInput.value) subjectInput.value = title;
    if (bodyInput && text && !bodyInput.value) bodyInput.value = text;
    if (channelInput && channel && !channelInput.value) channelInput.value = channel;
    if (sourceInput && source && !sourceInput.value) sourceInput.value = source;
  }

  function subscribeToSuite() {
    if (!standaloneSession?.subscribeSuiteIntents) return;
    standaloneSession.subscribeSuiteIntents('SkyeMail', (payload) => {
      const meta = payload?.payload || {};
      const context = payload?.context || {};
      rememberHandoff({
        source: payload?.sourceApp || 'suite',
        channel: context.channel_id || 'mail',
        title: meta.subject || meta.title || payload?.detail || payload?.intent?.name || 'Incoming suite intent',
        excerpt: meta.text || meta.message || payload?.detail || 'New suite event arrived in SkyeMail.',
      });
    });
  }

  function render() {
    const deliveries = loadDeliveries();
    renderText('handoffCount', String(state.handoffs.length));
    renderText('draftCount', String(state.drafts.length));
    renderText('campaignCount', String(state.campaigns.length));
    renderList('[data-bind="recentHandoffs"]', state.handoffs.slice(0, 6), 'Suite pushes from docs, rescue, and automation will appear here.');
    renderList('[data-bind="composeDrafts"]', state.drafts.slice(0, 6), 'Compose drafts will show here once staged.');
    renderList('[data-bind="campaignQueue"]', state.campaigns.slice(0, 6), 'Campaign batches will appear here once planned.');
    renderList('[data-bind="opsNotes"]', state.opsNotes.slice(0, 6), 'Mail operations notes will appear here once recorded.');
    renderList('[data-bind="recentDeliveries"]', deliveries.slice(0, 6).map((entry) => ({
      title: entry.subject || 'Untitled delivery',
      excerpt: `${entry.to || 'unknown'} · attempts=${entry.attempts || 1}${entry.last_error ? ` · ${entry.last_error}` : ''}`,
      source: entry.status || 'queued',
      at: entry.at || '',
    })), 'Recent command-workspace sends and retries will surface here.');
  }

  function bindStorageSignals() {
    window.addEventListener('storage', (event) => {
      if (event.key === deliveryKey) {
        render();
        storageProtocol?.debouncedSave();
      }
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-action], [data-nav]') : null;
    if (!target) return;

    const nav = target.getAttribute('data-nav');
    if (nav) {
      const map = {
        mailbox: '/SkyeMail/apps/mailbox/index.html',
        templates: '/SkyeMail/apps/templates/index.html',
        campaigns: '/SkyeMail/apps/campaigns/index.html',
        ops: '/SkyeMail/apps/ops/index.html',
        command: '/SkyeMail/apps/command/index.html',
      };
      const next = map[nav];
      if (next) {
        event.preventDefault();
        openPath(next);
      }
      return;
    }

    const action = target.getAttribute('data-action');
    if (!action) return;

    if (action === 'save-compose-draft') {
      event.preventDefault();
      const to = document.getElementById('mailTo')?.value.trim() || '';
      const subject = document.getElementById('mailSubject')?.value.trim() || 'Untitled draft';
      const text = document.getElementById('mailBody')?.value.trim() || '';
      const channel = document.getElementById('mailChannel')?.value.trim() || '';
      const source = document.getElementById('mailSource')?.value.trim() || 'compose studio';
      state.drafts.unshift({ to, subject, text, channel, source, at: new Date().toISOString() });
      state.drafts = state.drafts.slice(0, 18);
      persist();
      rememberHandoff({ title: subject, excerpt: text, source, channel: channel || 'compose' });
      return;
    }

    if (action === 'route-compose-to-command') {
      event.preventDefault();
      const to = document.getElementById('mailTo')?.value.trim() || '';
      const subject = document.getElementById('mailSubject')?.value.trim() || 'Untitled draft';
      const text = document.getElementById('mailBody')?.value.trim() || '';
      const channel = document.getElementById('mailChannel')?.value.trim() || '';
      routeToCommand({ to, subject, text, channel, status: 'Loaded compose draft into SkyeMail command workspace.' });
      return;
    }

    if (action === 'save-campaign') {
      event.preventDefault();
      const name = document.getElementById('campaignName')?.value.trim() || 'Mail campaign';
      const audience = document.getElementById('campaignAudience')?.value.trim() || 'priority-segment';
      const summary = document.getElementById('campaignSummary')?.value.trim() || '';
      state.campaigns.unshift({ title: name, audience, summary, at: new Date().toISOString() });
      state.campaigns = state.campaigns.slice(0, 18);
      persist();
      render();
      return;
    }

    if (action === 'route-campaign-to-command') {
      event.preventDefault();
      const name = document.getElementById('campaignName')?.value.trim() || 'Mail campaign';
      const audience = document.getElementById('campaignAudience')?.value.trim() || 'priority-segment';
      const summary = document.getElementById('campaignSummary')?.value.trim() || '';
      routeToCommand({ subject: name, text: `${audience}\n\n${summary}`.trim(), status: 'Loaded campaign draft into SkyeMail command workspace.' });
      return;
    }

    if (action === 'save-ops-note') {
      event.preventDefault();
      const title = document.getElementById('opsTitle')?.value.trim() || 'Mail ops note';
      const note = document.getElementById('opsNote')?.value.trim() || '';
      const status = document.getElementById('opsStatus')?.value.trim() || 'watch';
      state.opsNotes.unshift({ title, note, status, at: new Date().toISOString() });
      state.opsNotes = state.opsNotes.slice(0, 18);
      persist();
      render();
      return;
    }

    if (action === 'route-ops-to-command') {
      event.preventDefault();
      const title = document.getElementById('opsTitle')?.value.trim() || 'Mail ops note';
      const note = document.getElementById('opsNote')?.value.trim() || '';
      routeToCommand({ subject: title, text: note, status: 'Loaded ops note into SkyeMail command workspace.' });
    }
  });

  async function initStorageProtocol() {
    injectRuntimeChrome();
    try {
      await ensureSharedProtocol();
      if (!window.SkyeAppStorageProtocol?.create) return;
      storageProtocol = window.SkyeAppStorageProtocol.create({
        appId: 'SkyeMail',
        recordApp: 'SkyeMail',
        wsId,
        statusElementId: 'mailSyncStatus',
        vaultStatusElementId: 'mailVaultStatus',
        pushVaultButtonId: 'mailPushVaultBtn',
        openVaultButtonId: 'mailOpenVaultBtn',
        getState: getPlatformModel,
        serialize: (model) => model,
        deserialize: (payload) => payload,
        applyState: applyImportedModel,
        buildVaultPayload: (model) => model,
        getTitle: () => `SkyeMail Platform · ${wsId}`,
      });
      await storageProtocol.load(false);
      render();
    } catch (error) {
      console.error('SkyeMail shared storage bootstrap failed', error);
    }
  }

  document.querySelectorAll('.subnav a').forEach((node) => {
    const target = node.getAttribute('data-page');
    if (target === page) node.classList.add('is-active');
  });

  seedFromQuery();
  hydrateHubDraftInputs();
  subscribeToSuite();
  bindStorageSignals();
  render();
  void initStorageProtocol();
})();