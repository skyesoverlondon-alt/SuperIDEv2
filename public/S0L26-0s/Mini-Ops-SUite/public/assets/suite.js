(function(){
  "use strict";
  const S = window.SkyeShell;
  if(!S) return;

  const btnExport = S.q("#suiteExport");
  const fileImport = S.q("#suiteImport");
  const btnSecurity = S.q("#suiteSecurity");
  const badge = S.q("#buildBadge");
  S.attachBuildBadge(badge);

  const VAULTS = [
    { ns:"skyenote_vault", legacy:"skyenote_vault_offline", label:"SkyeNote" },
    { ns:"skyecash_ledger", legacy:"skyecash_ledger_offline", label:"SkyeCash" },
    { ns:"skyefocus_log", legacy:"skyefocus_log_offline", label:"SkyeFocus" }
  ];

  async function openVault(v){
    return S.Vault.open(v.ns, {
      legacyLocalStorageKey: v.legacy
    });
  }

  async function exportAll(){
    const out = {
      format: "skye-mini-ops-suite/v4",
      buildId: S.BUILD.buildId,
      schemaVersion: S.BUILD.schemaVersion,
      exportedAt: new Date().toISOString(),
      vaults: {}
    };
    for(const v of VAULTS){
      const vault = await openVault(v);
      out.vaults[v.ns] = await vault.exportRecord();
    }
    const name = `skye-mini-ops-suite-backup-${new Date().toISOString().slice(0,10)}.json`;
    S.download(name, JSON.stringify(out, null, 2));
    S.toast("Exported suite backup");
  }

  async function importAll(file){
    const txt = await S.readFileText(file);
    let obj=null;
    try{ obj = JSON.parse(txt); }catch(e){ obj=null; }
    if(!obj || !obj.vaults || (obj.format !== "skye-mini-ops-suite/v4" && obj.format !== "skye-mini-ops-suite/v3" && obj.format !== "skye-mini-ops-suite/v2")){
      S.toast("Import failed: invalid suite backup");
      return;
    }

    // Detect if any vault is encrypted
    const encryptedVaults = Object.entries(obj.vaults).filter(([k,rec])=>rec && rec.encrypted);
    let pass = null;
    if(encryptedVaults.length){
      const r = await S.modal({
        title:"Encrypted suite backup",
        text:"This backup contains encrypted vaults. Enter the passphrase to import them.",
        okText:"Import",
        cancelText:"Cancel",
        type:"password",
        placeholder:"Passphrase",
        require:true
      });
      if(!r.ok) return;
      pass = r.value;
    }

    for(const v of VAULTS){
      const rec = obj.vaults[v.ns];
      if(!rec) continue;
      const vault = await openVault(v);
      const res = await vault.importRecord(rec, pass || undefined);
      if(!res.ok){
        S.toast(`${v.label} import failed: ${res.error}`);
        return;
      }
    }
    S.toast("Imported suite backup");
  }

  async function suiteSecurity(){
    const lines = [];
    for(const v of VAULTS){
      const vault = await openVault(v);
      const st = await vault.status();
      const tag = st.exists ? (st.encrypted ? (st.locked ? "encrypted (locked)" : "encrypted (unlocked)") : "unencrypted") : "empty";
      lines.push(`${v.label}: ${tag}`);
    }

    // Sync status (optional)
    try{
      const cfg = await S.Sync.getConfig();
      if(cfg.enabled){
        lines.push(`Sync: enabled (${cfg.role||"member"})`);
      }else{
        lines.push("Sync: disabled");
      }
    }catch(_){
      // ignore
    }

    await S.modal({
      title:"Suite security status",
      text: lines.join("  •  "),
      okText:"OK",
      cancelText:"Close",
      type:"text",
      placeholder:"",
      require:false
    });
  }

  if(btnExport) btnExport.addEventListener("click", exportAll);
  if(fileImport){
    fileImport.addEventListener("change", async (e)=>{
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if(!f) return;
      if(f.size > 12*1024*1024){ S.toast("Import blocked: file too large"); return; }
      await importAll(f);
    });
  }
  if(btnSecurity) btnSecurity.addEventListener("click", suiteSecurity);
})();
