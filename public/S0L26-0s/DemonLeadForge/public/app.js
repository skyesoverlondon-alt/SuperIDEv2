const state = {
  health: null,
  user: null,
  workspace: { projects: [], sheets: [], threads: [], currentProjectId: null },
  currentSheetId: null,
  currentSheet: null,
  currentThreadId: null,
  adminToken: sessionStorage.getItem('bemon_admin_token') || '',
  compare: { leftId: '', rightId: '', left: null, right: null }
};

const els = {
  healthStatus: document.getElementById('healthStatus'),
  loginBtn: document.getElementById('loginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  userCard: document.getElementById('userCard'),
  projectList: document.getElementById('projectList'),
  sheetList: document.getElementById('sheetList'),
  threadList: document.getElementById('threadList'),
  projectCount: document.getElementById('projectCount'),
  sheetCount: document.getElementById('sheetCount'),
  threadCount: document.getElementById('threadCount'),
  savedSheetsMetric: document.getElementById('savedSheetsMetric'),
  savedThreadsMetric: document.getElementById('savedThreadsMetric'),
  scrapeForm: document.getElementById('scrapeForm'),
  scrapeUrl: document.getElementById('scrapeUrl'),
  scrapeTitle: document.getElementById('scrapeTitle'),
  scrapePages: document.getElementById('scrapePages'),
  scrapeStatus: document.getElementById('scrapeStatus'),
  scrapePreview: document.getElementById('scrapePreview'),
  chatLog: document.getElementById('chatLog'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  refreshWorkspaceBtn: document.getElementById('refreshWorkspaceBtn'),
  sheetMeta: document.getElementById('sheetMeta'),
  sheetPreview: document.getElementById('sheetPreview'),
  downloadSheetBtn: document.getElementById('downloadSheetBtn'),
  compareLeft: document.getElementById('compareLeft'),
  compareRight: document.getElementById('compareRight'),
  compareLeftTitle: document.getElementById('compareLeftTitle'),
  compareRightTitle: document.getElementById('compareRightTitle'),
  compareLeftTable: document.getElementById('compareLeftTable'),
  compareRightTable: document.getElementById('compareRightTable'),
  loadCompareBtn: document.getElementById('loadCompareBtn'),
  combineSheetsBtn: document.getElementById('combineSheetsBtn'),
  feedbackForm: document.getElementById('feedbackForm'),
  feedbackEmail: document.getElementById('feedbackEmail'),
  feedbackTopic: document.getElementById('feedbackTopic'),
  feedbackMessage: document.getElementById('feedbackMessage'),
  feedbackStatus: document.getElementById('feedbackStatus'),
  adminOpenBtn: document.getElementById('adminOpenBtn'),
  adminCloseBtn: document.getElementById('adminCloseBtn'),
  adminModal: document.getElementById('adminModal'),
  adminKeyInput: document.getElementById('adminKeyInput'),
  adminUnlockBtn: document.getElementById('adminUnlockBtn'),
  adminStatus: document.getElementById('adminStatus'),
  adminMetrics: document.getElementById('adminMetrics'),
  adminUsers: document.getElementById('adminUsers'),
  adminEvents: document.getElementById('adminEvents')
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value || '';
  }
}

function formEncode(payload) {
  return new URLSearchParams(payload).toString();
}

async function getUserToken() {
  const user = window.netlifyIdentity?.currentUser?.();
  if (!user) return '';
  return user.jwt();
}

async function api(path, { method = 'GET', body = null, auth = false, admin = false, raw = false } = {}) {
  const headers = {};
  if (body && !raw) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await getUserToken();
    if (!token) throw new Error('Login required.');
    headers.Authorization = `Bearer ${token}`;
  }
  if (admin) {
    if (!state.adminToken) throw new Error('Admin token missing.');
    headers['X-Admin-Session'] = state.adminToken;
  }

  const response = await fetch(`/.netlify/functions/${path}`, {
    method,
    headers,
    body: body ? (raw ? body : JSON.stringify(body)) : undefined
  });

  if (raw) return response;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.detail || `Request failed for ${path}`);
  }
  return data;
}

async function submitNetlifyForm(formName, fields) {
  const payload = { 'form-name': formName, ...fields };
  await fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode(payload)
  });
}

function renderMiniTable(rows, columns) {
  if (!rows || !rows.length) return '<div class="muted" style="padding: 1rem;">Nothing here yet.</div>';
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = columns.map((column) => {
      const raw = typeof column.render === 'function' ? column.render(row) : row[column.key];
      return `<td>${escapeHtml(raw ?? '')}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="data-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderLeadTable(rows) {
  if (!rows || !rows.length) return '<div class="muted" style="padding: 1rem;">No rows loaded.</div>';
  return renderMiniTable(rows.slice(0, 100), [
    { label: 'Business', key: 'business_name' },
    { label: 'Email', render: (row) => (row.emails || []).join(' | ') },
    { label: 'Phone', render: (row) => (row.phones || []).join(' | ') },
    { label: 'Website', render: (row) => (row.websites || []).join(' | ') || row.source_url || '' },
    { label: 'Address', key: 'address' }
  ]);
}

function toastStatus(element, text, tone = 'muted') {
  element.textContent = text;
  element.classList.remove('muted');
  if (tone === 'muted') element.classList.add('muted');
  if (tone === 'success') element.style.color = 'var(--success)';
  if (tone === 'danger') element.style.color = 'var(--danger)';
  if (tone === 'muted') element.style.color = '';
}

function setUserCard() {
  if (!state.user) {
    els.userCard.innerHTML = '<p class="muted">Not logged in yet.</p><p class="tiny">Use Netlify Identity to unlock saved sheets, chat history, and persistence.</p>';
    els.loginBtn.classList.remove('hidden');
    els.logoutBtn.classList.add('hidden');
    return;
  }

  els.userCard.innerHTML = `
    <strong>${escapeHtml(state.user.fullName || 'Operator')}</strong>
    <p class="muted">${escapeHtml(state.user.email || state.user.id)}</p>
    <p class="tiny">Identity sync is active. This operator's events are being tracked.</p>
  `;
  els.loginBtn.classList.add('hidden');
  els.logoutBtn.classList.remove('hidden');
}

function renderWorkspace() {
  els.projectCount.textContent = String(state.workspace.projects.length);
  els.sheetCount.textContent = String(state.workspace.sheets.length);
  els.threadCount.textContent = String(state.workspace.threads.length);
  els.savedSheetsMetric.textContent = String(state.workspace.sheets.length);
  els.savedThreadsMetric.textContent = String(state.workspace.threads.length);

  els.projectList.innerHTML = state.workspace.projects.map((project) => `
    <button class="stack-item ${project.id === state.workspace.currentProjectId ? 'active' : ''}" data-project-id="${escapeHtml(project.id)}" type="button">
      <strong>${escapeHtml(project.title)}</strong>
      <p class="tiny muted">${escapeHtml(project.description || '')}</p>
    </button>
  `).join('');

  els.sheetList.innerHTML = state.workspace.sheets.map((sheet) => `
    <button class="stack-item ${sheet.id === state.currentSheetId ? 'active' : ''}" data-sheet-id="${escapeHtml(sheet.id)}" type="button">
      <strong>${escapeHtml(sheet.title)}</strong>
      <p class="tiny muted">${escapeHtml(sheet.source_summary || '')}</p>
      <p class="tiny">Rows: ${escapeHtml(sheet.row_count)}</p>
    </button>
  `).join('') || '<div class="tiny muted">No saved sheets yet.</div>';

  els.threadList.innerHTML = state.workspace.threads.map((thread) => `
    <button class="stack-item ${thread.id === state.currentThreadId ? 'active' : ''}" data-thread-id="${escapeHtml(thread.id)}" type="button">
      <strong>${escapeHtml(thread.title)}</strong>
      <p class="tiny muted">Updated ${escapeHtml(formatDate(thread.updated_at))}</p>
    </button>
  `).join('') || '<div class="tiny muted">No saved threads yet.</div>';

  const options = ['<option value="">Select a sheet</option>'].concat(
    state.workspace.sheets.map((sheet) => `<option value="${escapeHtml(sheet.id)}">${escapeHtml(sheet.title)}</option>`)
  ).join('');
  els.compareLeft.innerHTML = options;
  els.compareRight.innerHTML = options;
  els.compareLeft.value = state.compare.leftId || '';
  els.compareRight.value = state.compare.rightId || '';
}

async function loadHealth() {
  try {
    const result = await api('health');
    state.health = result;
    els.healthStatus.textContent = result.ok ? 'Live' : 'Offline';
  } catch (error) {
    els.healthStatus.textContent = 'Error';
  }
}

async function syncUser() {
  try {
    const result = await api('user-sync', { method: 'POST', auth: true, body: {} });
    state.user = result.user;
    state.workspace.currentProjectId = result.project.id;
    setUserCard();
    await loadWorkspace();
  } catch (error) {
    setUserCard();
    console.error(error);
  }
}

async function loadWorkspace() {
  if (!window.netlifyIdentity?.currentUser?.()) return;
  try {
    const result = await api('workspace', { auth: true });
    state.workspace = result;
    if (!state.workspace.currentProjectId && result.projects[0]) {
      state.workspace.currentProjectId = result.projects[0].id;
    }
    renderWorkspace();
  } catch (error) {
    console.error(error);
  }
}

async function openSheet(sheetId) {
  if (!sheetId) return;
  try {
    const result = await api(`sheet-detail?sheetId=${encodeURIComponent(sheetId)}`, { auth: true });
    state.currentSheetId = sheetId;
    state.currentSheet = result;
    els.sheetMeta.innerHTML = `
      <strong>${escapeHtml(result.sheet.title)}</strong>
      <p class="muted">${escapeHtml(result.sheet.source_summary || '')}</p>
      <p class="tiny">Rows: ${escapeHtml(result.sheet.row_count)} · Created ${escapeHtml(formatDate(result.sheet.created_at))}</p>
    `;
    els.sheetPreview.innerHTML = renderLeadTable(result.rows);
    renderWorkspace();
  } catch (error) {
    els.sheetMeta.textContent = error.message;
  }
}

function addChatBubble(role, text) {
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  div.innerHTML = `<span class="chat-role">${role === 'user' ? 'Operator' : 'AI'}</span><div>${escapeHtml(text)}</div>`;
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function loadCompareView() {
  const leftId = els.compareLeft.value;
  const rightId = els.compareRight.value;
  state.compare.leftId = leftId;
  state.compare.rightId = rightId;
  if (!leftId || !rightId) return;

  const [left, right] = await Promise.all([
    api(`sheet-detail?sheetId=${encodeURIComponent(leftId)}`, { auth: true }),
    api(`sheet-detail?sheetId=${encodeURIComponent(rightId)}`, { auth: true })
  ]);

  state.compare.left = left;
  state.compare.right = right;
  els.compareLeftTitle.textContent = left.sheet.title;
  els.compareRightTitle.textContent = right.sheet.title;
  els.compareLeftTable.innerHTML = renderLeadTable(left.rows);
  els.compareRightTable.innerHTML = renderLeadTable(right.rows);
}

async function combineSheets() {
  const leftId = els.compareLeft.value;
  const rightId = els.compareRight.value;
  if (!leftId || !rightId) {
    alert('Pick two sheets first.');
    return;
  }

  const result = await api('sheets-combine', {
    method: 'POST',
    auth: true,
    body: {
      projectId: state.workspace.currentProjectId,
      sourceSheetIds: [leftId, rightId],
      title: `Combined · ${new Date().toLocaleDateString('en-US')}`
    }
  });

  await loadWorkspace();
  await openSheet(result.sheet.id);
  addChatBubble('assistant', `Combined sheets into ${result.sheet.title} with ${result.sheet.row_count} rows.`);
}

async function handleScrape(event) {
  event.preventDefault();
  if (!window.netlifyIdentity?.currentUser?.()) {
    alert('Log in first so the new sheet can be saved.');
    return;
  }

  const payload = {
    url: els.scrapeUrl.value.trim(),
    title: els.scrapeTitle.value.trim(),
    maxPages: Number(els.scrapePages.value || 12),
    projectId: state.workspace.currentProjectId
  };

  try {
    toastStatus(els.scrapeStatus, 'Submitting scrape request…', 'muted');
    await submitNetlifyForm('scrape-request', {
      url: payload.url,
      title: payload.title,
      maxPages: String(payload.maxPages),
      operatorEmail: state.user?.email || ''
    });

    const result = await api('scrape', { method: 'POST', auth: true, body: payload });
    toastStatus(els.scrapeStatus, `Scrape complete. ${result.sheet.row_count} rows saved into ${result.sheet.title}.`, 'success');
    els.scrapePreview.innerHTML = renderLeadTable(result.scrape.leadsPreview || []);
    await loadWorkspace();
    await openSheet(result.sheet.id);
  } catch (error) {
    toastStatus(els.scrapeStatus, error.message, 'danger');
  }
}

async function handleChat(event) {
  event.preventDefault();
  if (!window.netlifyIdentity?.currentUser?.()) {
    alert('Log in first so the chat thread can be saved.');
    return;
  }

  const message = els.chatInput.value.trim();
  if (!message) return;

  addChatBubble('user', message);
  els.chatInput.value = '';

  try {
    const result = await api('chat', {
      method: 'POST',
      auth: true,
      body: {
        projectId: state.workspace.currentProjectId,
        threadId: state.currentThreadId,
        selectedSheetIds: [els.compareLeft.value, els.compareRight.value].filter(Boolean),
        message
      }
    });

    state.currentThreadId = result.thread.id;
    addChatBubble('assistant', result.message || 'Done.');
    await loadWorkspace();
    if (result.actions?.combinedSheet?.id) {
      await openSheet(result.actions.combinedSheet.id);
    }
    if (result.actions?.scrapedSheets?.length) {
      await openSheet(result.actions.scrapedSheets[0].sheet.id);
    }
  } catch (error) {
    addChatBubble('assistant', `Error: ${error.message}`);
  }
}

async function downloadCurrentSheet() {
  if (!state.currentSheetId) {
    alert('Open a sheet first.');
    return;
  }
  const token = await getUserToken();
  const url = `/.netlify/functions/sheet-export?sheetId=${encodeURIComponent(state.currentSheetId)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    alert('Download failed.');
    return;
  }
  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${state.currentSheet?.sheet?.title || 'sheet'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(downloadUrl);
}

async function submitFeedback(event) {
  event.preventDefault();
  try {
    await submitNetlifyForm('leadforge-feedback', {
      email: els.feedbackEmail.value.trim(),
      topic: els.feedbackTopic.value.trim(),
      message: els.feedbackMessage.value.trim()
    });
    els.feedbackStatus.textContent = 'Feedback form sent.';
    els.feedbackStatus.style.color = 'var(--success)';
    els.feedbackForm.reset();
  } catch (error) {
    els.feedbackStatus.textContent = error.message;
    els.feedbackStatus.style.color = 'var(--danger)';
  }
}

function openAdminModal() {
  els.adminModal.classList.remove('hidden');
  els.adminModal.setAttribute('aria-hidden', 'false');
}

function closeAdminModal() {
  els.adminModal.classList.add('hidden');
  els.adminModal.setAttribute('aria-hidden', 'true');
}

async function unlockAdmin() {
  try {
    const result = await api('admin-unlock', { method: 'POST', auth: false, body: { key: els.adminKeyInput.value } });
    state.adminToken = result.token;
    sessionStorage.setItem('bemon_admin_token', state.adminToken);
    els.adminStatus.textContent = 'Admin vault unlocked.';
    els.adminStatus.style.color = 'var(--success)';
    await loadAdminOverview();
  } catch (error) {
    els.adminStatus.textContent = error.message;
    els.adminStatus.style.color = 'var(--danger)';
  }
}

async function loadAdminOverview() {
  if (!state.adminToken) return;
  const result = await api('admin-overview', { admin: true });
  els.adminMetrics.innerHTML = [
    `<div class="stat-box"><span class="stat-label">Tracked Users</span><strong>${escapeHtml(result.metrics.users)}</strong></div>`,
    `<div class="stat-box"><span class="stat-label">Saved Sheets</span><strong>${escapeHtml(result.metrics.sheets)}</strong></div>`,
    `<div class="stat-box"><span class="stat-label">Total Leads</span><strong>${escapeHtml(result.metrics.leads)}</strong></div>`
  ].join('');

  els.adminUsers.innerHTML = renderMiniTable(result.users, [
    { label: 'Email', key: 'email' },
    { label: 'Name', key: 'full_name' },
    { label: 'Last Seen', render: (row) => formatDate(row.last_seen_at) }
  ]);

  els.adminEvents.innerHTML = renderMiniTable(result.events, [
    { label: 'Type', key: 'event_type' },
    { label: 'Summary', key: 'summary' },
    { label: 'When', render: (row) => formatDate(row.created_at) }
  ]);
}

function bindDelegates() {
  els.projectList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-project-id]');
    if (!button) return;
    state.workspace.currentProjectId = button.dataset.projectId;
    renderWorkspace();
  });

  els.sheetList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sheet-id]');
    if (!button) return;
    openSheet(button.dataset.sheetId);
  });

  els.threadList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-thread-id]');
    if (!button) return;
    state.currentThreadId = button.dataset.threadId;
    renderWorkspace();
  });
}

function initIdentity() {
  if (!window.netlifyIdentity) return;

  window.netlifyIdentity.on('init', async (user) => {
    state.user = user
      ? {
          id: user.id || user.sub || '',
          email: user.email || '',
          fullName: user.user_metadata?.full_name || user.user_metadata?.name || ''
        }
      : null;
    setUserCard();
    if (user) {
      await syncUser();
    }
  });

  window.netlifyIdentity.on('login', async () => {
    window.netlifyIdentity.close();
    await syncUser();
  });

  window.netlifyIdentity.on('logout', () => {
    state.user = null;
    state.workspace = { projects: [], sheets: [], threads: [], currentProjectId: null };
    state.currentSheetId = null;
    state.currentSheet = null;
    state.currentThreadId = null;
    setUserCard();
    renderWorkspace();
    els.sheetMeta.textContent = 'Pick a sheet from the sidebar.';
    els.sheetPreview.innerHTML = '';
  });

  window.netlifyIdentity.init();
}

function initStarfield() {
  const canvas = document.getElementById('starfield');
  const context = canvas.getContext('2d');
  const stars = Array.from({ length: 120 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.5 + 0.2,
    v: Math.random() * 0.001 + 0.0002
  }));

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function frame() {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const star of stars) {
      star.y += star.v;
      if (star.y > 1.02) star.y = -0.02;
      context.beginPath();
      context.fillStyle = 'rgba(255,255,255,0.8)';
      context.arc(star.x * window.innerWidth, star.y * window.innerHeight, star.r, 0, Math.PI * 2);
      context.fill();
    }
    requestAnimationFrame(frame);
  }

  resize();
  frame();
  window.addEventListener('resize', resize);
}

function bindEvents() {
  els.loginBtn.addEventListener('click', () => window.netlifyIdentity?.open?.('login'));
  els.logoutBtn.addEventListener('click', () => window.netlifyIdentity?.logout?.());
  els.scrapeForm.addEventListener('submit', handleScrape);
  els.chatForm.addEventListener('submit', handleChat);
  els.refreshWorkspaceBtn.addEventListener('click', loadWorkspace);
  els.downloadSheetBtn.addEventListener('click', downloadCurrentSheet);
  els.loadCompareBtn.addEventListener('click', loadCompareView);
  els.combineSheetsBtn.addEventListener('click', combineSheets);
  els.feedbackForm.addEventListener('submit', submitFeedback);
  els.adminOpenBtn.addEventListener('click', async () => {
    openAdminModal();
    if (state.adminToken) {
      try { await loadAdminOverview(); } catch {}
    }
  });
  els.adminCloseBtn.addEventListener('click', closeAdminModal);
  els.adminUnlockBtn.addEventListener('click', unlockAdmin);
  els.compareLeft.addEventListener('change', () => { state.compare.leftId = els.compareLeft.value; });
  els.compareRight.addEventListener('change', () => { state.compare.rightId = els.compareRight.value; });
  bindDelegates();
}

async function boot() {
  initStarfield();
  bindEvents();
  setUserCard();
  renderWorkspace();
  await loadHealth();
  initIdentity();
  if (state.adminToken) {
    try { await loadAdminOverview(); } catch {}
  }
}

boot();
