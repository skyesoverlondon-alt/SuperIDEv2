(function(){
  "use strict";
  const S = window.SkyeShell;
  if(!S) return;

  const els = {
    build: S.q("#buildBadge"),
    btnSecurity: S.q("#btnSecurity"),
    btnExport: S.q("#btnExport"),
    btnReset: S.q("#btnReset"),
    fileImport: S.q("#fileImport"),

    mode: S.q("#mode"),
    left: S.q("#left"),
    start: S.q("#start"),
    pause: S.q("#pause"),
    resetT: S.q("#resetT"),
    skip: S.q("#skip"),
    work: S.q("#work"),
    brk: S.q("#break"),
    proj: S.q("#proj"),
    note: S.q("#note"),

    sToday: S.q("#sToday"),
    sWeek: S.q("#sWeek"),
    sCount: S.q("#sCount"),

    newP: S.q("#newP"),
    addP: S.q("#addP"),
    sessions: S.q("#sessions"),
    csv: S.q("#csv")
  };

  S.attachBuildBadge(els.build);

  const LEGACY_KEY = "skyefocus_log_offline";
  const NS = "skyefocus_log";

  // Stable per-device ID for CRDT-style conflict resolution
  let DEV = "";

  function uid(){ return S.uid(); }
  function isoDate(d){ return d.toISOString().slice(0,10); }
  function fmtDT(iso){ try{ return new Date(iso).toLocaleString(); }catch(_){ return String(iso||""); } }
  function clamp(n, a, b){ n = Number(n); if(!Number.isFinite(n)) n=a; return Math.max(a, Math.min(b, n)); }

  function migrateLegacy(obj){
    if(!obj || typeof obj !== "object") return null;
    // legacy structure is close to ours
    const settings = obj.settings || {workMin:25, breakMin:5};
    const projects = Array.isArray(obj.projects) && obj.projects.length ? obj.projects : [{id:"p-default", name:"General"}];
    const activeProjectId = obj.activeProjectId || projects[0].id;
    const sessions = Array.isArray(obj.sessions) ? obj.sessions : [];
    const timer = obj.timer || {mode:"work", running:false, endAt:null, remainingSec:settings.workMin*60, lastWorkStart:null};
    return {
      schemaVersion:2,
      settings: {workMin: clamp(settings.workMin,5,180), breakMin: clamp(settings.breakMin,1,60)},
      projects: projects.map(p=>({
        id:String(p.id||uid()),
        name:String(p.name||"Project").slice(0,80),
        createdAt: p.createdAt || new Date().toISOString(),
        updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
        updatedByDevice: p.updatedByDevice || "",
        deletedAt: (typeof p.deletedAt === 'undefined') ? null : (p.deletedAt || null),
        deletedByDevice: p.deletedByDevice || ""
      })),
      activeProjectId: String(activeProjectId || projects[0].id),
      sessions: sessions.map(s=>({
        id:String(s.id||uid()),
        projectId:String(s.projectId||"p-default"),
        projectName:String(s.projectName||"General").slice(0,80),
        minutes: clamp(s.minutes,1,600),
        startedAt: s.startedAt || new Date().toISOString(),
        endedAt: s.endedAt || new Date().toISOString(),
        note: String(s.note||"").slice(0,240),
        createdAt: s.createdAt || s.endedAt || new Date().toISOString(),
        updatedAt: s.updatedAt || s.endedAt || new Date().toISOString(),
        updatedByDevice: s.updatedByDevice || "",
        deletedAt: (typeof s.deletedAt === 'undefined') ? null : (s.deletedAt || null),
        deletedByDevice: s.deletedByDevice || ""
      })),
      timer: {
        mode: (String(timer.mode||"work")==="break") ? "break" : "work",
        running: !!timer.running,
        endAt: timer.endAt || null,
        remainingSec: clamp(timer.remainingSec, 0, 24*60*60),
        lastWorkStart: timer.lastWorkStart || null
      },
      _meta: {
        settingsUpdatedAt: (obj._meta && obj._meta.settingsUpdatedAt) ? obj._meta.settingsUpdatedAt : new Date().toISOString(),
        settingsUpdatedByDevice: (obj._meta && obj._meta.settingsUpdatedByDevice) ? obj._meta.settingsUpdatedByDevice : "",
        activeProjectUpdatedAt: (obj._meta && obj._meta.activeProjectUpdatedAt) ? obj._meta.activeProjectUpdatedAt : new Date().toISOString(),
        activeProjectUpdatedByDevice: (obj._meta && obj._meta.activeProjectUpdatedByDevice) ? obj._meta.activeProjectUpdatedByDevice : ""
      }
    };
  }

  const DEFAULT = () => ({
    schemaVersion:2,
    settings:{workMin:25, breakMin:5},
    projects:[{id:"p-default", name:"General"}],
    activeProjectId:"p-default",
    sessions:[
      {id:uid(),projectId:"p-default",projectName:"General",minutes:25,startedAt:new Date(Date.now()-25*60000).toISOString(),endedAt:new Date().toISOString(),note:"Example session. Delete it."}
    ],
    timer:{mode:"work", running:false, endAt:null, remainingSec:25*60, lastWorkStart:null}
  });

  let vault=null;
  let state=null;
  let tick=null;

  function mmss(sec){
    sec=Math.max(0,Math.floor(sec));
    const m=String(Math.floor(sec/60)).padStart(2,"0");
    const s=String(sec%60).padStart(2,"0");
    return `${m}:${s}`;
  }

  function renderTimer(){
    els.mode.textContent = String(state.timer.mode||"work").toUpperCase();
    els.left.textContent = mmss(state.timer.remainingSec || 0);
  }

  function renderProjects(){
    const live = state.projects.filter(p=>!p.deletedAt);
    els.proj.innerHTML = live.map(p=>`<option value="${S.esc(p.id)}">${S.esc(p.name)}</option>`).join("");
    els.proj.value = state.activeProjectId;
  }

  function renderSessions(){
    const shown = state.sessions.filter(s=>!s.deletedAt).slice(0,20);
    els.sessions.innerHTML = shown.map(s=>`
      <div class="item">
        <div style="min-width:0">
          <p class="t">${S.esc(s.projectName)} • <span class="mono">${S.esc(s.minutes)}m</span></p>
          <p class="s">${S.esc(fmtDT(s.endedAt))}${s.note?(" • "+S.esc(s.note)):""}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn secondary" data-del="${S.esc(s.id)}">Del</button>
        </div>
      </div>
    `).join("");

    S.qa("[data-del]", els.sessions).forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const id=btn.getAttribute("data-del");
        const ok = await S.confirm("Delete session", "Delete this session?", "Delete");
        if(!ok) return;
        const s = state.sessions.find(x=>x.id===id);
        if(s){
          s.deletedAt = new Date().toISOString();
          s.deletedByDevice = DEV;
        }
        await persist();
        renderAll();
        S.toast("Deleted");
      });
    });
  }

  function renderStats(){
    const today = isoDate(new Date());
    const cutoff = new Date(Date.now()-7*24*60*60*1000);
    let t=0,w=0;
    state.sessions.filter(s=>!s.deletedAt).forEach(s=>{
      if(String(s.endedAt||"").slice(0,10)===today) t += Number(s.minutes||0);
      if(new Date(s.endedAt) >= cutoff) w += Number(s.minutes||0);
    });
    els.sToday.textContent = String(t);
    els.sWeek.textContent = String(w);
    els.sCount.textContent = String(state.sessions.filter(s=>!s.deletedAt).length);
  }

  function renderAll(){
    els.work.value = String(state.settings.workMin);
    els.brk.value = String(state.settings.breakMin);
    renderProjects();
    renderTimer();
    renderSessions();
    renderStats();
  }

  async function persist(){
    try{
      await vault.setState(state);
    }catch(e){
      if(String(e?.message||"").includes("vault-locked")) S.toast("Vault is locked");
      else S.toast("Save failed (storage)");
    }
  }

  function recomputeRemaining(){
    if(state.timer.running && state.timer.endAt){
      const rem = Math.max(0, Math.round((new Date(state.timer.endAt).getTime() - Date.now())/1000));
      state.timer.remainingSec = rem;
    }
  }

  function beginTick(){
    stopTick();
    tick = setInterval(()=>{
      if(!state.timer.running || !state.timer.endAt) return;
      const rem = Math.max(0, Math.round((new Date(state.timer.endAt).getTime() - Date.now())/1000));
      state.timer.remainingSec = rem;
      renderTimer();
      if(rem<=0) completeBlock();
    }, 250);
  }
  function stopTick(){ if(tick) clearInterval(tick); tick=null; }

  async function start(){
    if(state.timer.running) return;
    state.timer.running = true;
    const now = new Date();
    if(state.timer.mode === "work") state.timer.lastWorkStart = now.toISOString();
    state.timer.endAt = new Date(now.getTime() + (state.timer.remainingSec*1000)).toISOString();
    await persist();
    beginTick();
    renderTimer();
    S.toast("Started");
  }

  async function pause(){
    if(!state.timer.running) return;
    const now = new Date();
    const end = new Date(state.timer.endAt);
    const rem = Math.max(0, Math.round((end.getTime()-now.getTime())/1000));
    state.timer.running = false;
    state.timer.endAt = null;
    state.timer.remainingSec = rem;
    await persist();
    stopTick();
    renderTimer();
    S.toast("Paused");
  }

  async function resetTimer(){
    await pause();
    state.timer.remainingSec = (state.timer.mode==="work" ? state.settings.workMin : state.settings.breakMin) * 60;
    await persist();
    renderTimer();
    S.toast("Reset");
  }

  async function skip(){
    await pause();
    state.timer.mode = (state.timer.mode==="work") ? "break" : "work";
    state.timer.remainingSec = (state.timer.mode==="work" ? state.settings.workMin : state.settings.breakMin) * 60;
    await persist();
    renderAll();
    S.toast("Skipped");
  }

  async function completeBlock(){
    const finished = state.timer.mode;
    await pause();

    if(finished === "work"){
      const endAt = new Date().toISOString();
      const startAt = state.timer.lastWorkStart || new Date(Date.now()-state.settings.workMin*60000).toISOString();
      const proj = state.projects.find(p=>p.id===state.activeProjectId) || state.projects[0];
      state.sessions.unshift({
        id: uid(),
        projectId: proj.id,
        projectName: proj.name,
        minutes: Math.max(1, state.settings.workMin),
        startedAt: startAt,
        endedAt: endAt,
        note: String(els.note.value||"").trim().slice(0,240),
        createdAt: endAt,
        updatedAt: endAt,
        updatedByDevice: DEV,
        deletedAt: null,
        deletedByDevice: ""
      });
      els.note.value="";
      S.toast("Work session logged");
      try{ if(navigator.vibrate) navigator.vibrate([80,40,80]); }catch(_){}
    } else {
      S.toast("Break complete");
      try{ if(navigator.vibrate) navigator.vibrate([60,30,60]); }catch(_){}
    }

    state.timer.mode = (finished==="work") ? "break" : "work";
    state.timer.remainingSec = (state.timer.mode==="work" ? state.settings.workMin : state.settings.breakMin) * 60;
    await persist();
    renderAll();
  }

  async function addProject(){
    const name = String(els.newP.value||"").trim();
    if(!name) return S.toast("Project name required");
    const id = uid();
    const nowIso = new Date().toISOString();
    state.projects.push({id, name:name.slice(0,80), createdAt: nowIso, updatedAt: nowIso, updatedByDevice: DEV, deletedAt: null, deletedByDevice: ""});
    state.activeProjectId = id;
    state._meta = state._meta || {};
    state._meta.activeProjectUpdatedAt = nowIso;
    state._meta.activeProjectUpdatedByDevice = DEV;
    els.newP.value="";
    await persist();
    renderAll();
    S.toast("Project added");
  }

  function exportCsv(){
    const rows=[["project","minutes","startedAt","endedAt","note"]];
    state.sessions.filter(s=>!s.deletedAt).slice().reverse().forEach(s=>{
      rows.push([s.projectName,String(s.minutes||0),s.startedAt||"",s.endedAt||"",s.note||""]);
    });
    const csv = rows.map(r=>r.map(S.csvEsc).join(",")).join("\n");
    S.download(`skyefocus-sessions-${new Date().toISOString().slice(0,10)}.csv`, csv, "text/csv");
    S.toast("Exported CSV");
  }

  async function exportJson(){
    const rec = await vault.exportRecord();
    if(!rec) return S.toast("Nothing to export");
    const name = `${NS}-backup-${new Date().toISOString().slice(0,10)}.json`;
    S.download(name, JSON.stringify(rec, null, 2));
    S.toast("Exported backup JSON");
  }

  async function importJson(file){
    const txt = await S.readFileText(file);
    let obj=null;
    try{ obj = JSON.parse(txt); }catch(e){ obj=null; }
    if(!obj) return S.toast("Import failed: invalid JSON");

    if(((obj.format === "skye-mini-ops-suite/v4") || (obj.format === "skye-mini-ops-suite/v3") || (obj.format === "skye-mini-ops-suite/v2")) && obj.vaults && obj.vaults[NS]){
      obj = obj.vaults[NS];
    }

    if((obj.format === "skye-mini-ops/v3") || (obj.format === "skye-mini-ops/v2")){
      let pass=null;
      if(obj.encrypted){
        const r = await S.modal({
          title:"Encrypted backup",
          text:"Enter passphrase to import this vault.",
          okText:"Import",
          cancelText:"Cancel",
          type:"password",
          placeholder:"Passphrase",
          require:true
        });
        if(!r.ok) return;
        pass = r.value;
      }
      const res = await vault.importRecord(obj, pass || undefined);
      if(!res.ok) return S.toast(`Import failed: ${res.error}`);
      const rr = await vault.read(DEFAULT);
      state = rr.state || DEFAULT();
      stopTick();
      if(state.timer.running && state.timer.endAt) beginTick();
      renderAll();
      return S.toast("Imported backup");
    }

    // Legacy structure (v1 app backup)
    if(obj.settings && Array.isArray(obj.projects) && Array.isArray(obj.sessions)){
      const migrated = migrateLegacy(obj);
      if(!migrated) return S.toast("Import rejected");
      state = migrated;
      await persist();
      stopTick();
      if(state.timer.running && state.timer.endAt) beginTick();
      renderAll();
      return S.toast("Imported legacy backup");
    }

    S.toast("Import rejected: unsupported format");
  }

  async function securityMenu(){
    const st = await vault.status();
    const status = st.exists ? (st.encrypted ? (st.locked ? "ENCRYPTED (LOCKED)" : "ENCRYPTED (UNLOCKED)") : "UNLOCKED") : "EMPTY";
    const options = st.encrypted
      ? (st.locked
          ? "Options: U=Unlock • R=Reset (wipe) • X=Cancel"
          : "Options: L=Lock • D=Disable encryption • R=Reset (wipe) • X=Cancel")
      : "Options: E=Enable encryption • R=Reset (wipe) • X=Cancel";

    const r = await S.modal({
      title:"Vault security",
      text:`Status: ${status}\n${options}\n\nType a letter:`,
      okText:"Continue",
      cancelText:"Close",
      type:"text",
      placeholder:"E / U / L / D / R / X",
      require:false
    });
    if(!r.ok) return;
    const choice = String(r.value||"").trim().toUpperCase();
    if(!choice || choice==="X") return;

    if(choice==="R"){
      const ok = await S.confirm("Reset vault", "This wipes the vault stored in this browser for this app.", "Reset");
      if(!ok) return;
      state = await vault.reset(DEFAULT());
      stopTick();
      renderAll();
      return S.toast("Vault reset");
    }

    if(!st.encrypted && choice==="E"){
      const p = await S.modal({
        title:"Enable encryption",
        text:"Set a passphrase. You must remember it. If you lose it, the data cannot be recovered.",
        okText:"Enable",
        cancelText:"Cancel",
        type:"password",
        placeholder:"Passphrase",
        require:true,
        showSecond:true,
        type2:"password",
        placeholder2:"Confirm passphrase",
        requireSecond:true
      });
      if(!p.ok) return;
      if(p.value !== p.value2) return S.toast("Passphrases do not match");
      await vault.enableEncryption(p.value);
      return S.toast("Encryption enabled");
    }

    if(st.encrypted && st.locked && choice==="U"){
      const p = await S.modal({
        title:"Unlock vault",
        text:"Enter passphrase to unlock in this session.",
        okText:"Unlock",
        cancelText:"Cancel",
        type:"password",
        placeholder:"Passphrase",
        require:true
      });
      if(!p.ok) return;
      const ok = await vault.unlock(p.value);
      if(!ok) return S.toast("Wrong passphrase");
      const rr = await vault.read(DEFAULT);
      state = rr.state || DEFAULT();
      recomputeRemaining();
      if(state.timer.running && state.timer.endAt) beginTick();
      renderAll();
      return S.toast("Unlocked");
    }

    if(st.encrypted && !st.locked && choice==="L"){
      vault.lock();
      return S.toast("Locked (session)");
    }

    if(st.encrypted && !st.locked && choice==="D"){
      const p = await S.modal({
        title:"Disable encryption",
        text:"Enter passphrase to decrypt and store plaintext locally.",
        okText:"Disable",
        cancelText:"Cancel",
        type:"password",
        placeholder:"Passphrase",
        require:true
      });
      if(!p.ok) return;
      const ok = await vault.disableEncryption(p.value);
      if(!ok) return S.toast("Wrong passphrase");
      return S.toast("Encryption disabled");
    }

    S.toast("No action");
  }

  async function resetApp(){
    const ok = await S.confirm("Reset app", "Clears local data for this app in this browser.", "Reset");
    if(!ok) return;
    state = await vault.reset(DEFAULT());
    stopTick();
    renderAll();
    S.toast("Reset complete");
  }

  async function boot(){
    try{ DEV = await S.Sync.getDeviceId(); }catch(_){ DEV = "dev-" + uid(); }
    vault = await S.Vault.open(NS, { legacyLocalStorageKey: LEGACY_KEY, migrateFromLegacy: migrateLegacy });
    const rr = await vault.read(DEFAULT);
    if(rr.locked){
      S.toast("Vault locked");
      await securityMenu();
      const rr2 = await vault.read(DEFAULT);
      state = rr2.state || DEFAULT();
    } else {
      state = rr.state || DEFAULT();
    }

    // Normalize
    if(!state || typeof state !== "object") state = DEFAULT();
    if(!state.settings) state.settings = {workMin:25, breakMin:5};
    if(!Array.isArray(state.projects) || state.projects.length===0) state.projects = [{id:"p-default", name:"General"}];
    if(!state.activeProjectId) state.activeProjectId = state.projects[0].id;
    if(!Array.isArray(state.sessions)) state.sessions = [];
    if(!state.timer) state.timer = {mode:"work", running:false, endAt:null, remainingSec: state.settings.workMin*60, lastWorkStart:null};

    state._meta = state._meta || {};
    if(!state._meta.settingsUpdatedAt) state._meta.settingsUpdatedAt = new Date().toISOString();
    if(!state._meta.settingsUpdatedByDevice) state._meta.settingsUpdatedByDevice = "";
    if(!state._meta.activeProjectUpdatedAt) state._meta.activeProjectUpdatedAt = new Date().toISOString();
    if(!state._meta.activeProjectUpdatedByDevice) state._meta.activeProjectUpdatedByDevice = "";

    // Ensure CRDT stamps exist
    state.projects.forEach(p=>{
      if(!p.createdAt) p.createdAt = new Date().toISOString();
      if(!p.updatedAt) p.updatedAt = p.createdAt;
      if(!p.updatedByDevice) p.updatedByDevice = "";
      if(typeof p.deletedAt === 'undefined') p.deletedAt = null;
      if(!p.deletedByDevice) p.deletedByDevice = "";
    });
    state.sessions.forEach(s=>{
      if(!s.createdAt) s.createdAt = s.endedAt || new Date().toISOString();
      if(!s.updatedAt) s.updatedAt = s.endedAt || s.createdAt;
      if(!s.updatedByDevice) s.updatedByDevice = "";
      if(typeof s.deletedAt === 'undefined') s.deletedAt = null;
      if(!s.deletedByDevice) s.deletedByDevice = "";
    });

    await vault.setState(state);

    // Recompute remaining from endAt (resilient refresh)
    recomputeRemaining();

    renderAll();
    if(state.timer.running && state.timer.endAt) beginTick();

    // Events
    els.start.addEventListener("click", start);
    els.pause.addEventListener("click", pause);
    els.resetT.addEventListener("click", resetTimer);
    els.skip.addEventListener("click", skip);
    els.addP.addEventListener("click", addProject);
    els.csv.addEventListener("click", exportCsv);
    els.btnExport.addEventListener("click", exportJson);
    els.btnSecurity.addEventListener("click", securityMenu);
    els.btnReset.addEventListener("click", resetApp);

    els.proj.addEventListener("change", async ()=>{
      state.activeProjectId = els.proj.value;
      state._meta = state._meta || {};
      state._meta.activeProjectUpdatedAt = new Date().toISOString();
      state._meta.activeProjectUpdatedByDevice = DEV;
      await persist();
      S.toast("Active project set");
    });

    els.work.addEventListener("change", async ()=>{
      state.settings.workMin = clamp(els.work.value, 5, 180);
      if(!state.timer.running && state.timer.mode==="work") state.timer.remainingSec = state.settings.workMin * 60;
      state._meta = state._meta || {};
      state._meta.settingsUpdatedAt = new Date().toISOString();
      state._meta.settingsUpdatedByDevice = DEV;
      await persist();
      renderAll();
      S.toast("Work minutes updated");
    });

    els.brk.addEventListener("change", async ()=>{
      state.settings.breakMin = clamp(els.brk.value, 1, 60);
      if(!state.timer.running && state.timer.mode==="break") state.timer.remainingSec = state.settings.breakMin * 60;
      state._meta = state._meta || {};
      state._meta.settingsUpdatedAt = new Date().toISOString();
      state._meta.settingsUpdatedByDevice = DEV;
      await persist();
      renderAll();
      S.toast("Break minutes updated");
    });

    // Import
    els.fileImport.addEventListener("change", async (e)=>{
      const f = e.target.files && e.target.files[0];
      e.target.value="";
      if(!f) return;
      if(f.size > 8*1024*1024) return S.toast("Import blocked: file too large");
      await importJson(f);
    });

    // Persist on tab close (for paused changes, etc.)
    window.addEventListener("beforeunload", ()=>{
      try{ vault.setState(state); }catch(_){}
    });
    document.addEventListener("visibilitychange", ()=>{
      if(document.visibilityState === "hidden"){
        try{ vault.setState(state); }catch(_){}
      }
    });
  }

  boot();
})();
