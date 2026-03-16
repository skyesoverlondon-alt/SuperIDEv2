
import { kvGet, kvSet, uid, setActiveNav, fmtDate } from '../../assets/app-core.js';

const defaultBoard = {
  lanes: [
    { id:'backlog', title:'Backlog', cards:[{ id:uid('card'), title:'Define the mission', detail:'Clarify what ships first.' }]},
    { id:'build', title:'Build', cards:[{ id:uid('card'), title:'Wire the core lane', detail:'Keep the logic honest.' }]},
    { id:'review', title:'Review', cards:[]},
    { id:'live', title:'Live', cards:[]}
  ]
};
let state = defaultBoard;

async function persist(){
  await kvSet('skyecloud.flowboard.board', state);
  document.querySelector('#board-status').textContent = `Saved ${fmtDate(Date.now())}`;
}
function moveCard(laneIndex, cardIndex, dir){
  const targetLaneIndex = laneIndex + dir;
  if (targetLaneIndex < 0 || targetLaneIndex >= state.lanes.length) return;
  const [card] = state.lanes[laneIndex].cards.splice(cardIndex, 1);
  state.lanes[targetLaneIndex].cards.unshift(card);
}
function render(){
  const wrap = document.querySelector('#lanes');
  wrap.innerHTML = '';
  state.lanes.forEach((lane, laneIndex) => {
    const laneEl = document.createElement('section');
    laneEl.className = 'lane';
    laneEl.innerHTML = `<h3>${lane.title}</h3><div class="muted">${lane.cards.length} cards</div><div class="stack" style="margin-top:12px"></div>`;
    const stack = laneEl.querySelector('.stack');
    lane.cards.forEach((card, cardIndex) => {
      const el = document.createElement('article');
      el.className = 'task-card';
      el.innerHTML = `<strong>${card.title}</strong><p>${card.detail}</p><div class="action-row"><button class="small-btn ghost" data-left>←</button><button class="small-btn ghost" data-edit>Edit</button><button class="small-btn ghost" data-right>→</button><button class="small-btn danger" data-delete>Delete</button></div>`;
      el.querySelector('[data-left]').onclick = async () => { moveCard(laneIndex, cardIndex, -1); await persist(); render(); };
      el.querySelector('[data-right]').onclick = async () => { moveCard(laneIndex, cardIndex, 1); await persist(); render(); };
      el.querySelector('[data-delete]').onclick = async () => { lane.cards.splice(cardIndex,1); await persist(); render(); };
      el.querySelector('[data-edit]').onclick = async () => {
        const title = prompt('Card title', card.title);
        if (title === null) return;
        const detail = prompt('Card detail', card.detail);
        if (detail === null) return;
        card.title = title; card.detail = detail; await persist(); render();
      };
      stack.appendChild(el);
    });
    wrap.appendChild(laneEl);
  });
}
async function init(){
  setActiveNav('FlowBoard');
  state = await kvGet('skyecloud.flowboard.board', defaultBoard);
  render();
  document.querySelector('#new-card').onclick = async () => {
    const title = prompt('Card title', 'New card');
    if (!title) return;
    state.lanes[0].cards.unshift({ id: uid('card'), title, detail:'' });
    await persist(); render();
  };
}
init();
