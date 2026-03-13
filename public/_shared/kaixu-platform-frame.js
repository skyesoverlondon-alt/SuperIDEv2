(function () {
  const APP_CONFIG = {
    "kAIxU-Vision": {
      track: "Genesis Studio",
      title: "Cinematic concept minting",
      summary: "Vision is the front-end pitch surface for scenes, boards, visual hooks, and first-look universe concepts.",
      buyer: "Best for studios, brands, and storytellers who need a visual first impression before the canon exists.",
      outcome: "Sell the app as a fast concept room for pitches, look-dev, and universe previews.",
    },
    "kAixu-Nexus": {
      track: "Genesis Studio",
      title: "Project minting command",
      summary: "Nexus is the launch chamber for turning a loose idea into a structured kAIxU project with routeable next steps.",
      buyer: "Best for founders, producers, and operators who need a command surface for greenlighting a new branch quickly.",
      outcome: "Pitch Nexus as the point where a new kAIxU initiative becomes a live operating program.",
    },
    "kAIxU-Codex": {
      track: "World Engine",
      title: "Lore system architecture",
      summary: "Codex packages world rules, entries, canon, and editorial continuity into a sellable story operating system.",
      buyer: "Best for long-form narrative teams and IP builders who need continuity, canon, and reusable reference structure.",
      outcome: "Position Codex as the durable editorial backbone of the franchise.",
    },
    "kAIxu-Atmos": {
      track: "Command Deck",
      title: "Mood and atmosphere control",
      summary: "Atmos turns the franchise into a sensory product layer through scripts, audio framing, and presentation moodboards.",
      buyer: "Best for directors, presentation teams, and experience designers who need emotional tone, ambiance, and output polish.",
      outcome: "Pitch Atmos as the bridge from world logic to audience-facing feeling.",
    },
    "kAIxu-Quest": {
      track: "World Engine",
      title: "Mission and campaign design",
      summary: "Quest converts world logic into playable arcs, campaign structures, and operator-ready narrative progression.",
      buyer: "Best for campaign designers and game-minded teams who need progression, stakes, and mission architecture.",
      outcome: "Sell Quest as the engine that turns lore into playable or episodic action.",
    },
    "kAIxu-Forge": {
      track: "Mythic Intelligence",
      title: "Artifact and item systems",
      summary: "Forge is the product lane for weapons, tools, relics, gadgets, and signature objects inside the kAIxU canon.",
      buyer: "Best for teams that monetize or differentiate their worlds through gear, artifacts, and symbolic objects.",
      outcome: "Pitch Forge as the signature object lab for the franchise.",
    },
    "kAIxu-Atlas": {
      track: "World Engine",
      title: "Map and territory intelligence",
      summary: "Atlas positions geography, territory, and travel logic as part of a coherent worldbuilding platform.",
      buyer: "Best for builders of worlds that need territory logic, travel systems, and spatial coherence.",
      outcome: "Position Atlas as the geographic intelligence layer under the canon.",
    },
    "kAixU-Chronos": {
      track: "World Engine",
      title: "Timeline and continuity control",
      summary: "Chronos turns history and sequence into a durable continuity layer for franchises, campaigns, and long-form worlds.",
      buyer: "Best for teams managing multi-era worlds, continuity-sensitive releases, or serialized campaigns.",
      outcome: "Pitch Chronos as the continuity lock that keeps the whole franchise coherent over time.",
    },
    "kAIxu-Bestiary": {
      track: "Mythic Intelligence",
      title: "Creature and species systems",
      summary: "Bestiary is the creature intelligence desk for biologic catalogs, enemy classes, and ecosystem pressure design.",
      buyer: "Best for fantasy, sci-fi, and game teams that need creature logic beyond one-off monster concepts.",
      outcome: "Sell Bestiary as the biological archive and threat design layer of the world.",
    },
    "kAIxu-Mythos": {
      track: "Mythic Intelligence",
      title: "Pantheon and mythology design",
      summary: "Mythos sells the supernatural logic of the world through deities, domains, symbols, and cosmic hierarchy.",
      buyer: "Best for myth-heavy worlds, faith systems, supernatural franchises, and symbolic brand universes.",
      outcome: "Pitch Mythos as the cosmic law and symbolic order layer of the platform.",
    },
    "kAIxU-Faction": {
      track: "Mythic Intelligence",
      title: "Political and power architecture",
      summary: "Faction defines houses, guilds, governments, and power blocs so the world has strategic tension instead of flat lore.",
      buyer: "Best for strategy-heavy settings where alliances, institutions, and power structures drive the narrative.",
      outcome: "Sell Faction as the political intelligence desk of the franchise.",
    },
    "kAIxU-PrimeCommand": {
      track: "Command Deck",
      title: "Franchise synthesis and command",
      summary: "PrimeCommand is the executive layer for unifying the broader universe into a single strategic bible.",
      buyer: "Best for leadership, brand stewards, and executive operators who need the whole family unified in one control surface.",
      outcome: "Pitch PrimeCommand as the strategic command bible over the rest of kAIxU.",
    },
    "kAIxU-Matrix": {
      track: "Genesis Studio",
      title: "Ecosystem incubation core",
      summary: "Matrix acts as the incubation layer for spawning new sub-worlds, sub-brands, and experimental concept branches.",
      buyer: "Best for innovation teams and experimental builders who need a safe place to spin up new branches before promotion.",
      outcome: "Sell Matrix as the incubation lab for future platform lines.",
    },
    "kAIxu-Persona": {
      track: "Mythic Intelligence",
      title: "Character system studio",
      summary: "Persona gives the family a dedicated cast-design product for protagonists, antagonists, and social archetypes.",
      buyer: "Best for story teams, game teams, and brand builders who need a durable cast system instead of one-off characters.",
      outcome: "Pitch Persona as the cast architecture layer for the franchise.",
    },
  };

  function ensureStyle() {
    if (document.getElementById("kaixu-platform-frame-style")) return;
    const style = document.createElement("style");
    style.id = "kaixu-platform-frame-style";
    style.textContent = [
      ".kaixu-platform-frame{padding:14px 24px;border-bottom:1px solid rgba(255,255,255,.08);background:linear-gradient(90deg,rgba(88,32,141,.92),rgba(24,18,58,.94));color:#f8f1ff;display:flex;gap:18px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}",
      ".kaixu-platform-copy{max-width:880px}",
      ".kaixu-platform-kicker{display:block;font-size:10px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:#f4c95d;margin-bottom:6px}",
      ".kaixu-platform-title{display:block;font-size:18px;font-weight:800;line-height:1.2;margin-bottom:6px}",
      ".kaixu-platform-summary{margin:0;color:rgba(248,241,255,.82);font-size:13px;line-height:1.45}",
      ".kaixu-platform-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
      ".kaixu-platform-meta span{display:inline-flex;align-items:center;padding:7px 10px;border-radius:999px;border:1px solid rgba(244,201,93,.18);background:rgba(255,255,255,.05);font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#f7e7af}",
      ".kaixu-platform-links{display:flex;gap:10px;flex-wrap:wrap;align-items:center}",
      ".kaixu-platform-links a{text-decoration:none;color:#f8f1ff;border:1px solid rgba(244,201,93,.28);background:rgba(255,255,255,.06);padding:10px 14px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}",
      ".kaixu-platform-links a.primary{background:linear-gradient(135deg,rgba(244,201,93,.26),rgba(140,70,255,.28));color:#fff8df}",
      "@media (max-width: 720px){.kaixu-platform-frame{padding:14px 16px}.kaixu-platform-links a{width:100%;text-align:center;justify-content:center}}",
    ].join("");
    document.head.appendChild(style);
  }

  function init() {
    const appId = document.body && document.body.dataset ? document.body.dataset.appId : "";
    const config = APP_CONFIG[appId];
    if (!config) return;

    ensureStyle();
    if (document.getElementById("kaixu-platform-frame")) return;

    const nav = document.getElementById("navbar");
    if (!nav) return;

    const params = new URLSearchParams(window.location.search);
    const carry = function (href) {
      const url = new URL(href, window.location.origin);
      ["ws_id", "case_id", "contractor_id"].forEach((key) => {
        const value = params.get(key);
        if (value) url.searchParams.set(key, value);
      });
      return `${url.pathname}${url.search}`;
    };

    const frame = document.createElement("section");
    frame.id = "kaixu-platform-frame";
    frame.className = "kaixu-platform-frame no-print";
    frame.innerHTML = [
      '<div class="kaixu-platform-copy">',
      '<span class="kaixu-platform-kicker">' + config.track + '</span>',
      '<span class="kaixu-platform-title">' + config.title + '</span>',
      '<p class="kaixu-platform-summary">' + config.summary + '</p>',
      '<div class="kaixu-platform-meta">',
      '<span>' + config.buyer + '</span>',
      '<span>' + config.outcome + '</span>',
      '</div>',
      '</div>',
      '<div class="kaixu-platform-links">',
      '<a class="primary" href="' + carry('/kAIxU/index.html') + '">Open kAIxU Platform</a>',
      '<a href="' + carry('/kAIxUSuite/index.html') + '">Open Suite Launcher</a>',
      '<a href="' + carry('/Neural-Space-Pro/index.html') + '">Open Neural Brain</a>',
      '</div>'
    ].join("");
    nav.insertAdjacentElement("afterend", frame);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();