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

    date: S.q("#date"),
    type: S.q("#type"),
    cat: S.q("#cat"),
    amt: S.q("#amt"),
    note: S.q("#note"),
    add: S.q("#add"),
    csv: S.q("#csv"),

    q: S.q("#q"),
    ft: S.q("#ft"),
    from: S.q("#from"),
    to: S.q("#to"),
    clear: S.q("#clear"),

    rows: S.q("#rows"),
    count: S.q("#count"),
    kInc: S.q("#kInc"),
    kExp: S.q("#kExp"),
    kNet: S.q("#kNet"),

    editBack: S.q("#editBack"),
    e_date: S.q("#e_date"),
    e_type: S.q("#e_type"),
    e_cat: S.q("#e_cat"),
    e_amt: S.q("#e_amt"),
    e_note: S.q("#e_note"),
    e_cancel: S.q("#e_cancel"),
    e_save: S.q("#e_save")
  };

  S.attachBuildBadge(els.build);

  const LEGACY_KEY = "skyecash_ledger_offline";
  const NS = "skyecash_ledger";

  // Stable per-device ID for CRDT-style conflict resolution
  let DEV = "";

  function iso(d){ return d.toISOString().slice(0,10); }
  function today(){ return iso(new Date()); }
  function monthKey(d){ return String(d||"").slice(0,7); }
  function nowMonth(){ return today().slice(0,7); }

  function migrateLegacy(obj){
    if(!obj || typeof obj !== "object") return { schemaVersion:2, tx:[] };
    const tx = Array.isArray(obj.tx) ? obj.tx : [];
    return {
      schemaVersion:2,
      tx: tx.map(x=>({
        id: String(x.id || S.uid()),
        date: String(x.date || today()),
        type: (String(x.type||"income").trim()==="expense") ? "expense" : "income",
        category: String(x.category||"").slice(0,120),
        amount: Math.abs(S.n2(x.amount)),
        notes: String(x.notes||"").slice(0,240),
        createdAt: x.createdAt || new Date().toISOString(),
        updatedAt: x.updatedAt || x.createdAt || new Date().toISOString(),
        updatedByDevice: x.updatedByDevice || "",
        deletedAt: (typeof x.deletedAt === 'undefined') ? null : (x.deletedAt || null),
        deletedByDevice: x.deletedByDevice || ""
      }))
    };
  }

  const DEFAULT = () => ({
    schemaVersion:2,
    tx:[
      {id:S.uid(), date:today(), type:"income", category:"Sample Client Payment", amount:250, notes:"Replace with real data.", createdAt:new Date().toISOString()},
      {id:S.uid(), date:today(), type:"expense", category:"Fuel", amount:40, notes:"Example expense.", createdAt:new Date().toISOString()}
    ]
  });

  let vault=null;
  let state=null;
  let editingId=null;

  function applyFilters(list){
    const q=(els.q.value||"").trim().toLowerCase();
    const t=(els.ft.value||"").trim();
    const from=(els.from.value||"").trim();
    const to=(els.to.value||"").trim();
    return list.filter(x=>{
      if(t && x.type!==t) return false;
      if(from && x.date<from) return false;
      if(to && x.date>to) return false;
      if(q){
        const hay = `${x.category||""}\n${x.notes||""}`.toLowerCase();
        if(!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function kpis(){
    const m=nowMonth();
    let inc=0, exp=0;
    (state.tx||[]).forEach(x=>{
      if(x.deletedAt) return;
      if(monthKey(x.date)!==m) return;
      if(x.type==="income") inc += S.n2(x.amount);
      else exp += S.n2(x.amount);
    });
    els.kInc.textContent=S.money(inc);
    els.kExp.textContent=S.money(exp);
    els.kNet.textContent=S.money(inc-exp);
  }

  function render(){
    const allTx = Array.isArray(state.tx) ? state.tx : [];
    const tx = allTx.filter(x=>!x.deletedAt);
    const sorted = tx.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")) || String((b.updatedAt||b.createdAt)||"").localeCompare(String((a.updatedAt||a.createdAt)||"")));
    const filtered = applyFilters(sorted);
    els.count.textContent = `${filtered.length} shown / ${tx.length} live (${allTx.length} incl. tombstones)`;

    els.rows.innerHTML = filtered.map(x=>{
      const amt = Math.abs(S.n2(x.amount));
      const signed = x.type==="expense" ? -amt : amt;
      const color = x.type==="expense" ? "var(--bad)" : "var(--good)";
      return `
        <tr data-id="${S.esc(x.id)}">
          <td>${S.esc(x.date||"")}</td>
          <td>${S.esc(x.type||"")}</td>
          <td>${S.esc(x.category||"")}</td>
          <td class="mono right" style="color:${color}">${S.money(signed)}</td>
          <td>${S.esc(x.notes||"")}</td>
          <td class="right">
            <button class="btn secondary" data-edit>Edit</button>
            <button class="btn secondary" data-del>Del</button>
          </td>
        </tr>`;
    }).join("");

    S.qa("tr", els.rows).forEach(tr=>{
      const id = tr.getAttribute("data-id");
      const btnE = tr.querySelector("[data-edit]");
      const btnD = tr.querySelector("[data-del]");
      btnE.addEventListener("click", ()=>openEdit(id));
      btnD.addEventListener("click", ()=>del(id));
    });

    kpis();
  }

  async function persist(){
    try{
      await vault.setState(state);
    }catch(e){
      if(String(e?.message||"").includes("vault-locked")) S.toast("Vault is locked");
      else S.toast("Save failed (storage)");
    }
  }

  async function add(){
    const date=(els.date.value||"").trim()||today();
    const type=(els.type.value||"income").trim()==="expense"?"expense":"income";
    const category=(els.cat.value||"").trim();
    const amount=Math.abs(S.n2(els.amt.value));
    const notes=(els.note.value||"").trim();
    if(!category) return S.toast("Category required");
    if(!(amount>0)) return S.toast("Amount must be > 0");

    const nowIso = new Date().toISOString();
    state.tx.push({id:S.uid(),date,type,category:category.slice(0,120),amount,notes:notes.slice(0,240),createdAt:nowIso,updatedAt:nowIso,updatedByDevice:DEV,deletedAt:null,deletedByDevice:""});
    els.cat.value=""; els.amt.value=""; els.note.value="";
    await persist();
    S.toast("Added");
    render();
  }

  async function del(id){
    const x = state.tx.find(t=>t.id===id);
    if(!x) return;
    const ok = await S.confirm("Delete transaction", `Delete ${x.type} $${x.amount} (${x.category}) on ${x.date}?`, "Delete");
    if(!ok) return;
    x.deletedAt = new Date().toISOString();
    x.deletedByDevice = DEV;
    await persist();
    S.toast("Deleted");
    render();
  }

  function openEdit(id){
    const x = state.tx.find(t=>t.id===id);
    if(!x) return;
    editingId = id;
    els.e_date.value = x.date || today();
    els.e_type.value = (x.type==="expense") ? "expense" : "income";
    els.e_cat.value = x.category || "";
    els.e_amt.value = String(Math.abs(S.n2(x.amount)));
    els.e_note.value = x.notes || "";
    els.editBack.hidden = false;
    setTimeout(()=>els.e_cat.focus(), 0);
  }

  function closeEdit(){
    editingId = null;
    els.editBack.hidden = true;
  }

  async function saveEdit(){
    const x = state.tx.find(t=>t.id===editingId);
    if(!x) return closeEdit();
    const date=(els.e_date.value||"").trim()||today();
    const type=(els.e_type.value||"income").trim()==="expense"?"expense":"income";
    const category=(els.e_cat.value||"").trim();
    const amount=Math.abs(S.n2(els.e_amt.value));
    const notes=(els.e_note.value||"").trim();
    if(!category) return S.toast("Category required");
    if(!(amount>0)) return S.toast("Amount must be > 0");

    x.date = date;
    x.type = type;
    x.category = category.slice(0,120);
    x.amount = amount;
    x.notes = notes.slice(0,240);
    x.updatedAt = new Date().toISOString();
    x.updatedByDevice = DEV;

    await persist();
    closeEdit();
    S.toast("Updated");
    render();
  }

  function exportCsv(){
    const rows=[["date","type","category","amount","notes"]];
    state.tx.filter(x=>!x.deletedAt).slice().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))).forEach(x=>{
      const signed = x.type==="expense" ? -Math.abs(S.n2(x.amount)) : Math.abs(S.n2(x.amount));
      rows.push([x.date||"",x.type||"",x.category||"",String(signed),x.notes||""]);
    });
    const csv = rows.map(r=>r.map(S.csvEsc).join(",")).join("\n");
    S.download(`skyecash-ledger-${new Date().toISOString().slice(0,10)}.csv`, csv, "text/csv");
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

    if(Array.isArray(obj.tx)){
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
      await securityMenu();
      const rr2 = await vault.read(DEFAULT);
      state = rr2.state || DEFAULT();
    } else {
      state = rr.state || DEFAULT();
    }

    if(!Array.isArray(state.tx)) state.tx = [];
    if(state.tx.length === 0) state = DEFAULT();

    // Normalize for CRDT-safe sync (soft deletes + updated stamps)
    state.tx.forEach(x=>{
      if(!x.createdAt) x.createdAt = new Date().toISOString();
      if(!x.updatedAt) x.updatedAt = x.createdAt;
      if(!x.updatedByDevice) x.updatedByDevice = "";
      if(typeof x.deletedAt === 'undefined') x.deletedAt = null;
      if(!x.deletedByDevice) x.deletedByDevice = "";
    });
    await vault.setState(state);

    els.date.value = today();
    render();

    // Events
    els.add.addEventListener("click", add);
    els.csv.addEventListener("click", exportCsv);
    els.btnExport.addEventListener("click", exportJson);
    els.btnSecurity.addEventListener("click", securityMenu);
    els.btnReset.addEventListener("click", resetApp);

    [els.q, els.ft, els.from, els.to].forEach(el=>{
      el.addEventListener("input", render);
      el.addEventListener("change", render);
    });
    els.clear.addEventListener("click", ()=>{
      els.q.value=""; els.ft.value=""; els.from.value=""; els.to.value="";
      S.toast("Filters cleared");
      render();
    });

    els.fileImport.addEventListener("change", async (e)=>{
      const f = e.target.files && e.target.files[0];
      e.target.value="";
      if(!f) return;
      if(f.size > 8*1024*1024) return S.toast("Import blocked: file too large");
      await importJson(f);
    });

    // Edit modal controls
    els.e_cancel.addEventListener("click", closeEdit);
    els.e_save.addEventListener("click", saveEdit);
    els.editBack.addEventListener("click", (e)=>{ if(e.target===els.editBack) closeEdit(); });
    window.addEventListener("keydown", (e)=>{ if(!els.editBack.hidden && e.key==="Escape") closeEdit(); });
  }

  boot();
})();
