
import { assetList, assetPut, assetDelete, kvSet, setActiveNav, fmtDate, uid } from '../../assets/app-core.js';

let items = [];

async function syncMeta(){
  await kvSet('skyecloud.asset.meta', items.map(({blobUrl, dataUrl, ...meta}) => ({...meta})));
  document.querySelector('#asset-status').textContent = `Saved ${fmtDate(Date.now())}`;
}

function render(){
  const wrap = document.querySelector('#asset-grid');
  wrap.innerHTML = '';
  if (!items.length) {
    wrap.innerHTML = '<div class="empty">No assets stored yet. Upload images or lightweight files to start.</div>';
    return;
  }
  items.forEach(item => {
    const card = document.createElement('article');
    card.className = 'asset-card';
    const preview = item.dataUrl && item.type.startsWith('image/')
      ? `<img src="${item.dataUrl}" alt="${item.name}">`
      : `<div class="empty" style="min-height:140px">${item.name.split('.').pop().toUpperCase()}</div>`;
    card.innerHTML = `${preview}<strong style="display:block;margin-top:10px">${item.name}</strong><div class="muted">${(item.size/1024).toFixed(1)} KB · ${item.type || 'file'}</div><div class="action-row" style="margin-top:10px"><button class="small-btn ghost" data-download>Download</button><button class="small-btn danger" data-delete>Delete</button></div>`;
    card.querySelector('[data-download]').onclick = () => {
      const a = document.createElement('a');
      a.href = item.dataUrl || '#';
      a.download = item.name;
      a.click();
    };
    card.querySelector('[data-delete]').onclick = async () => {
      await assetDelete(item.id);
      items = await assetList();
      await syncMeta();
      render();
    };
    wrap.appendChild(card);
  });
}

async function init(){
  setActiveNav('AssetVault');
  items = await assetList();
  render();

  document.querySelector('#asset-upload').addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    for (const file of files) {
      const id = uid('asset');
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      await assetPut({
        id,
        name:file.name,
        type:file.type || 'application/octet-stream',
        size:file.size,
        dataUrl,
        updatedAt:Date.now()
      });
    }
    items = await assetList();
    await syncMeta();
    render();
    e.target.value = '';
  });
}
init();
