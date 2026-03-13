const VaultPage = {
  currentFolderPath: '',
  items: [],
  allItems: [],
  dragDepth: 0,
  pendingMoveId: null,
  dragMoveItemId: null,

  async boot() {
    await window.SkyePersonalVault.ensureSeed();
    await this.loadSettings();
    this.bind();
    this.bindDropzone();
    await this.refresh();
    window.SkyeVaultSuperideBridge?.init?.(this);
    window.SkyeHosted?.initIdentity?.();
    const params = new URLSearchParams(window.location.search);
    if (params.get('settings') === '1') this.openSettings();
  },

  async loadSettings() {
    const modelInput = document.querySelector('#kaixu-model-input');
    if (modelInput) modelInput.value = await window.SkyePersonalVault.getSetting('kaixuModel') || await window.SkyePersonalVault.getSetting('openaiModel') || 'kAIxU-Prime6.7';
    const folderName = await window.SkyePersonalVault.getSetting('syncFolderName');
    const lastSync = await window.SkyePersonalVault.getSetting('lastDiskSyncAt');
    const box = document.querySelector('#folder-sync-status');
    if (box) box.textContent = folderName ? `Connected folder: ${folderName}${lastSync ? ` · last sync ${window.SKYE.formatDate(lastSync)}` : ''}` : 'No folder connected yet.';

    const dockCollapsed = await window.SkyePersonalVault.getSetting('aiDockCollapsed');
    const dock = document.querySelector('#ai-dock');
    if (dock && dockCollapsed !== null) this.setDockCollapsed(Boolean(dockCollapsed), false);
    if (dock && dockCollapsed === null) this.setDockCollapsed(true, false);
  },

  bind() {
    document.querySelector('#search-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.render();
    });
    document.querySelector('#search-input')?.addEventListener('input', () => this.render());

    document.querySelector('#new-folder-button')?.addEventListener('click', async () => {
      const name = window.prompt('Folder name');
      if (!name) return;
      try {
        await window.SkyePersonalVault.createFolder(name, this.currentFolderPath);
        await this.refresh();
        window.SKYE.toast('Folder created.');
      } catch (error) {
        window.SKYE.toast(error.message, 'warn');
      }
    });

    document.querySelector('#new-doc-button')?.addEventListener('click', async () => {
      const title = window.prompt('Document title', 'Untitled Document');
      if (!title) return;
      const item = await window.SkyePersonalVault.createBlankDoc({ title, folderPath: this.currentFolderPath });
      window.location.href = `../apps/docx/index.html?vaultDocId=${encodeURIComponent(item.id)}`;
    });

    document.querySelector('#connect-folder-button')?.addEventListener('click', async () => {
      try {
        const handle = await window.SkyePersonalVault.chooseSyncFolder();
        if (!handle) return;
        await this.loadSettings();
        window.SKYE.toast(`Connected ${handle.name}.`);
      } catch (error) {
        window.SKYE.toast(error.message, 'warn');
      }
    });

    document.querySelector('#sync-folder-button')?.addEventListener('click', async () => {
      try {
        const result = await window.SkyePersonalVault.syncToFolder();
        await this.loadSettings();
        await this.refresh();
        window.SKYE.toast(`Synced ${result.count} item${result.count === 1 ? '' : 's'} to ${result.folderName}.`);
      } catch (error) {
        window.SKYE.toast(error.message, 'warn');
      }
    });

    document.querySelector('#import-folder-button')?.addEventListener('click', async () => {
      try {
        const result = await window.SkyePersonalVault.importFromFolder();
        await this.loadSettings();
        await this.refresh();
        window.SKYE.toast(`Imported ${result.count} file${result.count === 1 ? '' : 's'}.`);
      } catch (error) {
        window.SKYE.toast(error.message, 'warn');
      }
    });

    document.querySelector('#save-ai-settings-button')?.addEventListener('click', async () => {
      const model = document.querySelector('#kaixu-model-input').value.trim() || 'kAIxU-Prime6.7';
      await window.SkyePersonalVault.setSetting('kaixuModel', model);
      await window.SkyePersonalVault.setSetting('openaiModel', model);
      window.SKYE.toast('AI model preference saved.');
    });

    document.querySelector('#ask-ai-button')?.addEventListener('click', async () => {
      await this.askVaultAI();
    });
    document.querySelectorAll('[data-ai-chip]').forEach((button) => button.addEventListener('click', async () => {
      const input = document.querySelector('#ai-prompt-input');
      if (!input) return;
      input.value = button.getAttribute('data-ai-chip') || '';
      await this.askVaultAI();
    }));

    document.querySelector('#dock-settings-button')?.addEventListener('click', () => this.openSettings());
    document.querySelector('#ai-dock-toggle')?.addEventListener('click', () => this.toggleDock());

    document.querySelector('#backup-cloud-button')?.addEventListener('click', async () => {
      try {
        window.SkyeHosted.setStatus('Saving hosted backup…');
        await window.SkyeHosted.backupVault();
        window.SkyeHosted.setStatus('Hosted backup saved.', 'good');
        window.SKYE.toast('Hosted backup saved.');
      } catch (error) {
        window.SkyeHosted.setStatus(error.message, 'warn');
        window.SKYE.toast(error.message, 'warn');
      }
    });

    document.querySelector('#restore-cloud-button')?.addEventListener('click', async () => {
      try {
        window.SkyeHosted.setStatus('Restoring hosted backup…');
        const result = await window.SkyeHosted.restoreVault();
        await this.refresh();
        window.SkyeHosted.setStatus(`Hosted backup restored (${result.count} item${result.count === 1 ? '' : 's'}).`, 'good');
        window.SKYE.toast(`Restored ${result.count} item${result.count === 1 ? '' : 's'} from hosted backup.`);
      } catch (error) {
        window.SkyeHosted.setStatus(error.message, 'warn');
        window.SKYE.toast(error.message, 'warn');
      }
    });

    document.querySelector('#membership-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = await window.SkyeHosted.saveProfile(new FormData(event.currentTarget));
        window.SKYE.toast(`Membership profile saved (${data.profile.thumb_drive_tier}).`);
        window.SkyeHosted.setStatus(`Profile synced to ${data.backend}.`, 'good');
      } catch (error) {
        window.SkyeHosted.setStatus(error.message, 'warn');
        window.SKYE.toast(error.message, 'warn');
      }
    });

    document.querySelector('#dropbar-upload-button')?.addEventListener('click', () => document.querySelector('#file-input')?.click());
    document.querySelector('#dropbar-folder-button')?.addEventListener('click', () => document.querySelector('#folder-input')?.click());

    document.querySelectorAll('#open-settings-button, #hero-settings-button').forEach((button) => {
      button?.addEventListener('click', () => this.openSettings());
    });
    document.querySelectorAll('[data-close-settings]').forEach((button) => {
      button?.addEventListener('click', () => this.closeSettings());
    });

    document.querySelector('#confirm-move-button')?.addEventListener('click', async () => {
      await this.confirmMove();
    });
    document.querySelectorAll('[data-close-move]').forEach((button) => {
      button?.addEventListener('click', () => this.closeMoveModal());
    });
    document.querySelector('#move-folder-select')?.addEventListener('change', (event) => {
      const text = event.target.selectedOptions?.[0]?.textContent || 'Root';
      const pathBox = document.querySelector('#move-modal-path');
      if (pathBox) pathBox.textContent = text;
    });

    window.addEventListener('skye:identity-ready', async (event) => {
      const user = event.detail?.user || null;
      const promptedKey = 'skyevaultpro:settings-prompted';
      if (!user && !sessionStorage.getItem(promptedKey)) {
        sessionStorage.setItem(promptedKey, '1');
        this.openSettings();
      }
      if (user) await this.loadSettings();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.closeSettings();
      this.closeMoveModal();
    });
  },

  setDockCollapsed(collapsed, persist = true) {
    const dock = document.querySelector('#ai-dock');
    const toggle = document.querySelector('#ai-dock-toggle');
    if (!dock || !toggle) return;
    dock.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? '❮' : '❯';
    if (persist) window.SkyePersonalVault.setSetting('aiDockCollapsed', collapsed).catch(() => {});
  },

  toggleDock() {
    const dock = document.querySelector('#ai-dock');
    this.setDockCollapsed(!dock?.classList.contains('collapsed'));
  },

  openSettings() {
    const modal = document.querySelector('#settings-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    window.SkyeHosted?.updateAccountUi?.();
    window.SkyeHosted?.loadProfile?.().catch(() => {});
  },

  closeSettings() {
    const modal = document.querySelector('#settings-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('#move-modal:not(.hidden)')) document.body.classList.remove('modal-open');
  },

  async openMoveModal(itemId) {
    const item = await window.SkyePersonalVault.getItem(itemId);
    if (!item) return;
    this.pendingMoveId = itemId;
    const select = document.querySelector('#move-folder-select');
    const title = document.querySelector('#move-modal-title');
    const pathBox = document.querySelector('#move-modal-path');
    if (!select) return;
    let folders = this.allItems.filter((entry) => entry.kind === 'folder');
    if (item.kind === 'folder') {
      const sourcePath = window.SkyePersonalVault.normalizePath(item.path);
      folders = folders.filter((folder) => folder.id !== item.id && folder.path !== sourcePath && !window.SkyePersonalVault.normalizePath(folder.path).startsWith(`${sourcePath}/`));
    }
    folders.sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
    const current = window.SkyePersonalVault.normalizePath(item.folderPath || '');
    select.innerHTML = ['<option value="">Root</option>', ...folders.map((folder) => `<option value="${folder.path}" ${window.SkyePersonalVault.normalizePath(folder.path) === current ? 'selected' : ''}>${folder.path}</option>`)].join('');
    if (title) title.textContent = `Move ${item.name}`;
    if (pathBox) pathBox.textContent = select.selectedOptions?.[0]?.textContent || 'Root';
    const modal = document.querySelector('#move-modal');
    modal?.classList.remove('hidden');
    modal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  },

  closeMoveModal() {
    this.pendingMoveId = null;
    const modal = document.querySelector('#move-modal');
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('#settings-modal:not(.hidden)')) document.body.classList.remove('modal-open');
  },

  async confirmMove() {
    if (!this.pendingMoveId) return;
    const select = document.querySelector('#move-folder-select');
    const nextFolderPath = window.SkyePersonalVault.normalizePath(select?.value || '');
    try {
      await window.SkyePersonalVault.moveItem(this.pendingMoveId, nextFolderPath);
      await this.refresh();
      window.SKYE.toast('Moved.');
      this.closeMoveModal();
    } catch (error) {
      window.SKYE.toast(error.message, 'warn');
    }
  },

  bindDropzone() {
    const dropzone = document.querySelector('#dropzone');
    const input = document.querySelector('#file-input');
    const folderInput = document.querySelector('#folder-input');
    const overlay = document.querySelector('#drag-overlay');
    if (!dropzone || !input) return;

    dropzone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      input.click();
    });
    document.querySelector('#pick-folder-upload-button')?.addEventListener('click', () => folderInput?.click());

    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('drag');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
    dropzone.addEventListener('drop', async (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag');
      overlay?.classList.remove('show');
      await this.ingestDataTransfer(event.dataTransfer);
    });

    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      await this.addFiles(files, { originLabel: 'file picker' });
      input.value = '';
    });

    folderInput?.addEventListener('change', async () => {
      const files = Array.from(folderInput.files || []);
      await this.addFiles(files, { originLabel: 'folder picker', preservePaths: true });
      folderInput.value = '';
    });

    document.addEventListener('dragenter', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      this.dragDepth += 1;
      overlay?.classList.add('show');
    });

    document.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      overlay?.classList.add('show');
    });

    document.addEventListener('dragleave', () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (!this.dragDepth) overlay?.classList.remove('show');
    });

    document.addEventListener('drop', async (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      this.dragDepth = 0;
      overlay?.classList.remove('show');
      if (dropzone.contains(event.target)) return;
      if (event.dataTransfer.getData('text/skye-item-id')) return;
      await this.ingestDataTransfer(event.dataTransfer);
    });
  },

  async ingestDataTransfer(dataTransfer) {
    const entries = await this.collectDroppedFiles(dataTransfer);
    if (!entries.length) return;
    await this.addFiles(entries.map((entry) => entry.file), { originLabel: 'drag & drop', preservePaths: true, relativePaths: entries.map((entry) => entry.relativePath || entry.file.webkitRelativePath || entry.file.name) });
  },

  async collectDroppedFiles(dataTransfer) {
    const items = Array.from(dataTransfer.items || []);
    const richEntries = [];
    if (items.length && items.some((item) => typeof item.webkitGetAsEntry === 'function')) {
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (!entry) continue;
        richEntries.push(...await this.readEntry(entry, ''));
      }
      return richEntries;
    }
    return Array.from(dataTransfer.files || []).map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));
  },

  async readEntry(entry, parentPath = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      return [{ file, relativePath: window.SkyePersonalVault.joinPath(parentPath, file.name) }];
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const batch = [];
      const readAll = async () => {
        const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!children.length) return;
        for (const child of children) batch.push(...await this.readEntry(child, window.SkyePersonalVault.joinPath(parentPath, entry.name)));
        await readAll();
      };
      await readAll();
      return batch;
    }
    return [];
  },

  async addFiles(files, { originLabel = 'import', preservePaths = false, relativePaths = [] } = {}) {
    if (!files.length) return;
    const stats = { added: 0, unpacked: 0, errors: 0 };
    const output = document.querySelector('#dropzone-status');
    if (output) output.textContent = `Processing ${files.length} item${files.length === 1 ? '' : 's'} from ${originLabel}…`;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const relativePath = preservePaths ? (relativePaths[index] || file.webkitRelativePath || file.name) : file.name;
        if (/\.zip$/i.test(file.name) && window.JSZip) {
          const result = await this.unpackZip(file);
          stats.added += result.added;
          stats.unpacked += 1;
        } else {
          await this.storeFile(file, relativePath);
          stats.added += 1;
        }
      } catch (error) {
        stats.errors += 1;
        console.error(error);
        window.SKYE.toast(`${file.name}: ${error.message}`, 'warn');
      }
    }

    await this.refresh();
    if (output) output.textContent = `${stats.added} item${stats.added === 1 ? '' : 's'} added${stats.unpacked ? ` · ${stats.unpacked} zip${stats.unpacked === 1 ? '' : 's'} unpacked` : ''}${stats.errors ? ` · ${stats.errors} issue${stats.errors === 1 ? '' : 's'}` : ''}.`;
    window.SKYE.toast(output?.textContent || 'Files added.');
  },

  async storeFile(file, relativePath = file.name) {
    const cleanPath = window.SkyePersonalVault.normalizePath(relativePath);
    const parts = cleanPath.split('/').filter(Boolean);
    const name = parts.pop() || file.name;
    let folderPath = this.currentFolderPath;
    if (parts.length) {
      folderPath = window.SkyePersonalVault.joinPath(this.currentFolderPath, parts.join('/'));
      await this.ensureFolderPath(folderPath);
    }
    await window.SkyePersonalVault.upsertFile(file, { folderPath, name: name || file.name });
  },

  async ensureFolderPath(path = '') {
    let current = '';
    for (const segment of window.SkyePersonalVault.splitPath(path)) {
      await window.SkyePersonalVault.createFolder(segment, current);
      current = window.SkyePersonalVault.joinPath(current, segment);
    }
  },

  async unpackZip(file) {
    const zip = await window.JSZip.loadAsync(file);
    const baseName = String(file.name || 'archive').replace(/\.zip$/i, '');
    const zipRoot = window.SkyePersonalVault.joinPath(this.currentFolderPath, baseName);
    await this.ensureFolderPath(zipRoot);
    let added = 0;

    const entries = Object.values(zip.files);
    for (const entry of entries) {
      if (entry.dir) {
        await this.ensureFolderPath(window.SkyePersonalVault.joinPath(zipRoot, entry.name));
        continue;
      }
      const targetPath = window.SkyePersonalVault.joinPath(zipRoot, entry.name);
      const parts = window.SkyePersonalVault.splitPath(targetPath);
      const name = parts.pop() || entry.name;
      const folderPath = parts.join('/');
      await this.ensureFolderPath(folderPath);
      const blob = await entry.async('blob');
      await window.SkyePersonalVault.upsertFile(blob, {
        folderPath,
        name,
        mimeType: window.SkyePersonalVault.guessMime(name, blob.type || 'application/octet-stream')
      });
      added += 1;
    }
    return { added };
  },

  query() {
    return (document.querySelector('#search-input')?.value || '').trim();
  },

  async refresh() {
    this.allItems = await window.SkyePersonalVault.listAllItems();
    this.items = await window.SkyePersonalVault.listFolder(this.currentFolderPath, this.query());
    await this.paintOverview();
    await this.paintActivity();
    this.render();
  },

  async paintOverview() {
    const list = document.querySelector('#vault-metrics');
    const files = this.allItems.filter((item) => item.kind !== 'folder');
    const folders = this.allItems.filter((item) => item.kind === 'folder');
    const bytes = files.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
    const docs = files.filter((item) => item.editable || item.kind === 'doc').length;
    const synced = files.filter((item) => item.diskSyncedAt).length;
    if (list) {
      list.innerHTML = `
        <div class="metric"><strong>${files.length}</strong><span>stored files</span></div>
        <div class="metric"><strong>${folders.length}</strong><span>folders</span></div>
        <div class="metric"><strong>${window.SKYE.formatBytes(bytes)}</strong><span>vault weight</span></div>
        <div class="metric"><strong>${docs}</strong><span>editable docs</span></div>
        <div class="metric"><strong>${synced}</strong><span>disk-synced items</span></div>
        <div class="metric"><strong>${this.currentFolderPath || 'Root'}</strong><span>current lane</span></div>
      `;
    }
    const status = document.querySelector('#vault-status');
    if (status) status.textContent = navigator.onLine ? 'Vault ready' : 'Vault ready · offline';
    const stateNode = document.querySelector('#sync-status');
    if (stateNode) stateNode.textContent = navigator.onLine ? 'Local vault live · disk sync lives in Settings' : 'Offline mode active · local vault still available';
  },

  async paintActivity() {
    const list = document.querySelector('#activity-list');
    if (!list) return;
    const events = await window.SkyePersonalVault.listEvents(8);
    list.innerHTML = events.length ? events.map((event) => `
      <div class="list-item compact-item">
        <div>
          <strong>${String(event.type || '').replace(/_/g, ' ')}</strong>
          <p>${window.SKYE.formatDate(event.createdAt)}${event.detail?.path ? ` · ${event.detail.path}` : ''}</p>
        </div>
      </div>
    `).join('') : '<div class="empty-state notice">Vault activity will show up here.</div>';
  },

  breadcrumbs() {
    const segments = window.SkyePersonalVault.splitPath(this.currentFolderPath);
    const crumbs = [{ path: '', name: 'Vault' }];
    let current = '';
    for (const segment of segments) {
      current = window.SkyePersonalVault.joinPath(current, segment);
      crumbs.push({ path: current, name: segment });
    }
    return crumbs;
  },

  render() {
    this.paintBreadcrumbs();
    this.paintQuickAccess();
    this.paintFolderTree();
    this.paintFolders();
    this.paintFiles();
    window.SkyeVaultSuperideBridge?.sync?.(this);
  },

  paintBreadcrumbs() {
    const node = document.querySelector('#breadcrumbs');
    if (!node) return;
    const crumbs = this.breadcrumbs();
    node.innerHTML = crumbs.map((crumb, index) => `<button type="button" data-crumb="${crumb.path}">${crumb.name}${index < crumbs.length - 1 ? ' /' : ''}</button>`).join(' ');
    node.querySelectorAll('[data-crumb]').forEach((button) => button.addEventListener('click', async () => {
      this.currentFolderPath = button.getAttribute('data-crumb') || '';
      await this.refresh();
    }));
  },

  paintQuickAccess() {
    const node = document.querySelector('#quick-access-list');
    if (!node) return;
    const hasDocuments = this.allItems.some((item) => item.kind === 'folder' && window.SkyePersonalVault.normalizePath(item.path) === 'Documents');
    const hasMedia = this.allItems.some((item) => item.kind === 'folder' && window.SkyePersonalVault.normalizePath(item.path) === 'Media');
    const links = [
      { label: 'My Vault', icon: '⌘', type: 'jump', path: '' },
      ...(hasDocuments ? [{ label: 'Documents', icon: '🗂️', type: 'jump', path: 'Documents' }] : []),
      ...(hasMedia ? [{ label: 'Media', icon: '🖼️', type: 'jump', path: 'Media' }] : []),
      { label: 'SkyeDocx', icon: '✦', type: 'link', href: '../apps/docx/index.html' },
      { label: 'Founder', icon: '☄', type: 'link', href: '../founder/index.html' },
      { label: 'Settings', icon: '⚙', type: 'action', action: 'settings' }
    ];
    node.innerHTML = links.map((item) => {
      if (item.type === 'link') return `<a class="tree-button" href="${item.href}"><span>${item.icon}</span><span>${item.label}</span></a>`;
      return `<button type="button" class="tree-button ${item.type === 'jump' && window.SkyePersonalVault.normalizePath(item.path) === window.SkyePersonalVault.normalizePath(this.currentFolderPath) ? 'active' : ''}" ${item.type === 'jump' ? `data-quick-jump="${item.path}"` : 'data-open-settings-shortcut="1"'}><span>${item.icon}</span><span>${item.label}</span></button>`;
    }).join('');
    node.querySelectorAll('[data-quick-jump]').forEach((button) => button.addEventListener('click', async () => {
      this.currentFolderPath = button.getAttribute('data-quick-jump') || '';
      await this.refresh();
    }));
    node.querySelectorAll('[data-open-settings-shortcut]').forEach((button) => button.addEventListener('click', () => this.openSettings()));
  },

  paintFolderTree() {
    const node = document.querySelector('#folder-tree');
    if (!node) return;
    const folders = this.allItems.filter((item) => item.kind === 'folder').sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
    node.innerHTML = folders.length ? folders.map((folder) => {
      const depth = Math.max(0, window.SkyePersonalVault.splitPath(folder.path).length - 1);
      const active = window.SkyePersonalVault.normalizePath(folder.path) === window.SkyePersonalVault.normalizePath(this.currentFolderPath);
      return `
        <div class="tree-row drop-target" data-drop-folder="${folder.path}" style="--depth:${depth};">
          <button type="button" class="tree-button ${active ? 'active' : ''}" data-open-folder-tree="${folder.path}"><span>📁</span><span>${folder.name}</span></button>
        </div>
      `;
    }).join('') : '<div class="empty-state notice">No folders yet.</div>';
    node.querySelectorAll('[data-open-folder-tree]').forEach((button) => button.addEventListener('click', async () => {
      this.currentFolderPath = button.getAttribute('data-open-folder-tree') || '';
      await this.refresh();
    }));
    this.bindFolderDropTargets(node);
  },

  paintFolders() {
    const grid = document.querySelector('#folder-grid');
    if (!grid) return;
    const folders = this.items.filter((item) => item.kind === 'folder');
    grid.innerHTML = folders.length ? folders.map((folder) => `
      <article class="folder-card-drive drop-target" data-drop-folder="${folder.path}" data-draggable-item="${folder.id}" draggable="true">
        <div class="folder-card-head">
          <div class="file-name"><span class="file-icon">📁</span><span>${folder.name}</span></div>
          <span class="badge">Folder</span>
        </div>
        <p class="small">${folder.path || 'Root'} · updated ${window.SKYE.formatDate(folder.updatedAt)}</p>
        <div class="actions" style="margin-top:12px;">
          <button data-open-folder="${folder.path}">Open</button>
          <button data-rename-item="${folder.id}">Rename</button>
          <button data-move-item="${folder.id}">Move</button>
          <button data-delete-item="${folder.id}">Delete</button>
        </div>
      </article>
    `).join('') : '<div class="empty-state notice">No folders in this lane yet.</div>';
    grid.querySelectorAll('[data-open-folder]').forEach((button) => button.addEventListener('click', async () => {
      this.currentFolderPath = button.getAttribute('data-open-folder') || '';
      await this.refresh();
    }));
    this.bindItemActions(grid);
    this.bindDraggables(grid);
    this.bindFolderDropTargets(grid);
  },

  paintFiles() {
    const body = document.querySelector('#file-table-body');
    if (!body) return;
    const files = this.items.filter((item) => item.kind !== 'folder');
    body.innerHTML = files.length ? files.map((item) => `
      <tr class="drive-row" data-draggable-item="${item.id}" draggable="true">
        <td>
          <div class="file-name">
            <span class="file-icon">${item.extension === '.skye' ? '✦' : item.extension === '.zip' ? '🗜️' : '📄'}</span>
            <div>
              <div>${item.name}</div>
              <div class="small">${item.folderPath || 'Root'}${item.previewText ? ` · ${item.previewText.slice(0, 110)}${item.previewText.length > 110 ? '…' : ''}` : ''}</div>
            </div>
          </div>
        </td>
        <td>${window.SKYE.mimeBadge(item.mimeType, item.name)}</td>
        <td>${window.SKYE.formatBytes(item.sizeBytes)}</td>
        <td>${window.SKYE.formatDate(item.updatedAt)}</td>
        <td>
          <div class="actions">
            ${item.editable ? `<button data-edit-item="${item.id}">Edit</button>` : `<button data-open-item="${item.id}">Open</button>`}
            <button data-download-item="${item.id}">Download</button>
            <button data-export-superide="${item.id}">Send to SuperIDE</button>
            <button data-rename-item="${item.id}">Rename</button>
            <button data-move-item="${item.id}">Move</button>
            <button data-delete-item="${item.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5"><div class="empty-state">No files in this folder yet.</div></td></tr>';
    body.querySelectorAll('[data-open-item]').forEach((button) => button.addEventListener('click', () => this.openFile(button.getAttribute('data-open-item'))));
    body.querySelectorAll('[data-edit-item]').forEach((button) => button.addEventListener('click', () => {
      const id = button.getAttribute('data-edit-item');
      window.location.href = `../apps/docx/index.html?vaultDocId=${encodeURIComponent(id)}`;
    }));
    body.querySelectorAll('[data-download-item]').forEach((button) => button.addEventListener('click', () => this.downloadFile(button.getAttribute('data-download-item'))));
    body.querySelectorAll('[data-export-superide]').forEach((button) => button.addEventListener('click', () => {
      window.SkyeVaultSuperideBridge?.exportItemToSuperide?.(button.getAttribute('data-export-superide'));
    }));
    this.bindItemActions(body);
    this.bindDraggables(body);
  },

  bindDraggables(root) {
    root.querySelectorAll('[data-draggable-item]').forEach((node) => {
      node.addEventListener('dragstart', (event) => {
        const itemId = node.getAttribute('data-draggable-item');
        if (!itemId) return;
        this.dragMoveItemId = itemId;
        event.dataTransfer?.setData('text/skye-item-id', itemId);
        event.dataTransfer.effectAllowed = 'move';
        node.classList.add('dragging');
      });
      node.addEventListener('dragend', () => {
        this.dragMoveItemId = null;
        node.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      });
    });
  },

  bindFolderDropTargets(root) {
    root.querySelectorAll('[data-drop-folder]').forEach((node) => {
      node.addEventListener('dragover', (event) => {
        if (!this.dragMoveItemId) return;
        event.preventDefault();
        node.classList.add('drag-over');
      });
      node.addEventListener('dragleave', () => node.classList.remove('drag-over'));
      node.addEventListener('drop', async (event) => {
        if (!this.dragMoveItemId) return;
        event.preventDefault();
        node.classList.remove('drag-over');
        const folderPath = node.getAttribute('data-drop-folder') || '';
        await this.handleItemDrop(this.dragMoveItemId, folderPath);
      });
    });
  },

  async handleItemDrop(itemId, folderPath) {
    try {
      await window.SkyePersonalVault.moveItem(itemId, folderPath);
      await this.refresh();
      const destination = folderPath || 'Root';
      window.SKYE.toast(`Moved to ${destination}.`);
    } catch (error) {
      window.SKYE.toast(error.message, 'warn');
    } finally {
      this.dragMoveItemId = null;
      document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    }
  },

  bindItemActions(root) {
    root.querySelectorAll('[data-rename-item]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.getAttribute('data-rename-item');
      const item = await window.SkyePersonalVault.getItem(id);
      if (!item) return;
      const next = window.prompt('New name', item.name);
      if (!next || next === item.name) return;
      try {
        await window.SkyePersonalVault.renameItem(id, next.trim());
        await this.refresh();
        window.SKYE.toast('Renamed.');
      } catch (error) {
        window.SKYE.toast(error.message, 'warn');
      }
    }));

    root.querySelectorAll('[data-move-item]').forEach((button) => button.addEventListener('click', async () => {
      await this.openMoveModal(button.getAttribute('data-move-item'));
    }));

    root.querySelectorAll('[data-delete-item]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.getAttribute('data-delete-item');
      const item = await window.SkyePersonalVault.getItem(id);
      if (!item) return;
      const ok = window.confirm(`Delete ${item.name}?`);
      if (!ok) return;
      await window.SkyePersonalVault.deleteItem(id);
      await this.refresh();
      window.SKYE.toast('Deleted.');
    }));
  },

  async openFile(id) {
    const blob = await window.SkyePersonalVault.getBlob(id);
    const item = await window.SkyePersonalVault.getItem(id);
    if (!item) return;
    const fallbackBlob = blob || new Blob([item.htmlContent || item.plainText || ''], { type: item.mimeType || 'text/plain' });
    const url = URL.createObjectURL(fallbackBlob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  },

  async downloadFile(id) {
    const blob = await window.SkyePersonalVault.getBlob(id);
    const item = await window.SkyePersonalVault.getItem(id);
    if (!item) return;
    const fallbackBlob = blob || new Blob([item.htmlContent || item.plainText || ''], { type: item.mimeType || 'text/plain' });
    const url = URL.createObjectURL(fallbackBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  },

  async askVaultAI() {
    const output = document.querySelector('#ai-output');
    const prompt = document.querySelector('#ai-prompt-input')?.value.trim();
    if (!prompt) return window.SKYE.toast('Ask something first.', 'warn');

    const model = document.querySelector('#kaixu-model-input')?.value.trim() || 'kAIxU-Prime6.7';
    await window.SkyePersonalVault.setSetting('kaixuModel', model);
    await window.SkyePersonalVault.setSetting('openaiModel', model);
    const corpus = this.allItems.filter((item) => item.kind !== 'folder').slice(0, 80).map((item) => ({
      name: item.name,
      path: item.path,
      mimeType: item.mimeType,
      updatedAt: item.updatedAt,
      previewText: (item.previewText || item.plainText || '').slice(0, 1200)
    }));

    if (output) output.textContent = 'Thinking over your vault…';
    try {
      const data = await window.SkyeHosted.api('/.netlify/functions/ai-vault', {
        method: 'POST',
        body: { prompt, model, corpus }
      });
      if (output) output.textContent = data.text || 'No answer returned.';
      return;
    } catch (error) {
      const hits = corpus.filter((item) => JSON.stringify(item).toLowerCase().includes(prompt.toLowerCase())).slice(0, 8);
      if (output) output.textContent = hits.length
        ? `Hosted AI helper unavailable right now. Local matches:\n\n${hits.map((item) => `• ${item.path}`).join('\n')}`
        : `Hosted AI helper unavailable right now. ${error.message}`;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => VaultPage.boot());
