
import { kvGet, kvSet, uid, downloadFile, setActiveNav, fmtDate } from '../../assets/app-core.js';

const state = {
  projects: [],
  activeProjectId: null,
  activeFileId: null
};

const starterProject = () => ({
  id: uid('project'),
  name: 'New SkyeCloud Project',
  updatedAt: Date.now(),
  files: [
    { id: uid('file'), name: 'index.html', content: '<main class="app-shell">\n  <h1>SkyeCloud project</h1>\n  <p>Build something dangerous to mediocrity.</p>\n</main>' },
    { id: uid('file'), name: 'styles.css', content: 'body{font-family:Inter,system-ui,sans-serif;background:#0b1220;color:white;padding:32px}.app-shell{max-width:760px;margin:0 auto;padding:24px;border-radius:20px;background:#111a2e;border:1px solid rgba(255,255,255,.08)}' },
    { id: uid('file'), name: 'app.js', content: 'console.log("SkyeCloud ready");' }
  ]
});

async function save(){
  const serial = state.projects.map(p => ({ ...p, updatedAt: Date.now() }));
  await kvSet('skyecloud.ide.projects', serial);
  await kvSet('skyecloud.ide.activeProjectId', state.activeProjectId);
  await kvSet('skyecloud.ide.activeFileId', state.activeFileId);
  document.querySelector('#save-status').textContent = `Saved ${fmtDate(Date.now())}`;
}

function currentProject(){
  return state.projects.find(p => p.id === state.activeProjectId) || null;
}
function currentFile(){
  const project = currentProject();
  return project?.files.find(f => f.id === state.activeFileId) || null;
}

function projectMetrics(project){
  const files = project?.files || [];
  const bytes = files.reduce((sum, file) => sum + (file.content?.length || 0), 0);
  return `${files.length} files · ${bytes.toLocaleString()} chars`;
}

function renderProjects(){
  const wrap = document.querySelector('#projects');
  wrap.innerHTML = '';
  state.projects.forEach(project => {
    const el = document.createElement('button');
    el.className = 'card-item' + (project.id === state.activeProjectId ? ' active' : '');
    el.innerHTML = `<strong>${project.name}</strong><span>${projectMetrics(project)}</span>`;
    el.onclick = () => {
      state.activeProjectId = project.id;
      state.activeFileId = project.files[0]?.id || null;
      renderAll();
    };
    wrap.appendChild(el);
  });
}

function renderFiles(){
  const wrap = document.querySelector('#files');
  wrap.innerHTML = '';
  const project = currentProject();
  if (!project) {
    wrap.innerHTML = '<div class="empty">No project selected.</div>';
    return;
  }
  project.files.forEach(file => {
    const row = document.createElement('div');
    row.className = 'file-row' + (file.id === state.activeFileId ? ' active' : '');
    row.innerHTML = `<button class="ghost small-btn" data-open="${file.id}">${file.name}</button><button class="danger small-btn" data-remove="${file.id}">Delete</button>`;
    row.querySelector('[data-open]').onclick = () => { state.activeFileId = file.id; renderAll(); };
    row.querySelector('[data-remove]').onclick = async () => {
      if (project.files.length === 1) return alert('Every project needs at least one file.');
      project.files = project.files.filter(item => item.id !== file.id);
      if (state.activeFileId === file.id) state.activeFileId = project.files[0].id;
      await save();
      renderAll();
    };
    wrap.appendChild(row);
  });
}

function renderEditor(){
  const project = currentProject();
  const file = currentFile();
  document.querySelector('#project-name').value = project?.name || '';
  document.querySelector('#file-name').value = file?.name || '';
  document.querySelector('#code-editor').value = file?.content || '';
  document.querySelector('#project-meta').textContent = project ? `${projectMetrics(project)} · active ${file?.name || 'none'}` : 'No active project';
  renderPreview();
}

function compiledPreview(project){
  const files = project?.files || [];
  const htmlFile = files.find(f => f.name.toLowerCase().endsWith('.html'));
  const css = files.filter(f => f.name.toLowerCase().endsWith('.css')).map(f => f.content).join('\n');
  const js = files.filter(f => f.name.toLowerCase().endsWith('.js')).map(f => f.content).join('\n');
  const html = htmlFile?.content || '<main><h1>SkyeCloud preview</h1><p>Add an HTML file to control this preview.</p></main>';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${html}<script>${js}<\/script></body></html>`;
}

function renderPreview(){
  const project = currentProject();
  document.querySelector('#preview').srcdoc = compiledPreview(project);
}

function renderAll(){
  renderProjects();
  renderFiles();
  renderEditor();
}

async function init(){
  setActiveNav('CloudCode IDE');
  state.projects = await kvGet('skyecloud.ide.projects', []);
  state.activeProjectId = await kvGet('skyecloud.ide.activeProjectId', null);
  state.activeFileId = await kvGet('skyecloud.ide.activeFileId', null);

  if (!state.projects.length) {
    const project = starterProject();
    state.projects = [project];
    state.activeProjectId = project.id;
    state.activeFileId = project.files[0].id;
    await save();
  }

  if (!currentProject()) state.activeProjectId = state.projects[0].id;
  if (!currentFile()) state.activeFileId = currentProject()?.files[0]?.id || null;
  renderAll();

  document.querySelector('#new-project').onclick = async () => {
    const project = starterProject();
    project.name = `SkyeCloud Project ${state.projects.length + 1}`;
    state.projects.unshift(project);
    state.activeProjectId = project.id;
    state.activeFileId = project.files[0].id;
    await save();
    renderAll();
  };

  document.querySelector('#new-file').onclick = async () => {
    const project = currentProject();
    if (!project) return;
    const name = prompt('File name', `module-${project.files.length + 1}.js`);
    if (!name) return;
    const file = { id: uid('file'), name, content: '' };
    project.files.push(file);
    state.activeFileId = file.id;
    await save();
    renderAll();
  };

  document.querySelector('#project-name').addEventListener('change', async (e) => {
    const project = currentProject();
    if (!project) return;
    project.name = e.target.value.trim() || project.name;
    await save();
    renderProjects();
  });

  document.querySelector('#file-name').addEventListener('change', async (e) => {
    const file = currentFile();
    if (!file) return;
    file.name = e.target.value.trim() || file.name;
    await save();
    renderFiles();
    renderPreview();
  });

  document.querySelector('#code-editor').addEventListener('input', async (e) => {
    const file = currentFile();
    if (!file) return;
    file.content = e.target.value;
    await save();
    renderPreview();
  });

  document.querySelector('#export-project').onclick = () => {
    const project = currentProject();
    if (!project) return;
    downloadFile(`${project.name.replace(/\s+/g,'-').toLowerCase()}.json`, JSON.stringify(project, null, 2), 'application/json');
  };

  document.querySelector('#import-project').addEventListener('change', async (e) => {
    const fileInput = e.target.files?.[0];
    if (!fileInput) return;
    const raw = await fileInput.text();
    try {
      const project = JSON.parse(raw);
      if (!project.id) project.id = uid('project');
      project.files = (project.files || []).map(item => ({ ...item, id: item.id || uid('file') }));
      state.projects.unshift(project);
      state.activeProjectId = project.id;
      state.activeFileId = project.files[0]?.id || null;
      await save();
      renderAll();
    } catch {
      alert('That project import is not valid JSON.');
    }
    e.target.value = '';
  });

  document.querySelector('#starter-basic').onclick = async () => {
    const project = currentProject();
    if (!project) return;
    project.files = [
      { id: uid('file'), name: 'index.html', content: '<section class="card"><h1>Starter landing</h1><p>SkyeCloud made this on purpose.</p><button>Launch</button></section>' },
      { id: uid('file'), name: 'styles.css', content: 'body{font-family:Inter,system-ui;background:#09111f;color:#fff;padding:30px}.card{max-width:680px;margin:auto;padding:28px;border-radius:24px;background:#121d33;border:1px solid rgba(255,255,255,.08)}button{padding:12px 16px;border:none;border-radius:12px;background:#7c5cff;color:#fff}' },
      { id: uid('file'), name: 'app.js', content: 'document.querySelector("button")?.addEventListener("click",()=>alert("SkyeCloud starter live"));' }
    ];
    state.activeFileId = project.files[0].id;
    await save();
    renderAll();
  };
}
init();
