(function () {
  const body = document.body;
  if (!body || body.dataset.appId !== 'SkyeChat') return;

  const page = body.dataset.page || 'hub';
  const params = new URLSearchParams(window.location.search);
  const wsId = params.get('ws_id') || 'primary-workspace';
  const stateKey = 'skyechat.platform.state';
  const launchDraftKey = 'skyechat.platform.launchDraft';
  const moderationKey = 'skyechat.moderation.timeline';
  const standaloneSession = window.SkyeStandaloneSession || null;
  const sharedScriptSources = ['/ _shared/workspace-record-sync.js', '/_shared/app-storage-protocol.js'].map((value) => value.replace('/ ', '/'));
  const initialState = {
    handoffs: [],
    creatorDrafts: [],
    directMessages: [],
    policyNotes: [],
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

  function loadModerationTimeline() {
    try {
      const parsed = JSON.parse(localStorage.getItem(moderationKey) || '[]');
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

  function persistModerationTimeline(timeline, options) {
    const settings = options || {};
    localStorage.setItem(moderationKey, JSON.stringify(Array.isArray(timeline) ? timeline : []));
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

  function renderList(selector, items, emptyText) {
    const node = document.querySelector(selector);
    if (!node) return;
    if (!items.length) {
      node.innerHTML = `<div class="list-entry"><strong>Nothing staged yet</strong><div class="entry-meta">${escapeHtml(emptyText)}</div></div>`;
      return;
    }
    node.innerHTML = items.map((item) => `
      <div class="list-entry">
        <strong>${escapeHtml(item.title || item.channel || item.label || 'Untitled')}</strong>
        <div>${escapeHtml(item.excerpt || item.message || item.note || 'No detail provided.')}</div>
        <div class="entry-meta">${escapeHtml(item.source || item.audience || item.intent || 'platform')} · ${escapeHtml(item.channel || item.status || item.at || '')}</div>
      </div>
    `).join('');
  }

  function renderText(selector, value) {
    document.querySelectorAll(`[data-bind="${selector}"]`).forEach((node) => {
      node.textContent = value;
    });
  }

  function getPlatformModel() {
    return {
      state: clone(state) || { ...initialState },
      moderationTimeline: loadModerationTimeline(),
    };
  }

  function applyImportedModel(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (payload.compose && typeof payload.compose === 'object') {
      const compose = payload.compose;
      state.creatorDrafts.unshift({
        title: compose.subject || 'Vault Import',
        excerpt: compose.message || compose.text || '',
        channel: compose.channel || 'vault-imports',
        source: 'SkyeVault Pro',
        topic: compose.topic || '',
        at: new Date().toISOString(),
      });
      state.creatorDrafts = state.creatorDrafts.slice(0, 18);
      localStorage.setItem(launchDraftKey, JSON.stringify({ ws_id: wsId, ...compose }));
      rememberHandoff({
        source: 'SkyeVault Pro',
        channel: compose.channel || 'vault-imports',
        title: compose.subject || 'Vault Import',
        excerpt: compose.message || compose.text || 'Imported network payload.',
      }, { skipSync: true, skipRender: true });
      persist({ skipSync: true });
      render();
      return;
    }

    const nextState = payload.state && typeof payload.state === 'object'
      ? { ...initialState, ...payload.state }
      : { ...initialState, ...(payload || {}) };
    state.handoffs = Array.isArray(nextState.handoffs) ? nextState.handoffs : [];
    state.creatorDrafts = Array.isArray(nextState.creatorDrafts) ? nextState.creatorDrafts : [];
    state.directMessages = Array.isArray(nextState.directMessages) ? nextState.directMessages : [];
    state.policyNotes = Array.isArray(nextState.policyNotes) ? nextState.policyNotes : [];
    persist({ skipSync: true });

    if (Array.isArray(payload.moderationTimeline)) {
      persistModerationTimeline(payload.moderationTimeline, { skipSync: true });
    }
    render();
  }

  function injectRuntimeChrome() {
    if (document.getElementById('chatRuntimeBar')) return;
    const topbar = document.querySelector('.platform-topbar');
    const shell = document.querySelector('.platform-shell');
    if (!shell) return;
    const bar = document.createElement('section');
    bar.id = 'chatRuntimeBar';
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
        <span class="mini-card" style="padding:10px 14px; min-height:auto;">Workspace <strong id="chatWorkspaceBadge">${escapeHtml(wsId)}</strong></span>
        <span class="mini-card" id="chatSyncStatus" style="padding:10px 14px; min-height:auto;">Sync ready</span>
        <span class="mini-card" id="chatVaultStatus" style="padding:10px 14px; min-height:auto;">Vault ready</span>
      </div>
      <div class="button-row">
        <button class="platform-button ghost" id="chatPushVaultBtn" type="button">Push To Vault</button>
        <button class="platform-button ghost" id="chatOpenVaultBtn" type="button">Open Vault</button>
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

  function renderModerationTimeline() {
    renderList('[data-bind="moderationTimeline"]', loadModerationTimeline().slice(0, 6).map((entry) => ({
      title: entry.action || 'Moderation state',
      excerpt: entry.reason || entry.detail || 'Policy action recorded from command workspace.',
      source: entry.actor || 'operator',
      channel: entry.at || '',
    })), 'Run moderation from the command workspace and the latest moves will surface here.');
  }

  function render() {
    renderText('handoffCount', String(state.handoffs.length));
    renderText('draftCount', String(state.creatorDrafts.length));
    renderText('policyStatus', state.policyNotes[0]?.status || 'clear');
    renderList('[data-bind="recentHandoffs"]', state.handoffs.slice(0, 6), 'Push from SkyeDocxPro, SkyeBlog, or the suite launcher to fill this intake.');
    renderList('[data-bind="creatorDrafts"]', state.creatorDrafts.slice(0, 6), 'Creator Studio drafts will show here once staged.');
    renderList('[data-bind="directMessages"]', state.directMessages.slice(0, 6), 'Messenger staging appears here after you queue direct outreach.');
    renderList('[data-bind="policyNotes"]', state.policyNotes.slice(0, 6), 'Moderation presets and operator notes appear here after you save them.');
    renderModerationTimeline();
  }

  function rememberHandoff(entry, options) {
    const settings = options || {};
    state.handoffs.unshift({
      id: `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      source: 'suite',
      channel: 'community',
      title: 'Incoming handoff',
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
    openPath('/SkyeChat/apps/command/index.html', {
      channel: draft.channel || 'community',
      topic: draft.topic || '',
    });
  }

  function seedFromQuery() {
    const title = params.get('title') || params.get('subject') || '';
    const excerpt = params.get('excerpt') || params.get('text') || params.get('message') || '';
    const source = params.get('source') || '';
    const channel = params.get('channel') || 'community';
    if (!title && !excerpt && !source && params.get('bridge_import') !== '1') return;
    rememberHandoff({
      source: source || 'suite route',
      channel,
      title: title || 'Imported platform draft',
      excerpt: excerpt || 'Suite handoff arrived without excerpt text.',
    });
  }

  function hydrateHubInputs() {
    const creatorSource = document.getElementById('creatorSource');
    const creatorChannel = document.getElementById('creatorChannel');
    const creatorTopic = document.getElementById('creatorTopic');
    const creatorTitle = document.getElementById('creatorTitle');
    const creatorExcerpt = document.getElementById('creatorExcerpt');
    if (!creatorSource && !creatorChannel && !creatorTopic && !creatorTitle && !creatorExcerpt) return;

    const title = params.get('title') || params.get('subject') || '';
    const excerpt = params.get('excerpt') || params.get('text') || params.get('message') || '';
    const source = params.get('source') || '';
    const channel = params.get('channel') || '';
    const topic = params.get('topic') || '';

    if (creatorSource && source && !creatorSource.value) creatorSource.value = source;
    if (creatorChannel && channel && !creatorChannel.value) creatorChannel.value = channel;
    if (creatorTopic && topic && !creatorTopic.value) creatorTopic.value = topic;
    if (creatorTitle && title && !creatorTitle.value) creatorTitle.value = title;
    if (creatorExcerpt && excerpt && !creatorExcerpt.value) creatorExcerpt.value = excerpt;
  }

  function subscribeToSuite() {
    if (!standaloneSession?.subscribeSuiteIntents) return;
    standaloneSession.subscribeSuiteIntents('SkyeChat', (payload) => {
      const meta = payload?.payload || {};
      const context = payload?.context || {};
      rememberHandoff({
        source: payload?.sourceApp || 'suite',
        channel: context.channel_id || meta.channel || 'community',
        title: meta.subject || meta.title || payload?.detail || payload?.intent?.name || 'Incoming suite intent',
        excerpt: meta.text || meta.message || payload?.detail || 'New suite event arrived in SkyeChat.',
      });
    });
  }

  function bindStorageSignals() {
    window.addEventListener('storage', (event) => {
      if (event.key === moderationKey) {
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
        community: '/SkyeChat/apps/community/index.html',
        messenger: '/SkyeChat/apps/messenger/index.html',
        creator: '/SkyeChat/apps/creator/index.html',
        moderation: '/SkyeChat/apps/moderation/index.html',
        command: '/SkyeChat/apps/command/index.html',
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

    if (action === 'save-creator-draft') {
      event.preventDefault();
      const title = document.getElementById('creatorTitle')?.value.trim() || 'Untitled drop';
      const excerpt = document.getElementById('creatorExcerpt')?.value.trim() || '';
      const channel = document.getElementById('creatorChannel')?.value.trim() || 'community';
      const source = document.getElementById('creatorSource')?.value.trim() || 'creator studio';
      const topic = document.getElementById('creatorTopic')?.value.trim() || '';
      state.creatorDrafts.unshift({ title, excerpt, channel, source, topic, at: new Date().toISOString() });
      state.creatorDrafts = state.creatorDrafts.slice(0, 18);
      persist();
      rememberHandoff({ title, excerpt, channel, source });
      return;
    }

    if (action === 'route-creator-to-command') {
      event.preventDefault();
      const title = document.getElementById('creatorTitle')?.value.trim() || 'Untitled drop';
      const excerpt = document.getElementById('creatorExcerpt')?.value.trim() || '';
      const channel = document.getElementById('creatorChannel')?.value.trim() || 'community';
      const topic = document.getElementById('creatorTopic')?.value.trim() || '';
      routeToCommand({ channel, topic, message: `${title}\n\n${excerpt}`.trim(), status: 'Loaded creator studio draft into SkyeChat command workspace.' });
      return;
    }

    if (action === 'save-direct-message') {
      event.preventDefault();
      const audience = document.getElementById('dmAudience')?.value.trim() || 'priority-followups';
      const title = document.getElementById('dmTitle')?.value.trim() || 'Direct message lane';
      const message = document.getElementById('dmMessage')?.value.trim() || '';
      state.directMessages.unshift({ title, message, audience, at: new Date().toISOString() });
      state.directMessages = state.directMessages.slice(0, 18);
      persist();
      render();
      return;
    }

    if (action === 'route-dm-to-command') {
      event.preventDefault();
      const message = document.getElementById('dmMessage')?.value.trim() || '';
      const title = document.getElementById('dmTitle')?.value.trim() || 'Direct message lane';
      routeToCommand({ channel: 'ops-dm', message: `${title}\n\n${message}`.trim(), status: 'Loaded direct-message draft into SkyeChat command workspace.' });
      return;
    }

    if (action === 'save-policy') {
      event.preventDefault();
      const title = document.getElementById('policyName')?.value.trim() || 'Policy preset';
      const note = document.getElementById('policyNote')?.value.trim() || '';
      const status = document.getElementById('policyStatusInput')?.value.trim() || 'watch';
      state.policyNotes.unshift({ title, note, status, at: new Date().toISOString() });
      state.policyNotes = state.policyNotes.slice(0, 18);
      persist();
      render();
      return;
    }

    if (action === 'route-policy-to-command') {
      event.preventDefault();
      const title = document.getElementById('policyName')?.value.trim() || 'Policy preset';
      const note = document.getElementById('policyNote')?.value.trim() || '';
      routeToCommand({ channel: 'moderation-hq', message: `${title}\n\n${note}`.trim(), status: 'Loaded moderation note into SkyeChat command workspace.' });
    }
  });

  async function initStorageProtocol() {
    injectRuntimeChrome();
    try {
      await ensureSharedProtocol();
      if (!window.SkyeAppStorageProtocol?.create) return;
      storageProtocol = window.SkyeAppStorageProtocol.create({
        appId: 'SkyeChat',
        recordApp: 'SkyeChat',
        wsId,
        statusElementId: 'chatSyncStatus',
        vaultStatusElementId: 'chatVaultStatus',
        pushVaultButtonId: 'chatPushVaultBtn',
        openVaultButtonId: 'chatOpenVaultBtn',
        getState: getPlatformModel,
        serialize: (model) => model,
        deserialize: (payload) => payload,
        applyState: applyImportedModel,
        buildVaultPayload: (model) => model,
        getTitle: () => `SkyeChat Platform · ${wsId}`,
      });
      await storageProtocol.load(false);
      render();
    } catch (error) {
      console.error('SkyeChat shared storage bootstrap failed', error);
    }
  }

  document.querySelectorAll('.subnav a').forEach((node) => {
    const target = node.getAttribute('data-page');
    if (target === page) node.classList.add('is-active');
  });

  seedFromQuery();
  hydrateHubInputs();
  subscribeToSuite();
  bindStorageSignals();
  render();
  void initStorageProtocol();
})();