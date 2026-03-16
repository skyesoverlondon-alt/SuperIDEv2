
import { kvGet, kvSet, setActiveNav, fmtDate } from '../../assets/app-core.js';

let state = {
  company:'Skyes Over London',
  app:'SkyeCloud',
  email:'SkyesOverLondonLC@SOLEnterprises.org',
  phone:'(480) 469-5416',
  headline:'A heavier creative environment with dedicated production lanes.',
  primary:'#7c5cff',
  secondary:'#22d3ee',
  accent:'#fbbf24',
  notes:'Keep the polish sharp. Keep the nonsense out.'
};

function render(){
  document.querySelector('#company').value = state.company;
  document.querySelector('#app').value = state.app;
  document.querySelector('#email').value = state.email;
  document.querySelector('#phone').value = state.phone;
  document.querySelector('#headline').value = state.headline;
  document.querySelector('#primary').value = state.primary;
  document.querySelector('#secondary').value = state.secondary;
  document.querySelector('#accent').value = state.accent;
  document.querySelector('#notes').value = state.notes;
  document.querySelector('#chip-primary').style.background = state.primary;
  document.querySelector('#chip-secondary').style.background = state.secondary;
  document.querySelector('#chip-accent').style.background = state.accent;
  document.querySelector('#brand-preview').innerHTML = `<h3>${state.app}</h3><p>${state.headline}</p><p><strong>${state.company}</strong><br>${state.email}<br>${state.phone}</p><div class="badge">Brand board live</div>`;
}
async function persist(){
  await kvSet('skyecloud.brand.profile', state);
  document.querySelector('#brand-status').textContent = `Saved ${fmtDate(Date.now())}`;
}
async function init(){
  setActiveNav('BrandBoard');
  state = await kvGet('skyecloud.brand.profile', state);
  render();
  ['company','app','email','phone','headline','primary','secondary','accent','notes'].forEach(id => {
    document.querySelector(`#${id}`).addEventListener('input', async (e) => {
      state[id] = e.target.value;
      render();
      await persist();
    });
  });
}
init();
