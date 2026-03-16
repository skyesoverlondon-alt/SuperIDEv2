
(function(){
  const data = window.SKYESPACE_DATA || {};
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function avatarText(name){
    return String(name || '').split(/\s+/).filter(Boolean).slice(0,2).map(s => s[0]).join('').toUpperCase() || 'SS';
  }

  function renderRail(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `<div class="rail-item"><strong>${item.name}</strong><span>${item.detail}</span></div>`).join('');
  }

  function renderFeed(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `
      <article class="feed-card">
        <div class="feed-top">
          <div class="feed-user">
            <div class="avatar">${avatarText(item.user)}</div>
            <div class="who"><strong>${item.user}</strong><span>${item.handle} · ${item.time}</span></div>
          </div>
          <button class="chip">Follow</button>
        </div>
        <h4>${item.title}</h4>
        <p>${item.body}</p>
        <div class="media-band"></div>
        <div class="action-row">
          <button class="ghost-btn">React</button>
          <button class="ghost-btn">Reply</button>
          <button class="ghost-btn">Share</button>
          <span class="chip">${item.stats}</span>
        </div>
      </article>`).join('');
  }

  function renderVisuals(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map((item, idx) => `
      <article class="visual-card">
        <div class="visual-art" style="height:${330 + (idx % 3) * 65}px"></div>
        <strong>${item.user}</strong>
        <span class="tiny">${item.handle}</span>
        <h4>${item.title}</h4>
        <p>${item.body}</p>
        <div class="action-row"><button class="ghost-btn">Save</button><button class="chip">Open visual set</button></div>
      </article>`).join('');
  }

  function renderReels(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `
      <article class="reel-card">
        <div class="reel-side"><div class="bubble">♥</div><div class="bubble">↻</div><div class="bubble">✦</div></div>
        <div class="reel-meta"><span class="eyebrow">${item.handle}</span><h4>${item.title}</h4><p>${item.desc}</p></div>
      </article>`).join('');
  }

  function renderThreads(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `
      <article class="thread-card">
        <div class="thread-shell">
          <div class="vote-column"><button class="chip">▲</button><strong>${item.votes}</strong><button class="chip">▼</button></div>
          <div>
            <div class="thread-meta"><span>${item.community}</span><span>•</span><span>${item.tag}</span><span>•</span><span>${item.comments} comments</span></div>
            <h4>${item.title}</h4>
            <p>${item.body}</p>
            <div class="action-row"><button class="ghost-btn">Reply</button><button class="ghost-btn">Save</button><button class="ghost-btn">Share</button></div>
          </div>
        </div>
      </article>`).join('');
  }

  function renderBoards(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map((item, idx) => `
      <article class="board-card">
        <div class="board-cover" style="height:${170 + (idx % 3) * 38}px"></div>
        <h4>${item.title}</h4>
        <p>${item.meta}</p>
        <div class="action-row"><button class="ghost-btn">Open board</button><button class="chip">Save</button></div>
      </article>`).join('');
  }

  function renderJournals(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `
      <article class="journal-card">
        <span class="eyebrow">${item.handle}</span>
        <h4>${item.title}</h4>
        <p>${item.body}</p>
        <div class="action-row"><button class="ghost-btn">Read thread</button><span class="chip">${item.user}</span></div>
      </article>`).join('');
  }

  function renderVideos(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `
      <article class="video-card">
        <div class="video-thumb"></div>
        <h4>${item.title}</h4>
        <div class="video-meta"><span>${item.meta}</span><span>Channel mode</span></div>
        <div class="action-row"><button class="ghost-btn">Watch</button><button class="chip">Queue</button></div>
      </article>`).join('');
  }

  function renderStories(){
    const el = document.getElementById('story-orbit');
    if(!el || !data.stories) return;
    el.innerHTML = data.stories.map(item => `
      <article class="story-pill">
        <div class="story-left"><div class="story-ring"><span>${avatarText(item.name)}</span></div><div><strong>${item.name}</strong><small>${item.time}</small></div></div>
        <span class="tiny">${item.status}</span>
      </article>`).join('');
  }

  function renderCircleGrid(){
    const el = document.getElementById('circle-grid');
    if(!el || !data.circles) return;
    el.innerHTML = data.circles.map(item => `<article class="circle-card"><strong>${item.name}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderCreatorWall(){
    const el = document.getElementById('creator-wall');
    if(!el || !data.creators) return;
    el.innerHTML = data.creators.map(item => `<article class="creator-card"><strong>${item.name}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderPaletteList(){
    const el = document.getElementById('palette-list');
    if(!el || !data.palettes) return;
    el.innerHTML = data.palettes.map(item => `<article class="palette-row"><strong>${item.name}</strong><span class="tiny-note">${item.detail}</span><div class="palette-strip"></div></article>`).join('');
  }

  function renderSoundLadder(){
    const el = document.getElementById('sound-ladder');
    if(!el || !data.sounds) return;
    el.innerHTML = data.sounds.map(item => `<article class="sound-item"><strong>${item.name}</strong><span class="tiny-note">${item.detail}</span><div class="sound-meter"><span style="width:${item.level}%"></span></div></article>`).join('');
  }

  function renderRemixes(){
    const el = document.getElementById('remix-grid');
    if(!el || !data.remixes) return;
    el.innerHTML = data.remixes.map(item => `<article class="remix-card"><strong>${item.title}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderRooms(){
    const el = document.getElementById('room-grid');
    if(!el || !data.rooms) return;
    el.innerHTML = data.rooms.map(item => `<article class="room-card"><strong>${item.name}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderModQueue(){
    const el = document.getElementById('mod-queue');
    if(!el || !data.modQueue) return;
    el.innerHTML = data.modQueue.map(item => `<article class="queue-item"><strong>${item.name}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderPinTrends(){
    const el = document.getElementById('pin-trends');
    if(!el || !data.pins) return;
    el.innerHTML = data.pins.map(item => `<article class="pin-trend"><strong>${item.name}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderQuotes(){
    const el = document.getElementById('quote-wall');
    if(!el || !data.quotes) return;
    el.innerHTML = data.quotes.map(item => `<article class="quote-card"><strong>${item.title}</strong><span>${item.body}</span></article>`).join('');
  }

  function renderPulse(){
    const el = document.getElementById('pulse-deck');
    if(!el || !data.pulse) return;
    el.innerHTML = data.pulse.map(item => `<article class="pulse-card"><strong>${item.name}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderSignals(){
    const el = document.getElementById('signal-map');
    if(!el || !data.signals) return;
    el.innerHTML = data.signals.map(item => `<article class="signal-card"><strong>${item.name}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderHeat(){
    const el = document.getElementById('heat-list');
    if(!el || !data.heat) return;
    el.innerHTML = data.heat.map(item => `<article class="heat-item"><strong>${item.name}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderEditorials(){
    const el = document.getElementById('editorial-river');
    if(!el || !data.editorials) return;
    el.innerHTML = data.editorials.map(item => `<article class="editorial-card"><strong>${item.title}</strong><span>${item.body}</span></article>`).join('');
  }

  function renderMarket(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `<article class="product-card"><div class="product-art"></div><h4>${item.title}</h4><div class="product-meta"><span>${item.detail}</span><strong>${item.price || ''}</strong></div><div class="action-row"><button class="ghost-btn">Open</button><button class="chip">Save</button></div></article>`).join('');
  }

  function renderSubscriptions(){
    const el = document.getElementById('subscription-list');
    if(!el || !data.subscriptions) return;
    el.innerHTML = data.subscriptions.map(item => `<article class="subscription-card"><strong>${item.name}</strong><div class="subscription-meta"><span>${item.detail}</span><strong>${item.price}</strong></div></article>`).join('');
  }

  function renderStorefronts(){
    const el = document.getElementById('storefront-grid');
    if(!el || !data.storefronts) return;
    el.innerHTML = data.storefronts.map(item => `<article class="storefront-card"><div class="feature-art"></div><h4>${item.title}</h4><span>${item.detail}</span></article>`).join('');
  }

  function renderAudio(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `<article class="audio-card"><strong>${item.title}</strong><div class="listener-row"><span>${item.detail}</span><span class="chip">Join</span></div></article>`).join('');
  }

  function renderPodcasts(){
    const el = document.getElementById('podcast-grid');
    if(!el || !data.podcasts) return;
    el.innerHTML = data.podcasts.map(item => `<article class="podcast-card"><strong>${item.title}</strong><span>${item.detail}</span><div class="sound-meter"><span style="width:${50 + Math.round(Math.random()*40)}%"></span></div></article>`).join('');
  }

  function renderClubs(){
    const el = document.getElementById('listener-clubs');
    if(!el || !data.clubs) return;
    el.innerHTML = data.clubs.map(item => `<article class="club-card"><strong>${item.title}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderEvents(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `<article class="event-card"><strong>${item.title}</strong><span>${item.detail}</span><div class="event-meta"><span>${item.meta}</span><button class="chip">RSVP</button></div></article>`).join('');
  }

  function renderCities(){
    const el = document.getElementById('city-cards');
    if(!el || !data.cities) return;
    el.innerHTML = data.cities.map(item => `<article class="city-card"><strong>${item.name}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderLineups(){
    const el = document.getElementById('lineup-grid');
    if(!el || !data.lineups) return;
    el.innerHTML = data.lineups.map(item => `<article class="lineup-card"><strong>${item.title}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderMessages(){
    const list = document.getElementById('conversation-list');
    if(list && data.conversations){
      list.innerHTML = data.conversations.map((c, i) => `<div class="conversation ${i===0?'active':''}"><strong>${c.name}</strong><span class="tiny-note">${c.snippet}</span></div>`).join('');
    }
    const thread = document.getElementById('chat-thread');
    if(thread && data.chat){
      thread.innerHTML = data.chat.map(msg => `<div class="chat-msg ${msg.who === 'me' ? 'mine' : ''}">${msg.body}</div>`).join('');
    }
    const ctx = document.getElementById('message-context');
    if(ctx && data.contexts){
      ctx.innerHTML = data.contexts.map(item => `<article class="context-card"><strong>${item.title}</strong><span>${item.detail}</span></article>`).join('');
    }
  }

  function renderFeaturedWork(){
    const el = document.getElementById('featured-work');
    if(!el || !data.featuredWorks) return;
    el.innerHTML = data.featuredWorks.map(item => `<article class="feature-card"><div class="feature-art"></div><h4>${item.title}</h4><span>${item.detail}</span></article>`).join('');
  }

  function renderMilestones(){
    const el = document.getElementById('milestone-list');
    if(!el || !data.milestones) return;
    el.innerHTML = data.milestones.map(item => `<article class="milestone-card"><strong>${item.title}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderActivities(){
    const el = document.getElementById('activity-ribbon');
    if(!el || !data.activities) return;
    el.innerHTML = data.activities.map(item => `<article class="activity-card"><strong>${item.title}</strong><span>${item.detail}</span></article>`).join('');
  }

  function renderStudio(){
    const el = document.getElementById('studio-grid');
    if(el && data.studioCards){
      el.innerHTML = data.studioCards.map(item => `<article class="studio-card"><div class="eyebrow">Pipeline</div><h4>${item.title}</h4><p>${item.body}</p><div class="progress-track"><span style="width:${item.progress}%"></span></div></article>`).join('');
    }
    const rev = document.getElementById('revenue-bars');
    if(rev && data.revenues){
      rev.innerHTML = data.revenues.map(item => `<article class="revenue-card"><strong>${item.title}</strong><span>${item.detail}</span><div class="revenue-track"><span style="width:${item.progress}%"></span></div></article>`).join('');
    }
    const assets = document.getElementById('asset-rail');
    if(assets && data.assets){
      assets.innerHTML = data.assets.map(item => `<article class="asset-card"><strong>${item.title}</strong><span>${item.detail}</span></article>`).join('');
    }
  }

  function renderSettingsStack(id, items){
    const el = document.getElementById(id);
    if(!el || !items) return;
    el.innerHTML = items.map(item => `
      <article class="setting-row">
        <div class="setting-copy"><strong>${item.title}</strong><span class="tiny-note">${item.detail}</span></div>
        <span class="toggle ${item.on ? 'on' : ''}"></span>
      </article>`).join('');
  }

  function renderDevices(){
    const el = document.getElementById('device-grid');
    if(!el || !data.devices) return;
    el.innerHTML = data.devices.map(item => `<article class="device-card"><div class="device-meta"><strong>${item.name}</strong><span class="chip">Active</span></div><span>${item.detail}</span></article>`).join('');
  }

  function renderCohosts(){
    const el = document.getElementById('cohost-strip');
    if(!el || !data.cohosts) return;
    el.innerHTML = data.cohosts.map(item => `<article class="cohost-card"><div class="avatar">${avatarText(item.name)}</div><strong>${item.name}</strong><span class="tiny-note">${item.role}</span></article>`).join('');
  }

  function renderChatStream(){
    const el = document.getElementById('chat-stream');
    if(!el || !data.chatStream) return;
    el.innerHTML = data.chatStream.map(item => `<article class="chat-bubble"><strong>${item.name}</strong><span>${item.msg}</span></article>`).join('');
  }

  function renderMoments(){
    const el = document.getElementById('moment-grid');
    if(!el || !data.moments) return;
    el.innerHTML = data.moments.map(item => `<article class="moment-card"><strong>${item.title}</strong><span>${item.detail}</span></article>`).join('');
  }

  function wireComposer(){
    const modal = document.getElementById('compose-modal');
    if(!modal) return;
    $$('[data-open-compose]').forEach(btn => btn.addEventListener('click', () => modal.classList.add('open')));
    $$('[data-close-compose]').forEach(btn => btn.addEventListener('click', () => modal.classList.remove('open')));
    const form = document.getElementById('compose-form');
    const toast = document.getElementById('toast');
    if(form){
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        modal.classList.remove('open');
        if(toast){
          toast.textContent = 'Draft queued into the SkyeSpace UI layer. Route it into whatever backend plumbing you feel like unleashing.';
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 2800);
        }
        form.reset();
      });
    }
  }

  renderRail('rail-trending', data.trending);
  renderRail('rail-communities', data.communities);
  renderRail('rail-creators', data.creators);
  renderFeed('feed-list', data.feed);
  renderVisuals('visual-grid', data.visuals);
  renderReels('reel-deck', data.shorts);
  renderThreads('thread-list', data.threads);
  renderBoards('board-grid', data.boards);
  renderJournals('journal-columns', data.journals);
  renderVideos('video-grid', data.videos);
  renderStories();
  renderCircleGrid();
  renderCreatorWall();
  renderPaletteList();
  renderSoundLadder();
  renderRemixes();
  renderRooms();
  renderModQueue();
  renderPinTrends();
  renderQuotes();
  renderPulse();
  renderSignals();
  renderHeat();
  renderEditorials();
  renderMarket('market-grid', data.products);
  renderSubscriptions();
  renderStorefronts();
  renderAudio('audio-list', data.audioRooms);
  renderPodcasts();
  renderClubs();
  renderEvents('event-list', data.events);
  renderEvents('event-list-mini', data.events);
  renderEvents('live-schedule', data.events);
  renderCities();
  renderLineups();
  renderMessages();
  renderFeaturedWork();
  renderMilestones();
  renderActivities();
  renderStudio();
  renderSettingsStack('visibility-settings', data.visibilitySettings);
  renderSettingsStack('safety-settings', data.safetySettings);
  renderSettingsStack('routing-settings', data.routingSettings);
  renderDevices();
  renderCohosts();
  renderChatStream();
  renderMoments();

  const search = document.getElementById('global-search');
  if(search){
    search.addEventListener('input', () => {
      document.documentElement.style.setProperty('--line-strong', search.value ? 'rgba(245,201,122,.28)' : 'rgba(255,255,255,.18)');
    });
  }

  wireComposer();
})();
