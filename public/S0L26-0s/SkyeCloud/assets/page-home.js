
import { kvGet, pingHealth, setActiveNav, fmtDate } from './app-core.js';

async function renderMetrics(){
  const [projects, docs, board, snippets, prompts, assets, releases, health] = await Promise.all([
    kvGet('skyecloud.ide.projects', []),
    kvGet('skyecloud.docs.documents', []),
    kvGet('skyecloud.flowboard.board', { lanes:[] }),
    kvGet('skyecloud.snippets.items', []),
    kvGet('skyecloud.prompts.items', []),
    kvGet('skyecloud.asset.meta', []),
    kvGet('skyecloud.deploy.releases', []),
    pingHealth()
  ]);

  const boardCount = (board.lanes || []).reduce((sum, lane) => sum + (lane.cards?.length || 0), 0);
  const stats = {
    projects: projects.length,
    docs: docs.length,
    cards: boardCount,
    snippets: snippets.length,
    prompts: prompts.length,
    assets: assets.length,
    releases: releases.length,
    health: health.configured ? 'kAIxU online' : 'AI lane idle'
  };

  document.querySelector('#metric-projects').textContent = stats.projects;
  document.querySelector('#metric-docs').textContent = stats.docs;
  document.querySelector('#metric-assets').textContent = stats.assets;
  document.querySelector('#metric-ai').textContent = stats.health;
  document.querySelector('#brief').textContent = `Projects ${stats.projects} · Docs ${stats.docs} · Tasks ${stats.cards} · Snippets ${stats.snippets} · Prompts ${stats.prompts} · Releases ${stats.releases}`;
  document.querySelector('#health-meta').textContent = health.ok ? `Health checked ${fmtDate(Date.now())}` : 'Health endpoint unavailable until deployed.';
}

setActiveNav('Home');
renderMetrics();
