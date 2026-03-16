
import { kvGet, kvSet, uid, setActiveNav, fmtDate } from '../../assets/app-core.js';

let state = [];
async function persist(){
  await kvSet('skyecloud.snippets.items', state);
  document.querySelector('#snippet-status').textContent = `Saved ${fmtDate(Date.now())}`;
}
function render(){
  const q = document.querySelector('#snippet-search').value.toLowerCase();
  const wrap = document.querySelector('#snippet-list');
  wrap.innerHTML = '';
  state.filter(item => {
    const hay = `${item.title} ${item.tags} ${item.language} ${item.code}`.toLowerCase();
    return hay.includes(q);
  }).forEach(item => {
    const el = document.createElement('article');
    el.className = 'card-item';
    el.innerHTML = `<strong>${item.title}</strong><span>${item.language} · ${item.tags || 'untagged'}</span><div class="pre" style="margin-top:10px;min-height:0">${item.code}</div><div class="action-row" style="margin-top:10px"><button class="small-btn btn" data-copy>Copy</button><button class="small-btn ghost" data-edit>Edit</button><button class="small-btn danger" data-delete>Delete</button></div>`;
    el.querySelector('[data-copy]').onclick = async () => navigator.clipboard.writeText(item.code);
    el.querySelector('[data-edit]').onclick = async () => {
      const title = prompt('Title', item.title); if (title === null) return;
      const tags = prompt('Tags', item.tags || ''); if (tags === null) return;
      const code = prompt('Code', item.code); if (code === null) return;
      item.title = title; item.tags = tags; item.code = code; await persist(); render();
    };
    el.querySelector('[data-delete]').onclick = async () => { state = state.filter(x => x.id !== item.id); await persist(); render(); };
    wrap.appendChild(el);
  });
}
async function init(){
  setActiveNav('SnippetVault');
  state = await kvGet('skyecloud.snippets.items', [
    { id:uid('snip'), title:'Fetch JSON helper', language:'javascript', tags:'fetch, json', code:'const getJSON = (url) => fetch(url).then((res) => res.json());' }
  ]);
  render();

  document.querySelector('#snippet-search').addEventListener('input', render);
  document.querySelector('#new-snippet').onclick = async () => {
    state.unshift({ id:uid('snip'), title:'New snippet', language:'javascript', tags:'', code:'// write your snippet here' });
    await persist(); render();
  };
}
init();
