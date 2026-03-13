window.SkyeHosted = (() => {
  const state = {
    user: null,
    sessionUser: null,
    backupBusy: false,
    profile: null
  };

  function identityAvailable() {
    return typeof window.netlifyIdentity !== 'undefined';
  }

  function activeUser() {
    return window.netlifyIdentity?.currentUser?.() || state.user || state.sessionUser || null;
  }

  function broadcastIdentity() {
    window.dispatchEvent(new CustomEvent('skye:identity-ready', { detail: { user: state.user } }));
  }

  function setStatus(text, kind = '') {
    const node = document.querySelector('#hosted-status');
    if (!node) return;
    node.className = `status-box ${kind}`.trim();
    node.textContent = text;
  }

  async function api(path, options = {}) {
    const user = activeUser();
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (user?.token?.access_token) headers.Authorization = `Bearer ${user.token.access_token}`;
    const config = { credentials: 'include', ...options, headers };
    if (config.body && typeof config.body === 'object' && !(config.body instanceof Blob) && !(config.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(config.body);
    }
    const res = await fetch(path, config);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  async function loadSessionUser() {
    try {
      const res = await fetch('/api/auth-me', {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!res.ok || !data?.email) {
        state.sessionUser = null;
        return null;
      }
      state.sessionUser = {
        id: data.id,
        email: data.email,
        user_metadata: {
          full_name: data.email
        },
        runtime: 'superide-session'
      };
      return state.sessionUser;
    } catch {
      state.sessionUser = null;
      return null;
    }
  }

  function updateAccountUi() {
    const user = activeUser();
    const authBox = document.querySelector('#auth-slot');
    const backupButtons = document.querySelectorAll('[data-hosted-required]');
    const badge = document.querySelector('#thumb-tier-badge');

    if (!authBox) return;

    if (!identityAvailable() && !user) {
      authBox.innerHTML = `<div class="notice small">Hosted backup and profile sync run on the main SuperIDE session now. Sign in to the main runtime first, then reopen the vault surface.</div>`;
      backupButtons.forEach((button) => button.disabled = true);
      if (badge && !badge.textContent.trim()) badge.textContent = 'Annual thumb drive tier not set yet';
      return;
    }

    if (!user) {
      authBox.innerHTML = `
        <div class="button-row">
          <button id="hosted-signup-button" class="button" type="button">Sign up</button>
          <button id="hosted-login-button" class="ghost-button" type="button">Log in</button>
        </div>
        <div class="notice small" style="margin-top:12px;">Hosted backup, shipping profile sync, and annual drive membership wake up when a user signs in.</div>
      `;
      document.querySelector('#hosted-signup-button')?.addEventListener('click', () => window.netlifyIdentity.open('signup'));
      document.querySelector('#hosted-login-button')?.addEventListener('click', () => window.netlifyIdentity.open('login'));
      backupButtons.forEach((button) => button.disabled = true);
      if (badge) badge.textContent = 'Sign in to manage annual thumb-drive details.';
      return;
    }

    if (!identityAvailable() && state.sessionUser) {
      authBox.innerHTML = `
        <div class="list-item">
          <div>
            <strong>${state.sessionUser.email}</strong>
            <p>Connected through the main SuperIDE session</p>
          </div>
        </div>
      `;
      backupButtons.forEach((button) => button.disabled = false);
      return;
    }

    authBox.innerHTML = `
      <div class="list-item">
        <div>
          <strong>${user.user_metadata?.full_name || user.email}</strong>
          <p>${user.email}</p>
        </div>
        <div class="actions">
          <button id="hosted-logout-button" class="ghost-button" type="button">Log out</button>
        </div>
      </div>
    `;
    document.querySelector('#hosted-logout-button')?.addEventListener('click', () => window.netlifyIdentity.logout());
    backupButtons.forEach((button) => button.disabled = false);
  }

  async function exportSnapshot() {
    const items = await window.SkyePersonalVault.listAllItems();
    const out = [];
    for (const item of items) {
      const row = { item };
      if (item.kind !== 'folder') {
        const blob = await window.SkyePersonalVault.getBlob(item.id);
        if (blob) {
          const buffer = await blob.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          let binary = '';
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
          row.blobBase64 = btoa(binary);
          row.blobType = blob.type || item.mimeType || 'application/octet-stream';
        }
      }
      out.push(row);
    }
    return { exportedAt: new Date().toISOString(), items: out };
  }

  async function importSnapshot(snapshot) {
    if (!snapshot?.items?.length) return { count: 0 };
    let count = 0;
    for (const entry of snapshot.items) {
      const item = entry.item || {};
      if (item.kind === 'folder') {
        const parts = window.SkyePersonalVault.splitPath(item.path || '');
        const name = parts.pop() || item.name || 'Folder';
        const parent = parts.join('/');
        await window.SkyePersonalVault.createFolder(name, parent);
        count += 1;
        continue;
      }
      let blob = null;
      if (entry.blobBase64) {
        const bytes = Uint8Array.from(atob(entry.blobBase64), (c) => c.charCodeAt(0));
        blob = new Blob([bytes], { type: entry.blobType || item.mimeType || 'application/octet-stream' });
      } else if (item.htmlContent || item.plainText) {
        blob = new Blob([item.htmlContent || item.plainText || ''], { type: item.mimeType || 'text/plain' });
      }
      const folderPath = item.folderPath || '';
      if (item.extension === '.skye' || item.kind === 'doc') {
        if (blob) {
          await window.SkyePersonalVault.upsertFile(blob, {
            folderPath,
            name: item.name,
            kind: 'doc',
            editable: true,
            htmlContent: item.htmlContent || '',
            plainText: item.plainText || '',
            previewText: item.previewText || '',
            mimeType: item.mimeType || 'application/x-skye-document'
          });
        }
      } else if (blob) {
        await window.SkyePersonalVault.upsertFile(blob, {
          folderPath,
          name: item.name,
          mimeType: item.mimeType,
          htmlContent: item.htmlContent || '',
          plainText: item.plainText || '',
          previewText: item.previewText || '',
          editable: item.editable
        });
      }
      count += 1;
    }
    return { count };
  }

  async function backupVault() {
    const snapshot = await exportSnapshot();
    return api('/.netlify/functions/vault-backup', { method: 'POST', body: { snapshot } });
  }

  async function restoreVault() {
    const data = await api('/.netlify/functions/vault-backup');
    if (!data?.snapshot?.snapshot) return { count: 0 };
    return importSnapshot(data.snapshot.snapshot);
  }

  async function loadProfile() {
    const data = await api('/.netlify/functions/vault-profile');
    state.profile = data.profile || null;
    const form = document.querySelector('#membership-form');
    if (form && state.profile) {
      for (const [key, value] of Object.entries(state.profile)) {
        const field = form.querySelector(`[name="${key}"]`);
        if (field) field.value = value || '';
      }
    }
    const badge = document.querySelector('#thumb-tier-badge');
    if (badge) badge.textContent = state.profile?.thumb_drive_tier ? `${state.profile.thumb_drive_tier} annual thumb drive` : 'Annual thumb drive tier not set yet';
    return state.profile;
  }

  async function saveProfile(formData) {
    const payload = Object.fromEntries(formData.entries());
    const data = await api('/.netlify/functions/vault-profile', { method: 'POST', body: payload });
    state.profile = data.profile || null;
    await loadProfile();
    return data;
  }

  function initIdentity() {
    loadSessionUser()
      .catch(() => {})
      .finally(() => {
        updateAccountUi();
        if (state.sessionUser) loadProfile().catch(() => {});
        broadcastIdentity();
      });

    if (!identityAvailable()) {
      return;
    }

    window.netlifyIdentity.on('init', (user) => {
      state.user = user || null;
      updateAccountUi();
      if (state.user) loadProfile().catch(() => {});
      broadcastIdentity();
    });
    window.netlifyIdentity.on('login', (user) => {
      state.user = user || null;
      updateAccountUi();
      setStatus('Hosted account connected. Netlify-side backup is awake.', 'good');
      loadProfile().catch(() => {});
      broadcastIdentity();
      window.netlifyIdentity.close();
    });
    window.netlifyIdentity.on('logout', () => {
      state.user = null;
      updateAccountUi();
      setStatus('Logged out. Local vault still works.', 'warn');
      broadcastIdentity();
    });
    window.netlifyIdentity.init();
  }

  return {
    state,
    api,
    activeUser,
    updateAccountUi,
    initIdentity,
    backupVault,
    restoreVault,
    loadProfile,
    saveProfile,
    setStatus
  };
})();
