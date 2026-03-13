window.SkyePersonalVault = (() => {
  const DB_NAME = 'skye-personal-vault';
  const DB_VERSION = 1;
  const STORES = { items: 'items', blobs: 'blobs', settings: 'settings', events: 'events' };
  let dbPromise = null;

  const uid = (prefix = 'itm') => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = () => Date.now();
  const normalizePath = (path = '') => String(path || '').replace(/^\/+|\/+$/g, '').trim();
  const splitPath = (path = '') => normalizePath(path).split('/').filter(Boolean);
  const joinPath = (...parts) => normalizePath(parts.filter(Boolean).join('/'));

  function extensionFor(name = '') {
    const match = String(name).match(/(\.[^.]+)$/);
    return match ? match[1].toLowerCase() : '';
  }

  function guessMime(name = '', fallback = 'application/octet-stream') {
    const ext = extensionFor(name);
    const map = {
      '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html', '.htm': 'text/html', '.json': 'application/json',
      '.csv': 'text/csv', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif', '.skye': 'application/x-skye-document', '.zip': 'application/zip'
    };
    return map[ext] || fallback;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.items)) {
          const store = db.createObjectStore(STORES.items, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('folderPath', 'folderPath', { unique: false });
          store.createIndex('kind', 'kind', { unique: false });
          store.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.blobs)) db.createObjectStore(STORES.blobs, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORES.events)) {
          const store = db.createObjectStore(STORES.events, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function withStore(storeNames, mode, run) {
    const db = await openDb();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      const stores = Object.fromEntries(names.map((name) => [name, tx.objectStore(name)]));
      let result;
      try { result = run(stores, tx); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async function get(store, key) {
    const db = await openDb();
    const tx = db.transaction(store, 'readonly');
    return requestValue(tx.objectStore(store).get(key));
  }

  async function getAll(store, indexName = null, query = null) {
    const db = await openDb();
    const tx = db.transaction(store, 'readonly');
    const source = indexName ? tx.objectStore(store).index(indexName) : tx.objectStore(store);
    return requestValue(source.getAll(query)).then((items) => items || []);
  }

  async function put(store, value) { return withStore(store, 'readwrite', (stores) => stores[store].put(value)); }
  async function del(store, key) { return withStore(store, 'readwrite', (stores) => stores[store].delete(key)); }

  async function logEvent(type, detail = {}) {
    return put(STORES.events, { id: uid('evt'), createdAt: now(), type, detail });
  }

  async function ensureSeed() {
    const items = await listAllItems();
    if (items.length) return;
    const docsFolder = { id: uid('fld'), kind: 'folder', name: 'Documents', folderPath: '', path: 'Documents', updatedAt: now() };
    const mediaFolder = { id: uid('fld'), kind: 'folder', name: 'Media', folderPath: '', path: 'Media', updatedAt: now() };
    await put(STORES.items, docsFolder);
    await put(STORES.items, mediaFolder);
    await createBlankDoc({ title: 'Welcome to SkyeVault Pro', folderPath: 'Documents', htmlContent: `<h1>Welcome to SkyeVault Pro</h1><p>This vault keeps your files close, your folder logic clean, and your SkyeDocx edits in the family.</p><ul><li>Create <strong>.skye</strong> docs</li><li>Drop files, folders, and zip stacks</li><li>Choose a vault folder on disk</li><li>Sync copies out whenever you want</li></ul>` });
    await logEvent('vault_seeded');
  }

  async function listAllItems() {
    const items = await getAll(STORES.items);
    return items.sort((a, b) => {
      if (a.kind === 'folder' && b.kind !== 'folder') return -1;
      if (a.kind !== 'folder' && b.kind === 'folder') return 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  async function listEvents(limit = 25) {
    const events = await getAll(STORES.events);
    return events.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, limit);
  }

  async function listFolder(folderPath = '', query = '') {
    const target = normalizePath(folderPath);
    const items = await listAllItems();
    const q = String(query || '').trim().toLowerCase();
    return items.filter((item) => normalizePath(item.folderPath || '') === target)
      .filter((item) => !q || String(item.name || '').toLowerCase().includes(q) || String(item.previewText || '').toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.kind === 'folder' && b.kind !== 'folder') return -1;
        if (a.kind !== 'folder' && b.kind === 'folder') return 1;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }

  async function getItem(id) { return get(STORES.items, id); }
  async function getBlob(id) { const row = await get(STORES.blobs, id); return row?.blob || null; }

  async function setSetting(key, value) { return put(STORES.settings, { key, value, updatedAt: now() }); }
  async function getSetting(key) { const row = await get(STORES.settings, key); return row?.value ?? null; }

  async function createFolder(name, folderPath = '') {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Folder name required.');
    const path = joinPath(folderPath, clean);
    const existing = (await listAllItems()).find((item) => item.kind === 'folder' && normalizePath(item.path) === path);
    if (existing) return existing;
    const folder = { id: uid('fld'), kind: 'folder', name: clean, folderPath: normalizePath(folderPath), path, updatedAt: now() };
    await put(STORES.items, folder);
    await logEvent('folder_created', { path });
    return folder;
  }

  async function buildPreviewFromBlob(blob, mimeType, name) {
    const textLike = String(mimeType || '').startsWith('text/') || ['.md', '.html', '.json', '.csv'].includes(extensionFor(name));
    if (!textLike) return '';
    try {
      const text = await blob.text();
      return text.replace(/\s+/g, ' ').trim().slice(0, 4000);
    } catch {
      return '';
    }
  }

  async function upsertFile(fileOrBlob, options = {}) {
    const isFile = typeof File !== 'undefined' && fileOrBlob instanceof File;
    const blob = fileOrBlob;
    const name = options.name || (isFile ? fileOrBlob.name : 'file.bin');
    const folderPath = normalizePath(options.folderPath || '');
    const mimeType = options.mimeType || blob.type || guessMime(name);
    const existing = options.id ? await getItem(options.id) : null;
    const id = existing?.id || uid('fil');
    const previewText = options.previewText ?? await buildPreviewFromBlob(blob, mimeType, name);
    const item = {
      ...(existing || {}),
      id,
      kind: options.kind || (extensionFor(name) === '.skye' ? 'doc' : 'file'),
      name,
      folderPath,
      path: joinPath(folderPath, name),
      mimeType,
      sizeBytes: blob.size || 0,
      updatedAt: now(),
      extension: extensionFor(name),
      editable: (options.editable ?? (/\.skye$/i.test(name) || /^text\//.test(mimeType) || /html|json|markdown/.test(mimeType))),
      previewText,
      htmlContent: options.htmlContent ?? existing?.htmlContent ?? '',
      plainText: options.plainText ?? existing?.plainText ?? previewText,
      sourceFormat: options.sourceFormat || existing?.sourceFormat || (extensionFor(name) === '.skye' ? 'skye' : mimeType),
      diskSyncedAt: existing?.diskSyncedAt || null,
    };
    await put(STORES.items, item);
    await put(STORES.blobs, { id, blob, updatedAt: now() });
    await logEvent(existing ? 'file_updated' : 'file_added', { id, path: item.path });
    return item;
  }

  async function createBlankDoc({ title = 'Untitled Document', folderPath = '', htmlContent = '<h1>Untitled Document</h1><p>Start writing here...</p>' } = {}) {
    const cleanTitle = String(title || 'Untitled Document').trim() || 'Untitled Document';
    const item = {
      id: uid('doc'),
      kind: 'doc',
      name: `${cleanTitle}.skye`,
      folderPath: normalizePath(folderPath),
      path: joinPath(folderPath, `${cleanTitle}.skye`),
      mimeType: 'application/x-skye-document',
      sizeBytes: 0,
      updatedAt: now(),
      extension: '.skye',
      editable: true,
      previewText: htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000),
      htmlContent,
      plainText: htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      sourceFormat: 'skye-draft',
      diskSyncedAt: null,
    };
    await put(STORES.items, item);
    await logEvent('doc_created', { id: item.id, path: item.path });
    return item;
  }

  async function deleteItem(id) {
    const item = await getItem(id);
    if (!item) return;
    if (item.kind === 'folder') {
      const target = normalizePath(item.path);
      const items = await listAllItems();
      for (const child of items.filter((entry) => normalizePath(entry.folderPath || '').startsWith(target))) {
        await deleteItem(child.id);
      }
    }
    await del(STORES.items, id);
    await del(STORES.blobs, id);
    await logEvent('item_deleted', { id, path: item.path });
  }

  async function renameItem(id, nextName) {
    const item = await getItem(id);
    if (!item) throw new Error('Item not found.');
    const clean = String(nextName || '').trim();
    if (!clean) throw new Error('Name required.');
    const oldPath = normalizePath(item.path);
    const items = await listAllItems();
    const candidatePath = joinPath(item.folderPath, clean);
    if (items.some((entry) => entry.id !== id && normalizePath(entry.path) === normalizePath(candidatePath))) {
      throw new Error('Another item already uses that destination.');
    }
    item.name = clean;
    if (item.kind === 'folder') {
      item.path = candidatePath;
      for (const child of items) {
        const childFolder = normalizePath(child.folderPath || '');
        if (child.id !== id && (childFolder === oldPath || childFolder.startsWith(`${oldPath}/`))) {
          child.folderPath = childFolder.replace(oldPath, item.path);
          child.path = child.path.replace(oldPath, item.path);
          await put(STORES.items, child);
        }
      }
    } else {
      item.path = candidatePath;
      item.extension = extensionFor(clean);
      item.mimeType = guessMime(clean, item.mimeType);
    }
    item.updatedAt = now();
    await put(STORES.items, item);
    await logEvent('item_renamed', { id, path: item.path });
    return item;
  }

  async function moveItem(id, nextFolderPath = '') {
    const item = await getItem(id);
    if (!item) throw new Error('Item not found.');
    const items = await listAllItems();
    const oldPath = normalizePath(item.path);
    const folderPath = normalizePath(nextFolderPath);
    const candidatePath = joinPath(folderPath, item.name);

    if (item.kind === 'folder') {
      if (folderPath === oldPath || folderPath.startsWith(`${oldPath}/`)) {
        throw new Error('A folder cannot be moved into itself or one of its descendants.');
      }
      if (items.some((entry) => entry.id !== id && !normalizePath(entry.path).startsWith(`${oldPath}/`) && (normalizePath(entry.path) === normalizePath(candidatePath) || normalizePath(entry.path).startsWith(`${normalizePath(candidatePath)}/`)))) {
        throw new Error('That destination already contains a folder or files with the same path.');
      }
    } else if (items.some((entry) => entry.id !== id && normalizePath(entry.path) === normalizePath(candidatePath))) {
      throw new Error('That destination already contains an item with the same name.');
    }

    item.folderPath = folderPath;
    item.path = candidatePath;
    item.updatedAt = now();
    await put(STORES.items, item);
    if (item.kind === 'folder') {
      for (const child of items) {
        const childFolder = normalizePath(child.folderPath || '');
        if (child.id !== id && (childFolder === oldPath || childFolder.startsWith(`${oldPath}/`))) {
          child.folderPath = childFolder.replace(oldPath, item.path);
          child.path = child.path.replace(oldPath, item.path);
          await put(STORES.items, child);
        }
      }
    }
    await logEvent('item_moved', { id, path: item.path });
    return item;
  }

  async function updateDocShadow(id, patch = {}) {
    const item = await getItem(id);
    if (!item) throw new Error('Document not found.');
    Object.assign(item, patch, { updatedAt: now() });
    if (patch.name) {
      item.extension = extensionFor(patch.name);
      item.mimeType = guessMime(patch.name, item.mimeType);
      item.path = joinPath(item.folderPath, patch.name);
    }
    await put(STORES.items, item);
    return item;
  }

  async function saveEditorCommit(id, { name, htmlContent, plainText, blob, mimeType = '', previewText = '' } = {}) {
    const item = await getItem(id);
    if (!item) throw new Error('Document not found.');
    item.name = name || item.name;
    item.path = joinPath(item.folderPath, item.name);
    item.extension = extensionFor(item.name);
    item.mimeType = mimeType || guessMime(item.name, item.mimeType);
    item.htmlContent = htmlContent ?? item.htmlContent ?? '';
    item.plainText = plainText ?? item.plainText ?? '';
    item.previewText = previewText ?? item.plainText.slice(0, 4000);
    item.sizeBytes = blob?.size || item.sizeBytes || 0;
    item.updatedAt = now();
    item.sourceFormat = item.extension === '.skye' ? 'skye' : item.mimeType;
    await put(STORES.items, item);
    if (blob) await put(STORES.blobs, { id, blob, updatedAt: now() });
    await logEvent('doc_committed', { id, path: item.path });
    return item;
  }

  async function readDirectory(handle, prefix = '') {
    const imported = [];
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') {
        if (entry.name === '.skye-vault-manifest.json') continue;
        const file = await entry.getFile();
        const folderPath = normalizePath(prefix);
        imported.push(await upsertFile(file, { folderPath, name: file.name }));
      } else if (entry.kind === 'directory') {
        imported.push(...await readDirectory(entry, joinPath(prefix, entry.name)));
      }
    }
    return imported;
  }

  async function chooseSyncFolder() {
    if (!window.showDirectoryPicker) throw new Error('This browser does not support direct folder sync. Use Chrome or another Chromium browser.');
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' }).catch(() => null);
    if (!handle) return null;
    await setSetting('syncFolderHandle', handle);
    await setSetting('syncFolderName', handle.name || 'Vault Folder');
    await logEvent('sync_folder_connected', { name: handle.name || 'Vault Folder' });
    return handle;
  }

  async function getSyncFolderHandle() {
    const handle = await getSetting('syncFolderHandle');
    if (!handle) return null;
    if (handle.requestPermission) {
      const status = await handle.queryPermission({ mode: 'readwrite' });
      if (status !== 'granted') {
        const granted = await handle.requestPermission({ mode: 'readwrite' });
        if (granted !== 'granted') throw new Error('Folder permission was not granted.');
      }
    }
    return handle;
  }

  async function ensureDir(root, folderPath = '') {
    let current = root;
    for (const segment of splitPath(folderPath)) {
      current = await current.getDirectoryHandle(segment, { create: true });
    }
    return current;
  }

  async function syncToFolder(handle = null) {
    const root = handle || await getSyncFolderHandle();
    if (!root) throw new Error('Choose a vault folder first.');
    const items = await listAllItems();
    const manifest = [];
    for (const item of items) {
      if (item.kind === 'folder') {
        await ensureDir(root, item.path);
        manifest.push({ id: item.id, kind: item.kind, path: item.path, updatedAt: item.updatedAt });
        continue;
      }
      const dir = await ensureDir(root, item.folderPath);
      const fileHandle = await dir.getFileHandle(item.name, { create: true });
      const writer = await fileHandle.createWritable();
      let blob = await getBlob(item.id);
      if (!blob && item.htmlContent) blob = new Blob([item.htmlContent], { type: item.mimeType || 'text/html' });
      if (!blob) blob = new Blob([''], { type: item.mimeType || 'application/octet-stream' });
      await writer.write(blob);
      await writer.close();
      item.diskSyncedAt = now();
      await put(STORES.items, item);
      manifest.push({ id: item.id, kind: item.kind, path: item.path, updatedAt: item.updatedAt, sizeBytes: item.sizeBytes, mimeType: item.mimeType });
    }
    const manifestHandle = await root.getFileHandle('.skye-vault-manifest.json', { create: true });
    const manifestWriter = await manifestHandle.createWritable();
    await manifestWriter.write(JSON.stringify({ exportedAt: new Date().toISOString(), items: manifest }, null, 2));
    await manifestWriter.close();
    await setSetting('lastDiskSyncAt', now());
    await logEvent('sync_completed', { count: manifest.length, folder: root.name || 'Vault Folder' });
    return { count: manifest.length, folderName: root.name || 'Vault Folder' };
  }

  async function importFromFolder(handle = null) {
    const root = handle || await chooseSyncFolder();
    if (!root) return { count: 0 };
    const imported = await readDirectory(root, '');
    await setSetting('lastImportAt', now());
    await logEvent('import_completed', { count: imported.length, folder: root.name || 'Vault Folder' });
    return { count: imported.length, folderName: root.name || 'Vault Folder' };
  }

  return {
    uid, now, normalizePath, joinPath, splitPath, extensionFor, guessMime,
    openDb, ensureSeed, listAllItems, listFolder, listEvents, getItem, getBlob,
    setSetting, getSetting, createFolder, createBlankDoc, upsertFile, deleteItem,
    renameItem, moveItem, updateDocShadow, saveEditorCommit, chooseSyncFolder,
    getSyncFolderHandle, syncToFolder, importFromFolder, logEvent,
  };
})();
