
import { kvGet, kvSet, uid, markdownToHTML, downloadFile, setActiveNav, fmtDate } from '../../assets/app-core.js';

const state = { docs: [], activeId: null };

function currentDoc(){ return state.docs.find(doc => doc.id === state.activeId) || null; }

async function save(){
  await kvSet('skyecloud.docs.documents', state.docs);
  await kvSet('skyecloud.docs.activeId', state.activeId);
  document.querySelector('#docs-status').textContent = `Saved ${fmtDate(Date.now())}`;
}
function renderList(){
  const list = document.querySelector('#docs-list');
  list.innerHTML = '';
  state.docs.forEach(doc => {
    const el = document.createElement('button');
    el.className = 'card-item' + (doc.id === state.activeId ? ' active' : '');
    el.innerHTML = `<strong>${doc.title}</strong><span>${doc.tags || 'untagged'}</span>`;
    el.onclick = () => { state.activeId = doc.id; renderAll(); };
    list.appendChild(el);
  });
}
function renderAll(){
  renderList();
  const doc = currentDoc();
  document.querySelector('#doc-title').value = doc?.title || '';
  document.querySelector('#doc-tags').value = doc?.tags || '';
  document.querySelector('#doc-body').value = doc?.body || '';
  document.querySelector('#doc-preview').innerHTML = markdownToHTML(doc?.body || '# Start writing');
}
async function init(){
  setActiveNav('DocLab');
  state.docs = await kvGet('skyecloud.docs.documents', []);
  state.activeId = await kvGet('skyecloud.docs.activeId', null);
  if (!state.docs.length) {
    const doc = { id: uid('doc'), title: 'SkyeCloud Notes', tags:'brief, strategy', body:'# SkyeCloud Notes\n\n- Start with a sharp thesis.\n- Leave fluff in the parking lot.' };
    state.docs = [doc];
    state.activeId = doc.id;
    await save();
  }
  if (!currentDoc()) state.activeId = state.docs[0].id;
  renderAll();

  document.querySelector('#new-doc').onclick = async () => {
    const doc = { id: uid('doc'), title:`Document ${state.docs.length+1}`, tags:'', body:'# New document' };
    state.docs.unshift(doc); state.activeId = doc.id; await save(); renderAll();
  };
  document.querySelector('#doc-title').addEventListener('input', async (e) => { const doc=currentDoc(); if(!doc) return; doc.title=e.target.value; await save(); renderList(); });
  document.querySelector('#doc-tags').addEventListener('input', async (e) => { const doc=currentDoc(); if(!doc) return; doc.tags=e.target.value; await save(); });
  document.querySelector('#doc-body').addEventListener('input', async (e) => { const doc=currentDoc(); if(!doc) return; doc.body=e.target.value; document.querySelector('#doc-preview').innerHTML=markdownToHTML(doc.body); await save(); });
  document.querySelector('#export-doc').onclick = () => { const doc=currentDoc(); if(!doc) return; downloadFile(`${doc.title.replace(/\s+/g,'-').toLowerCase()}.md`, doc.body, 'text/markdown'); };
}
init();
