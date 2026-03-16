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

    q: S.q("#q"),
    tag: S.q("#tag"),
    list: S.q("#list"),
    count: S.q("#count"),

    title: S.q("#title"),
    tags: S.q("#tags"),
    body: S.q("#body"),
    status: S.q("#status"),
    meta: S.q("#meta"),

    newBtn: S.q("#new"),
    pinBtn: S.q("#pin"),
    dupBtn: S.q("#dup"),
    delBtn: S.q("#del"),
    txtBtn: S.q("#txt"),
    saveBtn: S.q("#save")
  };

  S.attachBuildBadge(els.build);

  const LEGACY_KEY = "skyenote_vault_offline";
  const NS = "skyenote_vault";

  // Stable per-device ID for CRDT-style conflict resolution
  let DEV = "";

  function now(){ return new Date().toISOString(); }
  function fmt(ts){ try{ return new Date(ts).toLocaleString(); }catch(_){ return String(ts||""); } }
  function tagsFrom(s){ return String(s||"").split(",").map(x=>x.trim()).filter(Boolean).slice(0,30); }
  function safeName(s){ return String(s||"note").replace(/[^a-z0-9\-_]+/gi,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,64)||"note"; }

  function migrateLegacy(obj){
    if(!obj || typeof obj !== "object") return { schemaVersion:2, selected:null, notes:[] };
    // legacy has version:1
    const notes = Array.isArray(obj.notes) ? obj.notes : [];
    return {
      schemaVersion:2,
      selected: obj.selected || (notes[0] ? notes[0].id : null),
      notes: notes.map(n=>({
        id: String(n.id || S.uid()),
        title: String(n.title || "Untitled"),
        body: String(n.body || ""),
        tags: Array.isArray(n.tags) ? n.tags.map(t=>String(t)).slice(0,30) : tagsFrom(n.tags),
        pinned: !!n.pinned,
        createdAt: n.createdAt || now(),
        updatedAt: n.updatedAt || now(),
        updatedByDevice: n.updatedByDevice || "",
        deletedAt: (typeof n.deletedAt === 'undefined') ? null : (n.deletedAt || null),
        deletedByDevice: n.deletedByDevice || ""
      }))
    };
  }

  const DEFAULT = () => ({
    schemaVersion:2,
    selected:null,
    notes:[{
      id:S.uid(),
      title:"Welcome",
      body:"SkyeNote Vault stores notes locally in your browser.\n\nProduction hardening upgrades:\n• IndexedDB storage (more reliable than localStorage)\n• Optional encryption (passphrase)\n• Hardened import/export with format checks\n\nBack up regularly if the notes matter.",
      tags:["offline","ops"],
      pinned:true,
      createdAt:now(),
      updatedAt:now()
    }]
  });

  let vault = null;
  let state = null;

  function selected(){ return state.notes.find(n=>n.id===state.selected && !n.deletedAt) || null; }
  function ensureSelection(){ if(!state.selected && state.notes[0]) state.selected = state.notes[0].id; }

  function buildTagOptions(){
    const set = new Set();
    state.notes.forEach(n => (n.tags||[]).forEach(t=>set.add(t)));
    const cur = els.tag.value || "";
    const tags = Array.from(set).sort((a,b)=>a.localeCompare(b));
    els.tag.innerHTML = `<option value="">All</option>` + tags.map(t=>`<option value="${S.esc(t)}">${S.esc(t)}</option>`).join("");
    if(tags.includes(cur)) els.tag.value = cur;
  }

  function filtered(){
    const q = (els.q.value||"").trim().toLowerCase();
    const tag = (els.tag.value||"").trim().toLowerCase();
    return state.notes.slice()
      .sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0) || String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")))
      .filter(n=>{
        if(n.deletedAt) return false;
        if(tag){
          const has = (n.tags||[]).map(t=>String(t).toLowerCase()).includes(tag);
          if(!has) return false;
        }
        if(!q) return true;
        const hay = `${n.title||""}\n${n.body||""}\n${(n.tags||[]).join(",")}`.toLowerCase();
        return hay.includes(q);
      });
  }

  function renderList(){
    buildTagOptions();
    const list = filtered();
    els.count.textContent = `${list.length} notes`;
    els.list.innerHTML = list.map(n=>{
      const sel = n.id === state.selected;
      const snip = S.esc(String(n.body||"").trim().slice(0,120));
      const tags = (n.tags||[]).slice(0,4).map(t=>`<span class="tag">${S.esc(t)}</span>`).join(" ");
      return `
        <div class="item" data-id="${S.esc(n.id)}" style="${sel?"border-color:rgba(255,255,255,.28);background:rgba(0,0,0,.26);":""}">
          <div style="min-width:0">
            <p class="t">${S.esc(n.title||"Untitled")}${n.pinned?" 📌":""}</p>
            <p class="s">${snip||"<span class='mono' style='opacity:.7'>…</span>"}</p>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${tags}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn secondary" data-open>Open</button>
          </div>
        </div>`;
    }).join("");

    S.qa("[data-open]", els.list).forEach(btn=>{
      btn.addEventListener("click",(e)=>{
        const id = e.target.closest(".item").getAttribute("data-id");
        state.selected = id;
        persist();
        render();
      });
    });

    S.qa(".item", els.list).forEach(div=>{
      div.addEventListener("dblclick", ()=>{
        state.selected = div.getAttribute("data-id");
        persist();
        render();
      });
    });
  }

  function renderEditor(){
    ensureSelection();
    const n = selected();
    if(!n){
      els.title.value=""; els.tags.value=""; els.body.value=""; els.meta.textContent="No note selected.";
      return;
    }
    els.title.value = n.title || "";
    els.tags.value = (n.tags||[]).join(", ");
    els.body.value = n.body || "";
    els.meta.textContent = `Created: ${fmt(n.createdAt)} • Updated: ${fmt(n.updatedAt)} • ${n.pinned?"Pinned":"Unpinned"}`;
  }

  function render(){
    renderList();
    renderEditor();
    els.status.textContent = "Saved";
  }

  let persistT = null;
  function persist(){
    clearTimeout(persistT);
    persistT = setTimeout(async ()=>{
      try{
        await vault.setState(state);
      }catch(e){
        if(String(e?.message||"").includes("vault-locked")){
          S.toast("Vault is locked");
        }else{
          S.toast("Save failed (storage)");
        }
      }
    }, 80);
  }

  function setUnsaved(){ els.status.textContent="Unsaved"; }

  async function makeNew(){
    const id = S.uid();
    state.notes.unshift({id,title:"Untitled",body:"",tags:[],pinned:false,createdAt:now(),updatedAt:now(),updatedByDevice:DEV,deletedAt:null,deletedByDevice:""});
    state.selected = id;
    await vault.setState(state);
    S.toast("New note created");
    render();
    els.title.focus(); els.title.select();
  }

  async function duplicate(){
    const n = selected(); if(!n) return S.toast("No note selected");
    const id = S.uid();
    const c = JSON.parse(JSON.stringify(n));
    c.id = id;
    c.title = (n.title||"Untitled") + " (copy)";
    c.createdAt = now();
    c.updatedAt = now();
    c.updatedByDevice = DEV;
    c.deletedAt = null;
    c.deletedByDevice = "";
    state.notes.unshift(c);
    state.selected = id;
    await vault.setState(state);
    S.toast("Duplicated");
    render();
  }

  async function del(){
    const n = selected(); if(!n) return S.toast("No note selected");
    const ok = await S.confirm("Delete note", `Delete "${n.title}"?`, "Delete");
    if(!ok) return;
    n.deletedAt = now();
    n.deletedByDevice = DEV;
    // move selection to a live note
    const live = state.notes.filter(x=>!x.deletedAt && x.id!==n.id);
    state.selected = live[0]?.id || null;
    await vault.setState(state);
    S.toast("Deleted");
    render();
  }

  async function togglePin(){
    const n = selected(); if(!n) return S.toast("No note selected");
    n.pinned = !n.pinned;
    n.updatedAt = now();
    n.updatedByDevice = DEV;
    await vault.setState(state);
    S.toast(n.pinned ? "Pinned" : "Unpinned");
    render();
  }

  async function saveEdits(){
    const n = selected(); if(!n) return S.toast("No note selected");
    n.title = (els.title.value||"").trim() || "Untitled";
    n.tags = tagsFrom(els.tags.value);
    n.body = els.body.value || "";
    n.updatedAt = now();
    n.updatedByDevice = DEV;
    await vault.setState(state);
    els.status.textContent = "Saved";
    S.toast("Saved");
    renderList();
    renderEditor();
  }

  function exportTxt(){
    const n = selected(); if(!n) return S.toast("No note selected");
    const head = `${n.title}\nTags: ${(n.tags||[]).join(", ")}\nUpdated: ${n.updatedAt}\n\n`;
    S.download(`note-${safeName(n.title)}.txt`, head + (n.body||""), "text/plain");
    S.toast("Exported TXT");
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

    // Accept suite backup
    if(((obj.format === "skye-mini-ops-suite/v4") || (obj.format === "skye-mini-ops-suite/v3") || (obj.format === "skye-mini-ops-suite/v2")) && obj.vaults && obj.vaults[NS]){
      obj = obj.vaults[NS];
    }

    // New record format
    if((obj.format === "skye-mini-ops/v3") || (obj.format === "skye-mini-ops/v2")){
      let pass = null;
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
      render();
      return S.toast("Imported backup");
    }

    // Legacy structure
    if(Array.isArray(obj.notes)){
      state = migrateLegacy(obj);
      await vault.setState(state);
      render();
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
      render();
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
      render();
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
    render();
    S.toast("Reset complete");
  }

  async function boot(){
    try{ DEV = await S.Sync.getDeviceId(); }catch(_){ DEV = "dev-" + S.uid(); }
    vault = await S.Vault.open(NS, { legacyLocalStorageKey: LEGACY_KEY, migrateFromLegacy: migrateLegacy });
    const rr = await vault.read(DEFAULT);
    if(rr.locked){
      S.toast("Vault locked");
      // force unlock prompt
      await securityMenu();
      const rr2 = await vault.read(DEFAULT);
      if(rr2.locked){
        // keep UI blank-ish
        state = DEFAULT();
      } else {
        state = rr2.state || DEFAULT();
      }
    } else {
      state = rr.state || DEFAULT();
    }

    // Ensure at least one LIVE note
    if(!Array.isArray(state.notes) || state.notes.filter(n=>!n.deletedAt).length===0){
      state = DEFAULT();
      await vault.setState(state);
    }

    // Normalize for CRDT-safe sync (soft deletes + device stamps)
    state.notes.forEach(n=>{
      if(!n.updatedAt) n.updatedAt = n.createdAt || now();
      if(!n.updatedByDevice) n.updatedByDevice = "";
      if(typeof n.deletedAt === 'undefined') n.deletedAt = null;
      if(!n.deletedByDevice) n.deletedByDevice = "";
    });
    // selection must be live
    if(state.selected){
      const sel = state.notes.find(x=>x.id===state.selected && !x.deletedAt);
      if(!sel) state.selected = null;
    }
    if(!state.selected){
      const live = state.notes.filter(x=>!x.deletedAt);
      state.selected = live[0]?.id || null;
    }
    await vault.setState(state);

    render();

    // Events
    els.newBtn.addEventListener("click", makeNew);
    els.pinBtn.addEventListener("click", togglePin);
    els.dupBtn.addEventListener("click", duplicate);
    els.delBtn.addEventListener("click", del);
    els.txtBtn.addEventListener("click", exportTxt);
    els.saveBtn.addEventListener("click", saveEdits);
    els.btnExport.addEventListener("click", exportJson);
    els.btnSecurity.addEventListener("click", securityMenu);
    els.btnReset.addEventListener("click", resetApp);

    els.q.addEventListener("input", renderList);
    els.tag.addEventListener("change", renderList);

    [els.title, els.tags, els.body].forEach(el=>el.addEventListener("input", setUnsaved));
    window.addEventListener("keydown",(e)=>{
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="s"){
        e.preventDefault(); saveEdits();
      }
    });

    els.fileImport.addEventListener("change", async (e)=>{
      const f = e.target.files && e.target.files[0];
      e.target.value="";
      if(!f) return;
      if(f.size > 8*1024*1024) return S.toast("Import blocked: file too large");
      await importJson(f);
    });
  }

  boot();
})();
