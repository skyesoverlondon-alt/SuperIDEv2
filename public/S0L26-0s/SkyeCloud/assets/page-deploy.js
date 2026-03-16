
import { kvGet, kvSet, uid, downloadFile, pingHealth, setActiveNav, fmtDate } from '../../assets/app-core.js';

let releases = [];
async function persist(){
  await kvSet('skyecloud.deploy.releases', releases);
  document.querySelector('#deploy-status').textContent = `Saved ${fmtDate(Date.now())}`;
}
function render(){
  const wrap = document.querySelector('#release-log');
  wrap.innerHTML = '';
  releases.forEach(item => {
    const row = document.createElement('article');
    row.className = 'card-item';
    row.innerHTML = `<strong>${item.name}</strong><span>${item.notes}</span><div class="muted" style="margin-top:8px">${fmtDate(item.updatedAt)}</div>`;
    wrap.appendChild(row);
  });
}
async function init(){
  setActiveNav('DeployDesk');
  releases = await kvGet('skyecloud.deploy.releases', [
    { id:uid('rel'), name:'SkyeCloud v1', notes:'Initial suite structure with dedicated surfaces.', updatedAt:Date.now() }
  ]);
  render();

  document.querySelector('#new-release').onclick = async () => {
    const name = document.querySelector('#release-name').value.trim();
    const notes = document.querySelector('#release-notes').value.trim();
    if (!name) return alert('Give the release a name.');
    releases.unshift({ id:uid('rel'), name, notes, updatedAt:Date.now() });
    await persist();
    render();
  };

  document.querySelector('#export-runbook').onclick = () => {
    const text = [
      'SkyeCloud Deploy Runbook',
      '',
      '1. Set OPENAI_API_KEY only if you want the kAIxU server lane active.',
      '2. Deploy the full folder to Netlify.',
      '3. Visit /.netlify/functions/health to verify runtime.',
      '4. Open the suite and build inside CloudCode.',
      '',
      'Releases:',
      ...releases.map(item => `- ${item.name} :: ${item.notes}`)
    ].join('\n');
    downloadFile('skyecloud-runbook.txt', text, 'text/plain');
  };

  document.querySelector('#check-health').onclick = async () => {
    const out = document.querySelector('#health-result');
    out.textContent = 'Checking runtime…';
    const health = await pingHealth();
    out.textContent = JSON.stringify(health, null, 2);
  };
}
init();
