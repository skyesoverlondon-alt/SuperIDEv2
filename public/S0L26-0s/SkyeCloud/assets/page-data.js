
import { kvGet, kvSet, parseCSV, toCSV, downloadFile, setActiveNav, fmtDate } from '../../assets/app-core.js';

const key = 'skyecloud.dataforge.dataset';
let state = { rows:[['name','role','status'],['Skyes Over London','Founder','Live']], name:'SkyeCloud Sheet' };

function render(){
  document.querySelector('#sheet-name').value = state.name || 'SkyeCloud Sheet';
  const table = document.querySelector('#sheet');
  table.innerHTML = '';
  (state.rows || []).forEach((row, rowIndex) => {
    const tr = document.createElement(rowIndex === 0 ? 'thead' : 'tr');
    const target = rowIndex === 0 ? document.createElement('tr') : tr;
    row.forEach((cell, colIndex) => {
      const tag = rowIndex === 0 ? 'th' : 'td';
      const td = document.createElement(tag);
      if (rowIndex === 0) {
        td.innerHTML = `<input value="${String(cell).replace(/"/g,'&quot;')}">`;
      } else {
        td.innerHTML = `<input value="${String(cell).replace(/"/g,'&quot;')}">`;
      }
      td.querySelector('input').addEventListener('input', async (e) => {
        state.rows[rowIndex][colIndex] = e.target.value;
        await persist();
      });
      target.appendChild(td);
    });
    if (rowIndex === 0) {
      table.appendChild(tr);
      table.appendChild(document.createElement('tbody'));
      table.querySelector('thead').appendChild(target);
    } else {
      table.querySelector('tbody').appendChild(tr);
    }
  });
  document.querySelector('#rows-meta').textContent = `${Math.max((state.rows?.length || 1)-1, 0)} rows · ${(state.rows?.[0]||[]).length} columns`;
}
async function persist(){
  await kvSet(key, state);
  document.querySelector('#data-status').textContent = `Saved ${fmtDate(Date.now())}`;
}
async function init(){
  setActiveNav('DataForge');
  state = await kvGet(key, state);
  render();

  document.querySelector('#sheet-name').addEventListener('input', async (e) => { state.name = e.target.value; await persist(); });
  document.querySelector('#add-row').onclick = async () => { state.rows.push(new Array(state.rows[0].length).fill('')); await persist(); render(); };
  document.querySelector('#add-col').onclick = async () => {
    state.rows.forEach((row, i) => row.push(i === 0 ? `column_${row.length+1}` : ''));
    await persist(); render();
  };
  document.querySelector('#export-csv').onclick = () => downloadFile(`${(state.name||'skyecloud-sheet').replace(/\s+/g,'-').toLowerCase()}.csv`, toCSV(state.rows), 'text/csv');
  document.querySelector('#import-csv').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.rows = parseCSV(await file.text());
    state.name = file.name.replace(/\.csv$/i,'');
    await persist(); render(); e.target.value='';
  });
}
init();
