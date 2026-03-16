
import { kvGet, kvSet, uid, aiChat, setActiveNav, fmtDate } from '../../assets/app-core.js';

let state = [];
let selectedId = null;

function current(){ return state.find(item => item.id === selectedId) || null; }
async function persist(){
  await kvSet('skyecloud.prompts.items', state);
  await kvSet('skyecloud.prompts.activeId', selectedId);
  document.querySelector('#prompt-status').textContent = `Saved ${fmtDate(Date.now())}`;
}
function renderList(){
  const list = document.querySelector('#prompt-list');
  list.innerHTML = '';
  state.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'card-item' + (item.id === selectedId ? ' active' : '');
    btn.innerHTML = `<strong>${item.title}</strong><span>${item.category}</span>`;
    btn.onclick = () => { selectedId = item.id; renderEditor(); renderList(); };
    list.appendChild(btn);
  });
}
function renderEditor(){
  const item = current();
  document.querySelector('#prompt-title').value = item?.title || '';
  document.querySelector('#prompt-category').value = item?.category || '';
  document.querySelector('#prompt-system').value = item?.system || '';
  document.querySelector('#prompt-user').value = item?.user || '';
}
async function runPrompt(){
  const item = current();
  if (!item) return;
  const task = document.querySelector('#prompt-task').value.trim();
  const system = `${item.system}\n\nYou are working inside SkyeCloud, a multi-surface creative environment.`;
  const user = `${item.user}\n\nTask:\n${task}`;
  const out = document.querySelector('#prompt-response');
  out.textContent = 'kAIxU is thinking…';
  try {
    const res = await aiChat(user, system);
    out.textContent = res.output || 'No response received.';
  } catch (err) {
    out.textContent = err.message;
  }
}
async function init(){
  setActiveNav('PromptStudio');
  state = await kvGet('skyecloud.prompts.items', [
    { id:uid('prompt'), title:'App planner', category:'Product', system:'Be structured and bluntly useful.', user:'Draft a sharp product plan with lanes, risks, and next actions.' },
    { id:uid('prompt'), title:'Landing page engine', category:'Marketing', system:'Write high-conversion copy without fluff.', user:'Create a landing page structure with hero, proof, features, CTA, and FAQ.' }
  ]);
  selectedId = await kvGet('skyecloud.prompts.activeId', state[0]?.id || null);
  renderList(); renderEditor();

  ['#prompt-title','#prompt-category','#prompt-system','#prompt-user'].forEach(sel => {
    document.querySelector(sel).addEventListener('input', async () => {
      const item = current();
      if (!item) return;
      item.title = document.querySelector('#prompt-title').value;
      item.category = document.querySelector('#prompt-category').value;
      item.system = document.querySelector('#prompt-system').value;
      item.user = document.querySelector('#prompt-user').value;
      await persist();
      renderList();
    });
  });

  document.querySelector('#new-prompt').onclick = async () => {
    const item = { id:uid('prompt'), title:'New prompt', category:'General', system:'Be useful.', user:'Write the thing.' };
    state.unshift(item); selectedId = item.id; await persist(); renderList(); renderEditor();
  };
  document.querySelector('#run-prompt').onclick = runPrompt;
}
init();
