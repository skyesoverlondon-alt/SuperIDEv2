(() => {
  window.__SKYE_PERSONAL__ = true;
  const params = new URLSearchParams(window.location.search);
  const vaultDocId = params.get('vaultDocId');
  if (!vaultDocId) {
    window.__SKYE_DOCX_BOOT__ = (App) => App.boot();
    return;
  }

  const state = { itemId: vaultDocId, item: null, blob: null, saveTimer: null, wireDone: false };

  function escapeHtml(text = '') {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function textToHtml(text = '') {
    return String(text || '').split(/\n{2,}/).map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('') || '<p></p>';
  }

  function htmlToText(html = '') {
    const el = document.createElement('div');
    el.innerHTML = String(html || '');
    return (el.textContent || el.innerText || '').replace(/\s+\n/g, '\n').trim();
  }

  async function dbAssetGet(id) {
    return window.__SKYE_DB__?.get(window.__SKYE_STORES__?.ASSETS, id);
  }

  async function dbAssetPut(record) {
    return window.__SKYE_DB__?.put(window.__SKYE_STORES__?.ASSETS, record);
  }

  async function parseLegacySkye(fileLike) {
    const zip = await JSZip.loadAsync(fileLike);
    const metaFile = zip.file('meta.json');
    const contentFile = zip.file('content.html');
    if (!metaFile || !contentFile) throw new Error('Invalid .skye package.');
    const meta = JSON.parse(await metaFile.async('string'));
    const contentHtml = await contentFile.async('string');
    const assetFiles = Object.keys(zip.files).filter((name) => name.startsWith('assets/') && name.endsWith('.meta.json'));
    for (const metaPath of assetFiles) {
      const assetMeta = JSON.parse(await zip.file(metaPath).async('string'));
      const blobFile = zip.file(`assets/${assetMeta.name}`);
      if (blobFile) {
        const blobData = await blobFile.async('blob');
        const reconstructedBlob = new Blob([blobData], { type: assetMeta.type || 'application/octet-stream' });
        await dbAssetPut({ ...assetMeta, blob: reconstructedBlob });
      }
    }
    return { meta, content: contentHtml };
  }

  async function buildLegacySkyeBlob(App, title) {
    const doc = (App.getActiveDocRecord && App.getActiveDocRecord()) || App.allDocsCache?.[0] || {};
    const zip = new JSZip();
    const assetsFolder = zip.folder('assets');
    const content = App.resolveAssetsForStorage(App.quill.root.innerHTML);
    const parser = new DOMParser();
    const htmlDoc = parser.parseFromString(DOMPurify.sanitize(content), 'text/html');

    for (const img of htmlDoc.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (src && src.startsWith('asset://')) {
        const assetId = src.replace('asset://', '');
        const assetData = await dbAssetGet(assetId);
        if (assetData?.blob) {
          assetsFolder.file(assetData.name, assetData.blob);
          assetsFolder.file(`${assetId}.meta.json`, JSON.stringify({ id: assetData.id, name: assetData.name, type: assetData.type }));
        }
      }
    }

    zip.file('meta.json', JSON.stringify({
      id: state.itemId,
      title,
      updatedAt: Date.now(),
      folderId: state.item?.folderPath || null,
      comments: doc.comments || [],
      suggestions: doc.suggestions || [],
      versions: doc.versions || [],
      metaFields: doc.meta || {}
    }, null, 2));
    zip.file('content.html', content);
    return zip.generateAsync({ type: 'blob' });
  }

  async function loadVaultItem() {
    state.item = await window.SkyePersonalVault.getItem(state.itemId);
    state.blob = await window.SkyePersonalVault.getBlob(state.itemId);
    if (!state.item) throw new Error('Vault document not found.');
    return state.item;
  }

  async function renderIntoEditor(App, title, html) {
    const doc = {
      id: state.itemId,
      title,
      content: html,
      updatedAt: Date.now(),
      versions: [],
      comments: [],
      suggestions: [],
      meta: { classification: 'skyevault-pro', tags: ['SkyeVault Pro'] }
    };
    App.ensureDocCollections(doc);
    App.allDocsCache = [doc];
    App.allFoldersCache = [];
    App.activeDocId = state.itemId;
    App.quill.clipboard.dangerouslyPasteHTML(await App.resolveAssetsForView(html));
    App.quill.history.clear();
    App.lastEditorText = App.quill.getText();
    App.lastSavedRevision = 1;
    App.localDirtySinceRevision = false;
    const titleInput = document.getElementById('doc-title-input');
    if (titleInput) titleInput.value = title;
    const titleWrap = document.getElementById('doc-title-editor-container');
    if (titleWrap) titleWrap.style.display = 'flex';
    document.title = `${title} · SkyeDocxPro`;
    App.renderDocList(App.allDocsCache, true);
    App.updateAnalytics();
    App.generateOutline();
    App.renderPageThumbnails();
    App.renderHeaderFooterBands();
    App.renderCommentsPanel();
    App.renderTimelineList('timeline-side-list');
    App.setStatus('saved');
  }

  async function loadEditableContent(App) {
    await loadVaultItem();
    const ext = String(state.item.extension || '').toLowerCase();
    const title = String(state.item.name || 'Untitled').replace(/\.[^.]+$/, '') || 'Untitled';

    if (ext === '.skye' && state.blob) {
      const secureEnvelope = await App.tryReadSkyeSecureEnvelope(new File([state.blob], state.item.name, { type: state.item.mimeType || 'application/x-skye-document' }));
      if (secureEnvelope) {
        const decrypted = await App.tryDecryptWithPrompt(secureEnvelope.payload);
        const payload = JSON.parse(decrypted);
        for (const asset of payload.assets || []) {
          const blob = await fetch(`data:${asset.type};base64,${asset.data}`).then((r) => r.blob());
          await dbAssetPut({ id: asset.id, name: asset.name, type: asset.type, blob });
        }
        state.item.htmlContent = payload.content || '';
        state.item.plainText = htmlToText(payload.content || '');
        await window.SkyePersonalVault.updateDocShadow(state.itemId, {
          htmlContent: state.item.htmlContent,
          plainText: state.item.plainText,
          previewText: state.item.plainText.slice(0, 4000)
        });
        await renderIntoEditor(App, payload.meta?.title || title, payload.content || '<p></p>');
        return;
      }
      const legacy = await parseLegacySkye(state.blob);
      state.item.htmlContent = legacy.content || '';
      state.item.plainText = htmlToText(legacy.content || '');
      await window.SkyePersonalVault.updateDocShadow(state.itemId, {
        htmlContent: state.item.htmlContent,
        plainText: state.item.plainText,
        previewText: state.item.plainText.slice(0, 4000)
      });
      await renderIntoEditor(App, legacy.meta?.title || title, legacy.content || '<p></p>');
      return;
    }

    if (state.item.htmlContent) {
      await renderIntoEditor(App, title, state.item.htmlContent);
      return;
    }

    if (state.blob) {
      const text = await state.blob.text().catch(() => '');
      const html = ext === '.html' ? text : textToHtml(text);
      await renderIntoEditor(App, title, html);
      return;
    }

    await renderIntoEditor(App, title, '<h1>Untitled Document</h1><p>Start writing here…</p>');
  }

  async function shadowSave(App) {
    if (!state.item) await loadVaultItem();
    const title = (document.getElementById('doc-title-input')?.value || state.item.name.replace(/\.[^.]+$/, '')).trim() || 'Untitled Document';
    const html = App.resolveAssetsForStorage(App.quill.root.innerHTML);
    const plainText = App.quill.getText().replace(/\s+/g, ' ').trim();
    await window.SkyePersonalVault.updateDocShadow(state.itemId, {
      name: `${title}${state.item.extension || '.skye'}`,
      htmlContent: html,
      plainText,
      previewText: plainText.slice(0, 4000),
    });
  }

  async function commitToVault(App) {
    await loadVaultItem();
    const title = (document.getElementById('doc-title-input')?.value || state.item.name.replace(/\.[^.]+$/, '')).trim() || 'Untitled Document';
    const html = App.resolveAssetsForStorage(App.quill.root.innerHTML);
    const plainText = App.quill.getText().trim();
    const ext = String(state.item.extension || '.skye').toLowerCase();
    let blob;
    let mimeType = state.item.mimeType || 'text/html';
    let name = state.item.name;

    if (ext === '.txt') {
      blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
      mimeType = 'text/plain';
      name = `${title}.txt`;
    } else if (ext === '.html' || ext === '.htm') {
      blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      mimeType = 'text/html';
      name = `${title}.html`;
    } else {
      blob = await buildLegacySkyeBlob(App, title);
      mimeType = 'application/x-skye-document';
      name = `${title}.skye`;
    }

    state.item = await window.SkyePersonalVault.saveEditorCommit(state.itemId, {
      name, htmlContent: html, plainText, previewText: plainText.slice(0, 4000), blob, mimeType
    });
    App.showToast('Saved back into SkyeVault Pro.');
    App.setStatus('saved');
  }

  function wirePersonalButtons(App) {
    if (state.wireDone) return;
    state.wireDone = true;
    const actions = document.querySelector('.header-actions');
    if (!actions) return;

    const backBtn = document.createElement('button');
    backBtn.innerHTML = '← Open Vault';
    backBtn.onclick = () => { window.location.href = '../../drive/index.html'; };

    const saveBtn = document.createElement('button');
    saveBtn.innerHTML = 'Push to Vault';
    saveBtn.className = 'primary push-vault-button';
    saveBtn.onclick = () => commitToVault(App).catch((e) => App.showToast(e?.message || String(e)));

    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'push-vault-fab';
    fab.innerHTML = '⬆ Push to Vault';
    fab.onclick = () => commitToVault(App).catch((e) => App.showToast(e?.message || String(e)));
    document.body.appendChild(fab);

    actions.prepend(saveBtn);
    actions.prepend(backBtn);
  }

  window.__SKYE_DOCX_BOOT__ = async (App) => {
    await App.boot();
    await loadEditableContent(App);
    wirePersonalButtons(App);
    App.quill.on('text-change', () => {
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(() => shadowSave(App).catch(() => {}), 900);
    });
  };
})();
