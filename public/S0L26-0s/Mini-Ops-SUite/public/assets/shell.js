/* Skye Mini Ops Suite - offline-first shell + optional SkyeSync */
(function () {
  "use strict";

  const BUILD = {"name":"Skye Mini Ops Suite","buildId":"20260222-ENTERPRISE-V11","schemaVersion":11,"createdAt":"2026-02-22T01:19:00-07:00","notes":"v11 enterprise hardening: token binding (PoP), device posture checks, SCIM deprovision cascades, audit proof export packs, per-user token version invalidation."};

  const SkyeShell = {};

  // DOM helpers
  SkyeShell.q = (sel, root=document) => root.querySelector(sel);
  SkyeShell.qa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // Safe HTML escaping for text-only rendering
  SkyeShell.esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

  // IDs
  SkyeShell.uid = () => (crypto?.randomUUID ? crypto.randomUUID() : (Math.random().toString(16).slice(2)+"-"+Date.now().toString(16)));

  // Money
  SkyeShell.n2 = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  };
  SkyeShell.money = (n) => {
    const x = SkyeShell.n2(n);
    return (x < 0 ? "-" : "") + "$" + Math.abs(x).toFixed(2);
  };

  // CSV escape
  SkyeShell.csvEsc = (s) => {
    s = String(s ?? "");
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };

  // Base64 helpers
  function u8ToB64(u8) {
    let s = "";
    for (let i=0;i<u8.length;i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  function b64ToU8(b64) {
    const bin = atob(String(b64||""));
    const u8 = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function b64UrlEnc(u8){
    return u8ToB64(u8).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function b64UrlDec(s){
    s = String(s||"").replace(/-/g,'+').replace(/_/g,'/');
    while(s.length % 4) s += '=';
    return b64ToU8(s);
  }
  SkyeShell.u8ToB64 = u8ToB64;
  SkyeShell.b64ToU8 = b64ToU8;
  SkyeShell.b64UrlEnc = b64UrlEnc;
  SkyeShell.b64UrlDec = b64UrlDec;

  // Toast (requires #toast)
  SkyeShell.toast = (msg, ms=1600) => {
    const t = SkyeShell.q("#toast");
    if(!t) return;
    t.textContent = String(msg ?? "");
    t.classList.add("show");
    clearTimeout(SkyeShell.toast._t);
    SkyeShell.toast._t = setTimeout(()=>t.classList.remove("show"), ms);
  };

  // File helpers
  SkyeShell.download = (name, text, mime="application/json") => {
    const b = new Blob([text], {type:mime});
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(u); a.remove(); }, 0);
  };
  SkyeShell.readFileText = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("read-failed"));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsText(file);
  });

  // ---------- Modal UI ----------
  function ensureModalEls() {
    const back = SkyeShell.q("#modalBack");
    const title = SkyeShell.q("#modalTitle");
    const text = SkyeShell.q("#modalText");
    const input = SkyeShell.q("#modalInput");
    const input2 = SkyeShell.q("#modalInput2");
    const ok = SkyeShell.q("#modalOk");
    const cancel = SkyeShell.q("#modalCancel");
    if(!back || !title || !text || !input || !ok || !cancel) {
      throw new Error("modal-missing");
    }
    return {back,title,text,input,input2,ok,cancel};
  }

  SkyeShell.modal = (opts) => {
    const {back,title,text,input,input2,ok,cancel} = ensureModalEls();
    const cfg = Object.assign({
      title: "Dialog",
      text: "",
      html: null,
      placeholder: "",
      placeholder2: "",
      type: "text",
      type2: "password",
      showInput: true,
      showSecond: false,
      okText: "OK",
      cancelText: "Cancel",
      require: false,
      requireSecond: false
    }, opts || {});

    title.textContent = cfg.title;
    if(cfg.html !== null && cfg.html !== undefined) { text.innerHTML = String(cfg.html); } else { text.textContent = cfg.text; }

    input.type = cfg.type || "text";
    input.placeholder = cfg.placeholder || "";
    input.value = "";
    
    const field1 = input.closest(".field");
    if(field1) field1.classList.toggle("hidden", !cfg.showInput);

    if(input2) {
      input2.type = cfg.type2 || "password";
      input2.placeholder = cfg.placeholder2 || "";
      input2.value = "";
      input2.autocomplete = (input2.type === "password") ? "new-password" : "off";
      const field2 = input2.closest(".field2");
      if(field2) field2.classList.toggle("hidden", !cfg.showSecond);
    }

    ok.textContent = cfg.okText;
    cancel.textContent = cfg.cancelText;

    back.hidden = false;
    setTimeout(()=> (cfg.showInput ? input : ok).focus(), 0);

    return new Promise((resolve) => {
      function cleanup(result) {
        ok.removeEventListener("click", onOk);
        cancel.removeEventListener("click", onCancel);
        back.removeEventListener("click", onBack);
        window.removeEventListener("keydown", onKey);
        back.hidden = true;
        resolve(result);
      }
      function validate() {
        const v1 = input.value;
        const v2 = input2 ? input2.value : "";
        if(cfg.showInput && cfg.require && !v1) { SkyeShell.toast("Required"); return false; }
        if(cfg.showSecond && cfg.requireSecond && !v2) { SkyeShell.toast("Required"); return false; }
        return true;
      }
      function onOk() {
        if(!validate()) return;
        cleanup({ ok:true, value: input.value, value2: input2 ? input2.value : "" });
      }
      function onCancel() { cleanup({ ok:false }); }
      function onBack(e) { if(e.target === back) cleanup({ ok:false }); }
      function onKey(e) {
        if(e.key === "Escape") return cleanup({ ok:false });
        if(e.key === "Enter") return onOk();
      }
      ok.addEventListener("click", onOk);
      cancel.addEventListener("click", onCancel);
      back.addEventListener("click", onBack);
      window.addEventListener("keydown", onKey);
    });
  };

  SkyeShell.confirm = async (title, text, okText="Confirm") => {
    const r = await SkyeShell.modal({title, text, okText, cancelText:"Cancel", type:"text", placeholder:"", require:false});
    return !!(r && r.ok);
  };

  // ---------- IndexedDB ----------
  const DB_NAME = "skye_mini_ops_db";
  const DB_VER = 2;
  const STORE = "vaults";

  function openDB() {
    return new Promise((resolve, reject) => {
      if(!("indexedDB" in window)) return reject(new Error("idb-not-supported"));
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb-open-failed"));
    });
  }

  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const st = tx.objectStore(STORE);
      const req = st.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb-get-failed"));
    });
  }

  async function idbPut(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error("idb-put-failed"));
    });
  }

  async function idbDel(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error("idb-del-failed"));
    });
  }

  SkyeShell.Store = {
    get: idbGet,
    set: idbPut,
    del: idbDel
  };

  // ---------- Crypto helpers (AES-GCM + PBKDF2) ----------
  async function deriveKey(passphrase, saltB64, iterations) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(String(passphrase||"")),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const salt = b64ToU8(saltB64);
    return crypto.subtle.deriveKey(
      { name:"PBKDF2", salt, iterations, hash:"SHA-256" },
      keyMaterial,
      { name:"AES-GCM", length:256 },
      false,
      ["encrypt","decrypt"]
    );
  }
  async function encryptJSON(obj, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const data = enc.encode(JSON.stringify(obj));
    const cipher = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, data);
    return { ivB64: u8ToB64(iv), dataB64: u8ToB64(new Uint8Array(cipher)) };
  }
  async function decryptJSON(cipher, key) {
    const iv = b64ToU8(cipher.ivB64);
    const data = b64ToU8(cipher.dataB64);
    const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, data);
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(new Uint8Array(plain)));
  }


async function encryptU8(u8, key){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
  const cipher = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, data);
  return { ivB64: u8ToB64(iv), dataB64: u8ToB64(new Uint8Array(cipher)) };
}

async function decryptU8(cipher, key){
  const iv = b64ToU8(cipher.ivB64);
  const data = b64ToU8(cipher.dataB64);
  const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, data);
  return new Uint8Array(plain);
}

  // ---------- Vault ----------
  class Vault {
    constructor(namespace, opts) {
      this.ns = namespace;
      this.opts = opts || {};
      this._key = null; // crypto key in-memory (unlocks encrypted vault)
      this._meta = null;
    }

    static async open(namespace, opts) {
      const v = new Vault(namespace, opts);
      await v._bootstrap();
      return v;
    }

    async _bootstrap() {
      // Migration from legacy localStorage (one-time) if no IDB record exists
      const rec = await idbGet(this.ns);
      if(rec) return;

      const legacyKey = this.opts.legacyLocalStorageKey;
      if(legacyKey) {
        try {
          const raw = localStorage.getItem(legacyKey);
          if(raw) {
            const obj = JSON.parse(raw);
            const init = this.opts.migrateFromLegacy ? this.opts.migrateFromLegacy(obj) : obj;
            await idbPut(this.ns, this._wrapPlain(init));
            // keep legacy for safety; users can delete manually
          }
        } catch (_) {}
      }
    }

    _wrapPlain(state) {
      const now = new Date().toISOString();
      return {
        format: "skye-mini-ops/v3",
        buildId: BUILD.buildId,
        schemaVersion: BUILD.schemaVersion,
        encrypted: false,
        data: state,
        updatedAt: now
      };
    }

    async status() {
      const rec = await idbGet(this.ns);
      if(!rec) return { exists:false, encrypted:false, locked:false, updatedAt:null };
      return { exists:true, encrypted:!!rec.encrypted, locked:!!rec.encrypted && !this._key, updatedAt:rec.updatedAt||null };
    }

    async read(defaultState) {
      const rec = await idbGet(this.ns);
      if(!rec) {
        const init = (typeof defaultState === "function") ? defaultState() : (defaultState || {});
        await idbPut(this.ns, this._wrapPlain(init));
        return { state: init, encrypted:false, locked:false };
      }

      // Accept v2 records (older builds)
      if(rec.format === "skye-mini-ops/v2" && rec.data && !rec.encrypted) {
        // lazy upgrade to v3 wrapper
        const up = Object.assign({}, rec, { format:"skye-mini-ops/v3", schemaVersion: BUILD.schemaVersion, buildId: BUILD.buildId });
        await idbPut(this.ns, up);
      }

      if(rec.encrypted) {
        if(!this._key) {
          this._meta = rec;
          return { state: null, encrypted:true, locked:true };
        }
        try {
          const st = await decryptJSON(rec.cipher, this._key);
          return { state: st, encrypted:true, locked:false };
        } catch (e) {
          this._key = null;
          this._meta = rec;
          return { state: null, encrypted:true, locked:true, error:"decrypt-failed" };
        }
      }

      return { state: rec.data, encrypted:false, locked:false };
    }

    lock() { this._key = null; }

    async unlock(passphrase) {
      const rec = await idbGet(this.ns);
      if(!rec || !rec.encrypted) return true;
      const iter = Number(rec.kdf?.iterations || 250000);
      const saltB64 = rec.kdf?.saltB64;
      if(!saltB64) return false;
      try {
        const key = await deriveKey(passphrase, saltB64, iter);
        await decryptJSON(rec.cipher, key);
        this._key = key;
        return true;
      } catch (e) {
        return false;
      }
    }

    async setState(state) {
      const rec = await idbGet(this.ns);
      const now = new Date().toISOString();
      if(rec && rec.encrypted) {
        if(!this._key) throw new Error("vault-locked");
        const cipher = await encryptJSON(state, this._key);
        const next = Object.assign({}, rec, { cipher, updatedAt: now, buildId: BUILD.buildId, schemaVersion: BUILD.schemaVersion, format: "skye-mini-ops/v3" });
        await idbPut(this.ns, next);
      } else {
        const next = this._wrapPlain(state);
        await idbPut(this.ns, next);
      }
      // Mark sync-dirty (optional)
      try{ if(SkyeShell.Sync && SkyeShell.Sync.markDirty) SkyeShell.Sync.markDirty(this.ns); }catch(_){}
    }

    async reset(defaultState) {
      await idbDel(this.ns);
      const init = (typeof defaultState === "function") ? defaultState() : (defaultState || {});
      await idbPut(this.ns, this._wrapPlain(init));
      this._key = null;
      try{ if(SkyeShell.Sync && SkyeShell.Sync.markDirty) SkyeShell.Sync.markDirty(this.ns); }catch(_){}
      return init;
    }

    async enableEncryption(passphrase) {
      const iter = 250000;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltB64 = u8ToB64(salt);
      const key = await deriveKey(passphrase, saltB64, iter);
      const cur = await this.read(()=>({}));
      const state = cur.state || {};
      const cipher = await encryptJSON(state, key);
      const now = new Date().toISOString();
      const next = {
        format: "skye-mini-ops/v3",
        buildId: BUILD.buildId,
        schemaVersion: BUILD.schemaVersion,
        encrypted: true,
        kdf: { iterations: iter, saltB64 },
        cipher,
        updatedAt: now
      };
      await idbPut(this.ns, next);
      this._key = key;
      try{ if(SkyeShell.Sync && SkyeShell.Sync.markDirty) SkyeShell.Sync.markDirty(this.ns); }catch(_){}
      return true;
    }

    async disableEncryption(passphrase) {
      const ok = await this.unlock(passphrase);
      if(!ok) return false;
      const cur = await this.read(()=>({}));
      const state = cur.state || {};
      const now = new Date().toISOString();
      const next = {
        format: "skye-mini-ops/v3",
        buildId: BUILD.buildId,
        schemaVersion: BUILD.schemaVersion,
        encrypted: false,
        data: state,
        updatedAt: now
      };
      await idbPut(this.ns, next);
      this._key = null;
      try{ if(SkyeShell.Sync && SkyeShell.Sync.markDirty) SkyeShell.Sync.markDirty(this.ns); }catch(_){}
      return true;
    }

    async exportRecord() {
      const rec = await idbGet(this.ns);
      return rec || null;
    }

    async importRecord(rec, passphrase) {
      if(!rec || (rec.format !== "skye-mini-ops/v3" && rec.format !== "skye-mini-ops/v2")) return { ok:false, error:"bad-format" };
      if(rec.encrypted) {
        if(!passphrase) return { ok:false, error:"passphrase-required" };
        const iter = Number(rec.kdf?.iterations || 250000);
        const saltB64 = rec.kdf?.saltB64;
        if(!saltB64) return { ok:false, error:"bad-kdf" };
        try {
          const key = await deriveKey(passphrase, saltB64, iter);
          await decryptJSON(rec.cipher, key);
          // normalize to v3
          const up = Object.assign({}, rec, { format:"skye-mini-ops/v3", schemaVersion: BUILD.schemaVersion, buildId: BUILD.buildId });
          await idbPut(this.ns, up);
          this._key = key;
          try{ if(SkyeShell.Sync && SkyeShell.Sync.markDirty) SkyeShell.Sync.markDirty(this.ns); }catch(_){}
          return { ok:true };
        } catch (e) {
          return { ok:false, error:"decrypt-failed" };
        }
      }
      if(!rec.data) return { ok:false, error:"missing-data" };
      const up = Object.assign({}, rec, { format:"skye-mini-ops/v3", schemaVersion: BUILD.schemaVersion, buildId: BUILD.buildId });
      await idbPut(this.ns, up);
      this._key = null;
      try{ if(SkyeShell.Sync && SkyeShell.Sync.markDirty) SkyeShell.Sync.markDirty(this.ns); }catch(_){}
      return { ok:true };
    }
  }

  SkyeShell.BUILD = BUILD;
  SkyeShell.Vault = Vault;

  SkyeShell.attachBuildBadge = (el) => {
    try {
      if(!el) return;
      el.textContent = `build ${BUILD.buildId} • schema v${BUILD.schemaVersion}`;
    } catch(_) {}
  };

      // ---------- Optional SkyeSync (E2EE + RBAC) ----------
  // v5: Per-member wrapped DEK (no shared team passphrase).
  // Backward compatible with legacy 'passphrase-v1' orgs; owners can migrate to 'wrapped-dek-v1'.
  const Sync = {};
  Sync._vaultKeyCache = new Map();
  const CFG_KEY = "__sync_config__";
  const AUTH_PRIV_KEY = "__sync_auth_priv_key__";
  const AUTH_PUB_KEY = "__sync_auth_pub_jwk__";
  const ENC_PRIV_KEY = "__sync_enc_priv_key__";
  const ENC_PUB_KEY = "__sync_enc_pub_jwk__";
  const DEVICE_KEY = "__sync_device_id__";
  const META_PREFIX = "__sync_meta__::";
  const CONFLICT_PREFIX = "__sync_conflict__::";
  const VAULTKEY_WRAP_PREFIX = "__sync_vkeywrap__::";

  function defaultCfg(){
    return {
      enabled: false,
      baseUrl: "", // empty = same origin
      orgId: "",
      userId: "",
      role: "",
      token: "",

      // Enterprise policy (read-only client cache; authoritative on server)
      policy: {},

      // Org encryption model: 'wrapped-dek-v1' (recommended) or 'passphrase-v1' (legacy)
      keyModel: "",

      // Legacy fields (used only when keyModel==='passphrase-v1')
      orgSaltB64: "",
      orgKdfIterations: 250000,

      orgEpoch: 1,
      tokenVersion: 1,

      // Capability flags (from server)
      encKeyReady: false,
      authKeyReady: false,
      dekReady: false,

      update: {
        enabled: true,
        channelJson: "/updates/latest.json",
        channelSig: "/updates/latest.sig",
        pubKeyJwk: null,
        verifyAssets: true
      }
    };
  }

  // In-memory keys
  Sync._dekKey = null;     // CryptoKey (AES-GCM) for wrapped-dek-v1
  Sync._dekMeta = null;    // { epoch }
  Sync._legacyKey = null;  // CryptoKey (AES-GCM) derived from passphrase for passphrase-v1
  Sync._legacyMeta = null; // { saltB64, epoch }
  Sync._cfg = null;

  Sync.getDeviceId = async () => {
    let id = await idbGet(DEVICE_KEY);
    if(id) return String(id);
    id = "dev-" + uid();
    await idbPut(DEVICE_KEY, id);
    return id;
  };

  Sync.collectPosture = async () => {
    const ua = navigator.userAgent || '';
    let name = 'unknown';
    let major = null;
    try{
      const mEdg = ua.match(/Edg\/(\d+)/);
      const mChr = ua.match(/Chrome\/(\d+)/);
      const mFx = ua.match(/Firefox\/(\d+)/);
      const mSaf = (!mChr && ua.match(/Version\/(\d+).*Safari/));
      if(mEdg){ name='edge'; major=Number(mEdg[1]); }
      else if(mChr){ name='chrome'; major=Number(mChr[1]); }
      else if(mFx){ name='firefox'; major=Number(mFx[1]); }
      else if(mSaf){ name='safari'; major=Number(mSaf[1]); }
    }catch(_){}

    let tz = '';
    try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(_){}

    const posture = {
      version: 1,
      ts: Date.now(),
      secureContext: !!window.isSecureContext,
      webcrypto: !!(window.crypto && crypto.subtle),
      webauthn: !!(navigator.credentials && window.PublicKeyCredential),
      platform: String(navigator.platform || ''),
      browser: { name, major },
      timezone: tz,
      pwa: { standalone: (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (navigator.standalone === true) }
    };
    return posture;
  };

  Sync.submitPosture = async () => {
    const cfg = await Sync.getConfig();
    if(!cfg.token) return { ok:false, error:'no-token' };
    const posture = await Sync.collectPosture();
    try{
      return await Sync._api('/.netlify/functions/sync-posture-submit', { auth:true, body:{ posture } });
    }catch(e){
      return { ok:false, error:(e && e.message) ? e.message : 'posture-submit-failed' };
    }
  };

  Sync.getConfig = async () => {
    if(Sync._cfg) return Sync._cfg;
    const c = await idbGet(CFG_KEY);
    Sync._cfg = Object.assign(defaultCfg(), c || {});
    Sync._cfg.update = Object.assign(defaultCfg().update, (Sync._cfg.update || {}));
    return Sync._cfg;
  };

  Sync.setConfig = async (cfg) => {
    const next = Object.assign(defaultCfg(), cfg || {});
    next.update = Object.assign(defaultCfg().update, (next.update || {}));
    Sync._cfg = next;
    await idbPut(CFG_KEY, next);
    return next;
  };

  Sync.disable = async () => {
    const cfg = await Sync.getConfig();
    cfg.enabled = false;
    cfg.token = "";
    cfg.encKeyReady = false;
    cfg.dekReady = false;
    await Sync.setConfig(cfg);
    Sync.lock();
    return true;
  };

  Sync.lock = () => { Sync._dekKey = null; Sync._dekMeta = null; Sync._legacyKey = null; Sync._legacyMeta = null; Sync._vaultKeyCache = new Map(); };
  Sync.hasKey = () => !!(Sync._dekKey || Sync._legacyKey);

  // Unlock:
  // - wrapped-dek-v1: fetch + unwrap org DEK (no passphrase)
  // - passphrase-v1: derive key from passphrase (required)
  Sync.unlock = async (secret) => {
    const cfg = await Sync.getConfig();
    const km = String(cfg.keyModel || "");
    if(km === "passphrase-v1"){
      if(!secret) throw new Error("passphrase-required");
      await Sync.unlockLegacy(secret);
      return true;
    }
    await Sync.ensureDEK();
    return true;
  };

  Sync._maybeLockOnOrgChange = async (nextCfg) => {
    try{
      // wrapped-dek: lock if epoch changed
      if(Sync._dekKey){
        const meta = Sync._dekMeta || {};
        const sameEpoch = Number(meta.epoch||0) === Number(nextCfg.orgEpoch||0);
        if(!sameEpoch) { Sync._dekKey = null; Sync._dekMeta = null; Sync._vaultKeyCache = new Map(); }
      }
      // legacy passphrase: lock if salt/epoch changed
      if(Sync._legacyKey){
        const meta = Sync._legacyMeta || {};
        const sameSalt = String(meta.saltB64||"") === String(nextCfg.orgSaltB64||"");
        const sameEpoch = Number(meta.epoch||0) === Number(nextCfg.orgEpoch||0);
        if(!sameSalt || !sameEpoch) { Sync._legacyKey = null; Sync._legacyMeta = null; }
      }
    }catch(_){ /* ignore */ }
  };

  Sync._apiUrl = async (path) => {
    const cfg = await Sync.getConfig();
    const base = String(cfg.baseUrl || "").trim();
    if(!base) return path;
    return base.replace(/\/$/,"") + path;
  };

  Sync._api = async (path, opts) => {
    const cfg = await Sync.getConfig();
    const url = await Sync._apiUrl(path);
    const method = (opts?.method || "POST").toUpperCase();
    const bodyStr = opts?.body ? JSON.stringify(opts.body) : "";
    const headers = Object.assign({"Content-Type":"application/json"}, (opts?.headers||{}));

    if(opts?.auth && cfg.token){
      headers["Authorization"] = `Bearer ${cfg.token}`;

      // Always send device id header for server-side binding checks
      const deviceId = await Sync.getDeviceId();
      if(deviceId) headers["X-Skye-Device-Id"] = deviceId;

      // Token binding (PoP) headers: safe to include even if server policy doesn't enforce it
      try{
        const { privKey } = await getOrCreateAuthKeypair();
        const ts = Math.floor(Date.now()/1000);
        const nonce = randB64Url(18);
        const bodyHash = await sha256B64UrlUtf8(bodyStr || "");
        const canonical = [
          "v1",
          method,
          String(path||""),
          String(cfg.token||""),
          String(deviceId||""),
          String(ts),
          String(nonce),
          String(bodyHash)
        ].join("\n");
        const sigB64 = await signUtf8(privKey, canonical);

        headers["X-Skye-Bind-TS"] = String(ts);
        headers["X-Skye-Bind-Nonce"] = String(nonce);
        headers["X-Skye-Body-Hash"] = String(bodyHash);
        headers["X-Skye-Bind"] = String(sigB64);
      }catch(_){ /* best-effort */ }
    }

    const res = await fetch(url, {method, headers, body: bodyStr ? bodyStr : undefined});
    const txt = await res.text();
    let data = null;
    try{ data = txt ? JSON.parse(txt) : null; }catch(_){ data = null; }
    if(!res.ok) {
      const msg = (data && (data.error || data.message)) ? (data.error || data.message) : (`http-${res.status}`);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  Sync._jwtPayload = (token) => {
    try{
      const parts = String(token||"").split('.');
      if(parts.length !== 3) return null;
      const u8 = b64UrlDec(parts[1]);
      const json = new TextDecoder().decode(u8);
      return JSON.parse(json);
    }catch(_){ return null; }
  };

  Sync._tokenFresh = async () => {
    const cfg = await Sync.getConfig();
    if(!cfg.token) return false;
    const p = Sync._jwtPayload(cfg.token);
    if(!p || !p.exp) return false;
    const now = Math.floor(Date.now()/1000);
    return p.exp > (now + 90);
  };

  // ---------- Keypairs ----------
  async function importEcdsaPrivJwk(jwk){
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name:"ECDSA", namedCurve:"P-256" },
      false,
      ["sign"]
    );
  }

  async function genAuthKeypairFresh(){
    const kp = await crypto.subtle.generateKey({name:"ECDSA", namedCurve:"P-256"}, true, ["sign","verify"]);
    const pubJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const priv = await importEcdsaPrivJwk(privJwk);
    await idbPut(AUTH_PRIV_KEY, priv);
    await idbPut(AUTH_PUB_KEY, pubJwk);
    return { privKey: priv, pubJwk };
  }

  async function getOrCreateAuthKeypair(){
    const privKey = await idbGet(AUTH_PRIV_KEY);
    const pubJwk = await idbGet(AUTH_PUB_KEY);
    if(privKey && pubJwk) return { privKey, pubJwk };
    return genAuthKeypairFresh();
  }

  async function genEncKeypairFresh(){
    const kp = await crypto.subtle.generateKey({name:"ECDH", namedCurve:"P-256"}, true, ["deriveBits"]);
    const pubJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const priv = await crypto.subtle.importKey("jwk", privJwk, {name:"ECDH", namedCurve:"P-256"}, false, ["deriveBits"]);
    await idbPut(ENC_PRIV_KEY, priv);
    await idbPut(ENC_PUB_KEY, pubJwk);
    return { privKey: priv, pubJwk };
  }

  async function getOrCreateEncKeypair(){
    const privKey = await idbGet(ENC_PRIV_KEY);
    const pubJwk = await idbGet(ENC_PUB_KEY);
    if(privKey && pubJwk) return { privKey, pubJwk };
    return genEncKeypairFresh();
  }

  async function signNonce(privKey, nonceB64Url){
    const data = b64UrlDec(nonceB64Url);
    const sig = await crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, privKey, data);
    return u8ToB64(new Uint8Array(sig));
  }

  async function sha256B64UrlUtf8(str){
    const enc = new TextEncoder().encode(String(str||""));
    const digest = await crypto.subtle.digest('SHA-256', enc);
    return b64UrlEnc(new Uint8Array(digest));
  }

  function randB64Url(bytes=18){
    const u8 = crypto.getRandomValues(new Uint8Array(bytes));
    return b64UrlEnc(u8);
  }

  async function signUtf8(privKey, msg){
    const data = new TextEncoder().encode(String(msg||""));
    const sig = await crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, privKey, data);
    return u8ToB64(new Uint8Array(sig));
  }

  // ---------- Wrapped DEK (E2EE) ----------
  const WRAP_INFO = new TextEncoder().encode("SkyeSync-DEK-WRAP-v1");

  async function importEcdhPub(jwk){
    return crypto.subtle.importKey("jwk", jwk, {name:"ECDH", namedCurve:"P-256"}, false, []);
  }

  async function hkdfWrapKey(sharedBitsU8, saltU8){
    const baseKey = await crypto.subtle.importKey("raw", sharedBitsU8, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name:"HKDF", hash:"SHA-256", salt: saltU8, info: WRAP_INFO },
      baseKey,
      { name:"AES-GCM", length: 256 },
      false,
      ["encrypt","decrypt"]
    );
  }

  async function unwrapDEK(myEncPrivKey, wrap){
    if(!wrap || wrap.format !== "skye-dek-wrap/v1") throw new Error("sync-bad-dek-wrap");
    const ephPub = await importEcdhPub(wrap.ephPubJwk);
    const sharedBits = await crypto.subtle.deriveBits({name:"ECDH", public: ephPub}, myEncPrivKey, 256);
    const salt = b64ToU8(wrap.saltB64);
    const wrapKey = await hkdfWrapKey(new Uint8Array(sharedBits), salt);
    const nonce = b64ToU8(wrap.nonceB64);
    const ct = b64ToU8(wrap.ctB64);
    const dekRaw = await crypto.subtle.decrypt({name:"AES-GCM", iv: nonce}, wrapKey, ct);
    return crypto.subtle.importKey("raw", dekRaw, {name:"AES-GCM"}, true, ["encrypt","decrypt"]);
  }

  async function wrapDEKForMember(memberEncPubJwk, dekKey){
    const recipientPub = await importEcdhPub(memberEncPubJwk);
    const eph = await crypto.subtle.generateKey({name:"ECDH", namedCurve:"P-256"}, true, ["deriveBits"]);
    const ephPubJwk = await crypto.subtle.exportKey("jwk", eph.publicKey);

    const sharedBits = await crypto.subtle.deriveBits({name:"ECDH", public: recipientPub}, eph.privateKey, 256);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const wrapKey = await hkdfWrapKey(new Uint8Array(sharedBits), salt);

    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const dekRaw = await crypto.subtle.exportKey("raw", dekKey);
    const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv: nonce}, wrapKey, dekRaw);

    return {
      format: "skye-dek-wrap/v1",
      ephPubJwk,
      saltB64: u8ToB64(salt),
      nonceB64: u8ToB64(nonce),
      ctB64: u8ToB64(new Uint8Array(ct))
    };
  }

  // ---------- Auth / org info ----------
  Sync.ensureToken = async () => {
    const cfg = await Sync.getConfig();
    if(!cfg.enabled) throw new Error("sync-disabled");

    if(await Sync._tokenFresh()){
      try{
        const info = await Sync._api("/.netlify/functions/sync-org-info", {auth:true, body:{}});
        const next = await Sync.getConfig();

        next.role = info.role || next.role;
        next.keyModel = info.keyModel || next.keyModel || "";
        next.orgSaltB64 = info.orgSaltB64 || next.orgSaltB64;
        next.orgKdfIterations = info.orgKdfIterations || next.orgKdfIterations;
        next.orgEpoch = Number(info.orgEpoch || next.orgEpoch || 1);
        next.tokenVersion = Number(info.tokenVersion || next.tokenVersion || 1);
        next.encKeyReady = !!info.encKeyReady;
        next.authKeyReady = !!info.authKeyReady;
        next.dekReady = !!info.dekReady;
        if(info.policy) next.policy = info.policy;

        await Sync._maybeLockOnOrgChange(next);
        await Sync.setConfig(next);

        if(!next.encKeyReady || !next.authKeyReady){
          const { pubJwk: encPubKeyJwk } = await getOrCreateEncKeypair();
          const { pubJwk: authPubKeyJwk } = await getOrCreateAuthKeypair();
          try{
            await Sync._api("/.netlify/functions/sync-user-keys-update", {auth:true, body:{ encPubKeyJwk, authPubKeyJwk }});
            next.encKeyReady = true;
            next.authKeyReady = true;
            await Sync.setConfig(next);
          }catch(_){ /* ignore */ }
        }

        return true;
      }catch(err){
        if(err && (err.status === 401 || err.status === 403)){
          cfg.token = "";
          await Sync.setConfig(cfg);
        } else {
          return true;
        }
      }
    }

    // Re-auth via challenge+verify
    const { privKey, pubJwk: authPubJwk } = await getOrCreateAuthKeypair();
    const { pubJwk: encPubJwk } = await getOrCreateEncKeypair();

    const deviceId = await Sync.getDeviceId();

    const ch = await Sync._api("/.netlify/functions/sync-challenge", {auth:false, body:{ orgId: cfg.orgId, userId: cfg.userId, deviceId }});
    const sigB64 = await signNonce(privKey, ch.nonce);
    let ver = null;
    try{
      ver = await Sync._api("/.netlify/functions/sync-verify", {auth:false, body:{ orgId: cfg.orgId, userId: cfg.userId, deviceId, challengeId: ch.challengeId, signatureB64: sigB64 }});
    }catch(e){
      // Enterprise step-up auth: if required, complete a WebAuthn assertion and retry.
      if(e && e.status === 409 && e.message === 'webauthn-required' && e.data && e.data.webauthn && navigator.credentials){
        const pk = e.data.webauthn.publicKey;
        const waChId = e.data.webauthn.challengeId;

        const pubKey = Object.assign({}, pk);
        try{
          pubKey.challenge = b64UrlDec(pk.challenge).buffer;
          if(pubKey.allowCredentials && Array.isArray(pubKey.allowCredentials)){
            pubKey.allowCredentials = pubKey.allowCredentials.map(c=>({
              type: c.type || 'public-key',
              id: b64UrlDec(c.id).buffer,
              transports: c.transports
            }));
          }
        }catch(_){ throw e; }

        const cred = await navigator.credentials.get({ publicKey: pubKey });
        if(!cred) throw e;
        const resp = cred.response;
        const wa = {
          id: cred.id,
          rawId: b64UrlEnc(new Uint8Array(cred.rawId)),
          type: cred.type,
          authenticatorAttachment: cred.authenticatorAttachment,
          clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
          response: {
            clientDataJSON: b64UrlEnc(new Uint8Array(resp.clientDataJSON)),
            authenticatorData: b64UrlEnc(new Uint8Array(resp.authenticatorData)),
            signature: b64UrlEnc(new Uint8Array(resp.signature)),
            userHandle: resp.userHandle ? b64UrlEnc(new Uint8Array(resp.userHandle)) : null
          }
        };

        ver = await Sync._api("/.netlify/functions/sync-verify", {auth:false, body:{ orgId: cfg.orgId, userId: cfg.userId, deviceId, challengeId: ch.challengeId, signatureB64: sigB64, webauthn:{ challengeId: waChId, response: wa } }});
      } else {
        throw e;
      }
    }


    cfg.token = ver.token;
    cfg.role = ver.role || cfg.role;
    if(ver.policy) cfg.policy = ver.policy;
    if(ver.userTokenVersion) cfg.userTokenVersion = Number(ver.userTokenVersion);
    if(ver.orgSaltB64) cfg.orgSaltB64 = ver.orgSaltB64;
    if(ver.orgKdfIterations) cfg.orgKdfIterations = ver.orgKdfIterations;
    if(ver.orgEpoch) cfg.orgEpoch = Number(ver.orgEpoch);
    if(ver.tokenVersion) cfg.tokenVersion = Number(ver.tokenVersion);
    if(ver.keyModel) cfg.keyModel = ver.keyModel;
    await Sync._maybeLockOnOrgChange(cfg);
    await Sync.setConfig(cfg);

    // Best-effort device posture submit (server policy may enforce this for API calls)
    try{ await Sync.submitPosture(); }catch(_){ /* ignore */ }

    // Ensure server has the auth+enc pubkeys (for re-auth + DEK wraps)
    try{
      await Sync._api("/.netlify/functions/sync-user-keys-update", {auth:true, body:{ encPubKeyJwk, authPubKeyJwk }});
      cfg.encKeyReady = true;
      cfg.authKeyReady = true;
      await Sync.setConfig(cfg);
    }catch(_){ /* ignore */ }

// Refresh org info to get keyModel + dekReady + authoritative epoch/tv
    try{
      const info = await Sync._api("/.netlify/functions/sync-org-info", {auth:true, body:{}});
      cfg.role = info.role || cfg.role;
      cfg.keyModel = info.keyModel || cfg.keyModel || "";
      cfg.orgEpoch = Number(info.orgEpoch || cfg.orgEpoch || 1);
      cfg.tokenVersion = Number(info.tokenVersion || cfg.tokenVersion || 1);
      cfg.encKeyReady = !!info.encKeyReady;
      cfg.authKeyReady = !!info.authKeyReady;
      cfg.dekReady = !!info.dekReady;
      if(info.policy) cfg.policy = info.policy;
      await Sync._maybeLockOnOrgChange(cfg);
      await Sync.setConfig(cfg);
    }catch(_){ /* ignore */ }

    return true;
  };

  // ---------- Key model helpers ----------
  Sync.unlockLegacy = async (passphrase) => {
    await Sync.ensureToken();
    const cfg = await Sync.getConfig();
    if(String(cfg.keyModel||"") !== "passphrase-v1") throw new Error("not-legacy");
    if(!cfg.orgSaltB64) throw new Error("sync-missing-org-salt");
    const key = await deriveKey(passphrase, cfg.orgSaltB64, Number(cfg.orgKdfIterations || 250000));
    Sync._legacyKey = key;
    Sync._legacyMeta = { saltB64: cfg.orgSaltB64, epoch: Number(cfg.orgEpoch||1) };
    return true;
  };

  Sync.ensureDEK = async () => {
    await Sync.ensureToken();
    const cfg = await Sync.getConfig();
    const km = String(cfg.keyModel||"");
    if(km !== "wrapped-dek-v1" && km !== "wrapped-epoch-vault-v1") throw new Error("org-legacy-keymodel");

    const epoch = Number(cfg.orgEpoch||1);
    if(Sync._dekKey && Sync._dekMeta && Number(Sync._dekMeta.epoch||0) === epoch) return true;

    if(!navigator.onLine) throw new Error("sync-offline");

    try{
      const out = await Sync._api("/.netlify/functions/sync-dek-get", {auth:true, body:{}});
      const wrap = out.wrap;
      const myEnc = await getOrCreateEncKeypair();
      const dek = await unwrapDEK(myEnc.privKey, wrap);
      Sync._dekKey = dek;
      Sync._dekMeta = { epoch };
      const cfg2 = await Sync.getConfig();
      cfg2.dekReady = true;
      await Sync.setConfig(cfg2);
      return true;
    }catch(err){
      if(err && err.status === 409 && err.message === 'dek-not-granted'){
        const cfg2 = await Sync.getConfig();
        cfg2.dekReady = false;
        await Sync.setConfig(cfg2);
        throw new Error("sync-key-pending");
      }
      if(err && err.status === 409 && err.message === 'org-legacy-keymodel'){
        throw new Error("org-legacy-keymodel");
      }
      if(err && err.status === 401 && err.message === 'token-stale'){
        const cfg2 = await Sync.getConfig();
        cfg2.token = "";
        await Sync.setConfig(cfg2);
        await Sync.ensureToken();
        return Sync.ensureDEK();
      }
      throw err;
    }
  };

  Sync.ensureKey = async () => {
    await Sync.ensureToken();
    const cfg = await Sync.getConfig();
    const km = String(cfg.keyModel||"");
    if(km === "passphrase-v1"){
      if(!Sync._legacyKey) throw new Error("sync-locked");
      // lock if org rotated
      const meta = Sync._legacyMeta || {};
      const sameSalt = String(meta.saltB64||"") === String(cfg.orgSaltB64||"");
      const sameEpoch = Number(meta.epoch||0) === Number(cfg.orgEpoch||0);
      if(!sameSalt || !sameEpoch) { Sync._legacyKey = null; Sync._legacyMeta = null; throw new Error("sync-rekey-required"); }
      return true;
    }
    return Sync.ensureDEK();
  };


function _usesVaultKeys(cfg){
  return String(cfg.keyModel||"") === "wrapped-epoch-vault-v1";
}

Sync._vaultWrapKey = (vaultKey, epoch) => VAULTKEY_WRAP_PREFIX + String(epoch) + "::" + String(vaultKey||"");

Sync.getVaultKeyInfo = (vaultKey) => {
  const c = Sync._vaultKeyCache && Sync._vaultKeyCache.get ? Sync._vaultKeyCache.get(vaultKey) : null;
  return c ? Object.assign({}, c) : null;
};

Sync._createVaultKey = async (vaultKey, epoch) => {
  if(!Sync._dekKey) throw new Error("sync-locked");
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
  const wrap = await encryptU8(raw, Sync._dekKey);

  const putOut = await Sync._api("/.netlify/functions/sync-vaultkey-put", {
    auth:true,
    body:{ vaultKey, epoch, wrap, restricted:false }
  });

  const keyRev = Number((putOut && (putOut.keyRev || putOut.vaultKeyRev)) || 1);
  const wrapRec = { epoch, keyRev, wrap, restricted:false, perm:"editor", cachedAt: new Date().toISOString() };
  await idbPut(Sync._vaultWrapKey(vaultKey, epoch), wrapRec);
  Sync._vaultKeyCache.set(vaultKey, { key, raw, epoch, keyRev, restricted:false, perm:"editor" });
  return key;
};

Sync.ensureVaultKey = async (vaultKey, opts) => {
  await Sync.ensureToken();
  const cfg = await Sync.getConfig();
  if(!_usesVaultKeys(cfg)) return null;

  await Sync.ensureDEK(); // epoch key

  const epoch = Number(cfg.orgEpoch||1);
  const forceRefresh = !!(opts && opts.forceRefresh);
  const minKeyRev = Number((opts && opts.minKeyRev) || 0);

  const cached = Sync._vaultKeyCache.get(vaultKey);
  if(!forceRefresh && cached && cached.key && Number(cached.epoch||0) === epoch){
    const cRev = Number(cached.keyRev||1);
    if(!minKeyRev || cRev >= minKeyRev) return cached.key;
  }

  const wrapKey = Sync._vaultWrapKey(vaultKey, epoch);
  let wrapRec = null;
  if(!forceRefresh){
    try{ wrapRec = await idbGet(wrapKey); }catch(_){ wrapRec = null; }
  }

  if(!wrapRec || (minKeyRev && Number(wrapRec.keyRev||1) < minKeyRev)){
    if(!navigator.onLine){
      throw new Error("sync-offline-vaultkey");
    }
    try{
      const out = await Sync._api("/.netlify/functions/sync-vaultkey-get", {auth:true, body:{ vaultKey }});
      wrapRec = { epoch: Number(out.epoch||epoch), keyRev: Number(out.keyRev||1), wrap: out.wrap, restricted: !!out.restricted, perm: out.perm || "viewer", cachedAt: new Date().toISOString() };
      await idbPut(wrapKey, wrapRec);
    }catch(err){
      if(err && err.status === 404 && err.message === 'vaultkey-not-found'){
        const auto = !!(opts && opts.autoCreate);
        const canCreate = (cfg.role === 'owner' || cfg.role === 'admin' || cfg.role === 'editor');
        if(auto && canCreate) return Sync._createVaultKey(vaultKey, epoch);
      }
      throw err;
    }
  }

  const raw = await decryptU8(wrapRec.wrap, Sync._dekKey);
  const key = await crypto.subtle.importKey("raw", raw, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
  Sync._vaultKeyCache.set(vaultKey, { key, raw, epoch: Number(wrapRec.epoch||epoch), keyRev: Number(wrapRec.keyRev||1), restricted: !!wrapRec.restricted, perm: wrapRec.perm||"viewer" });
  return key;
};

Sync.rotateVaultKey = async (vaultKey) => {
  await Sync.ensureToken();
  const cfg = await Sync.getConfig();
  if(!_usesVaultKeys(cfg)) throw new Error("org-not-vaultkeys");
  if(cfg.role !== 'owner' && cfg.role !== 'admin') throw new Error("owner-or-admin-required");
  if(!navigator.onLine) throw new Error("sync-offline");

  await Sync.ensureDEK();
  const epoch = Number(cfg.orgEpoch||1);

  // Pull latest before rotating (best effort).
  try{ await Sync.pullVault(vaultKey); }catch(_){ /* ignore */ }

  const rec = await idbGet(vaultKey);
  if(!rec) throw new Error("vault-empty");

  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
  const wrap = await encryptU8(raw, Sync._dekKey);

  const putOut = await Sync._api("/.netlify/functions/sync-vaultkey-put", {
    auth:true,
    body:{ vaultKey, epoch, wrap, rotate:true }
  });

  const keyRev = Number((putOut && (putOut.keyRev || putOut.vaultKeyRev)) || 2);

  const prev = Sync.getVaultKeyInfo(vaultKey) || {};
  const restricted = (typeof prev.restricted === 'boolean') ? prev.restricted : false;
  const perm = prev.perm || "editor";

  await idbPut(Sync._vaultWrapKey(vaultKey, epoch), { epoch, keyRev, wrap, restricted, perm, cachedAt: new Date().toISOString() });
  Sync._vaultKeyCache.set(vaultKey, { key, raw, epoch, keyRev, restricted, perm });

  // Limited scope: re-encrypt only this vault under the new VDEK.
  await Sync.pushVault(vaultKey, { force:true });

  return { ok:true, vaultKey, epoch, keyRev };
};

  // ---------- Org lifecycle ----------
  Sync.createOrg = async (orgName, userName) => {
    const auth = await genAuthKeypairFresh();
    const enc = await genEncKeypairFresh();

    const out = await Sync._api("/.netlify/functions/sync-register-org", {
      auth:false,
      body:{
        orgName:String(orgName||"").trim().slice(0,80),
        userName:String(userName||"").trim().slice(0,80),
        authPubKeyJwk: auth.pubJwk,
        encPubKeyJwk: enc.pubJwk,
        deviceId: await Sync.getDeviceId()
      }
    });

    const cfg = await Sync.getConfig();
    cfg.enabled = true;
    cfg.orgId = out.orgId;
    cfg.userId = out.userId;
    cfg.role = out.role;
    cfg.token = out.token;
    cfg.keyModel = out.keyModel || "wrapped-dek-v1";
    cfg.orgSaltB64 = out.orgSaltB64 || "";
    cfg.orgKdfIterations = out.orgKdfIterations || 250000;
    cfg.orgEpoch = Number(out.orgEpoch || 1);
    cfg.tokenVersion = Number(out.tokenVersion || 1);
    cfg.encKeyReady = true;
    cfg.dekReady = false;
    await Sync.setConfig(cfg);

    if(cfg.keyModel === "wrapped-dek-v1" || cfg.keyModel === "wrapped-epoch-vault-v1"){
      await Sync.bootstrapOrgDEK();
    }
    return out;
  };

  Sync.joinWithInvite = async (inviteCode, userName) => {
    const auth = await genAuthKeypairFresh();
    const enc = await genEncKeypairFresh();

    const out = await Sync._api("/.netlify/functions/sync-invite-claim", {
      auth:false,
      body:{
        inviteCode:String(inviteCode||"").trim(),
        userName:String(userName||"").trim().slice(0,80),
        authPubKeyJwk: auth.pubJwk,
        encPubKeyJwk: enc.pubJwk,
        deviceId: await Sync.getDeviceId()
      }
    });

    const cfg = await Sync.getConfig();
    cfg.enabled = true;
    cfg.orgId = out.orgId;
    cfg.userId = out.userId;
    cfg.role = out.role;
    cfg.token = out.token;
    cfg.keyModel = out.keyModel || cfg.keyModel || "";
    cfg.orgSaltB64 = out.orgSaltB64 || "";
    cfg.orgKdfIterations = out.orgKdfIterations || 250000;
    cfg.orgEpoch = Number(out.orgEpoch || 1);
    cfg.tokenVersion = Number(out.tokenVersion || 1);
    cfg.encKeyReady = true;
    cfg.dekReady = false;
    await Sync.setConfig(cfg);

    try{ await Sync.ensureToken(); }catch(_){ /* ignore */ }
    return out;
  };

  Sync.bootstrapOrgDEK = async () => {
    await Sync.ensureToken();
    const cfg = await Sync.getConfig();
    if(cfg.role !== 'owner') return false;
    const km = String(cfg.keyModel||"");
    if(km !== "wrapped-dek-v1" && km !== "wrapped-epoch-vault-v1") return false;

    // If already granted, just unlock it.
    try{
      await Sync.ensureDEK();
      return true;
    }catch(err){
      if(String(err?.message||'') !== 'sync-key-pending') throw err;
    }

    const epoch = Number(cfg.orgEpoch||1);
    const dekKey = await crypto.subtle.generateKey({name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
    const myEnc = await getOrCreateEncKeypair();
    const wrap = await wrapDEKForMember(myEnc.pubJwk, dekKey);

    await Sync._api("/.netlify/functions/sync-dek-wrap-put", {
      auth:true,
      body:{ epoch, wrappings: [ { userId: cfg.userId, wrap } ] }
    });

    Sync._dekKey = dekKey;
    Sync._dekMeta = { epoch };
    cfg.dekReady = true;
    await Sync.setConfig(cfg);
    return true;
  };

  Sync.migrateOrgToWrappedDEK = async (legacyPassphrase) => {
    await Sync.ensureToken();
    const cfg0 = await Sync.getConfig();
    if(cfg0.role !== 'owner') throw new Error('owner-required');
    if(String(cfg0.keyModel||"") === 'wrapped-dek-v1') return { ok:true, already:true };

    // Need legacy key to pull latest
    if(!Sync._legacyKey){
      if(!legacyPassphrase) throw new Error('passphrase-required');
      await Sync.unlockLegacy(legacyPassphrase);
    }

    const keys = ["skyenote_vault","skyecash_ledger","skyefocus_log"];
    for(const k of keys){
      try{ await Sync.pullVault(k); }catch(_){ /* ignore */ }
    }

    const out = await Sync._api("/.netlify/functions/sync-org-migrate-to-dek", {auth:true, body:{}});

    const cfg = await Sync.getConfig();
    cfg.keyModel = out.keyModel || 'wrapped-dek-v1';
    cfg.orgSaltB64 = out.orgSaltB64 || cfg.orgSaltB64;
    cfg.orgKdfIterations = out.orgKdfIterations || cfg.orgKdfIterations;
    cfg.orgEpoch = Number(out.orgEpoch || cfg.orgEpoch || 1);
    cfg.tokenVersion = Number(out.tokenVersion || cfg.tokenVersion || 1);
    cfg.token = ""; // force re-auth
    cfg.dekReady = false;
    await Sync.setConfig(cfg);
    Sync.lock();

    await Sync.ensureToken();

    // New DEK for the new epoch
    const epoch = Number((await Sync.getConfig()).orgEpoch||1);
    const dekKey = await crypto.subtle.generateKey({name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
    Sync._dekKey = dekKey;
    Sync._dekMeta = { epoch };

    // Wrap DEK to active members that have enc keys (owner/admin only list will include keys)
    const members = await Sync.listMembers();
    const targets = (members?.members||[]).filter(m=>m.status === 'active' && m.encPubKeyJwk);
    const wrappings = [];
    for(const m of targets){
      try{
        const wrap = await wrapDEKForMember(m.encPubKeyJwk, dekKey);
        wrappings.push({ userId: m.id, wrap });
      }catch(_){ /* ignore */ }
    }

    await Sync._api("/.netlify/functions/sync-dek-wrap-put", {auth:true, body:{ epoch, wrappings }});

    // Re-encrypt + push vaults under new model/epoch
    for(const k of keys){
      try{
        const m = await Sync.getVaultMeta(k);
        await Sync.pushVault(k, { force: true });
        m.dirty = false; m.conflict = false;
        await Sync.setVaultMeta(k, m);
      }catch(_){ /* ignore */ }
    }

    const cfg2 = await Sync.getConfig();
    cfg2.dekReady = true;
    await Sync.setConfig(cfg2);
    return out;
  };

  Sync.refreshOrgInfo = async () => {
    await Sync.ensureToken();
    const info = await Sync._api("/.netlify/functions/sync-org-info", {auth:true, body:{}});
    const cfg = await Sync.getConfig();
    cfg.role = info.role || cfg.role;
    cfg.keyModel = info.keyModel || cfg.keyModel || "";
    cfg.orgSaltB64 = info.orgSaltB64 || cfg.orgSaltB64;
    cfg.orgKdfIterations = info.orgKdfIterations || cfg.orgKdfIterations;
    cfg.orgEpoch = Number(info.orgEpoch || cfg.orgEpoch || 1);
    cfg.tokenVersion = Number(info.tokenVersion || cfg.tokenVersion || 1);
    cfg.encKeyReady = !!info.encKeyReady;
    cfg.dekReady = !!info.dekReady;
    await Sync._maybeLockOnOrgChange(cfg);
    await Sync.setConfig(cfg);
    return cfg;
  };

  // ---------- Team ops ----------
  Sync.createInvite = async (role, expiresHours) => {
    await Sync.ensureToken();
    const out = await Sync._api("/.netlify/functions/sync-invite-create", {
      auth:true,
      body:{ role:String(role||"viewer"), expiresHours: Number(expiresHours||72) }
    });
    return out;
  };

  Sync.listMembers = async () => {
    await Sync.ensureToken();
    return Sync._api("/.netlify/functions/sync-members", {auth:true, body:{}});
  };

  Sync.setMemberRole = async (targetUserId, role) => {
    await Sync.ensureToken();
    return Sync._api("/.netlify/functions/sync-members-set-role", {auth:true, body:{ targetUserId, role }});
  };

  Sync.setMemberStatus = async (targetUserId, status) => {
    await Sync.ensureToken();
    return Sync._api("/.netlify/functions/sync-members-set-status", {auth:true, body:{ targetUserId, status }});
  };

  Sync.grantMemberKey = async (targetUserId) => {
    await Sync.ensureToken();
    const cfg = await Sync.getConfig();
    const km = String(cfg.keyModel||"");
    if(km !== "wrapped-dek-v1" && km !== "wrapped-epoch-vault-v1") throw new Error("org-legacy-keymodel");
    if(cfg.role !== 'owner' && cfg.role !== 'admin') throw new Error("forbidden");
    await Sync.ensureDEK();

    const epoch = Number(cfg.orgEpoch||1);
    const list = await Sync.listMembers();
    const mem = (list?.members||[]).find(m=>String(m.id) === String(targetUserId));
    if(!mem) throw new Error("user-not-found");
    if(mem.status !== 'active') throw new Error("user-not-active");
    if(!mem.encPubKeyJwk) throw new Error("user-missing-enc-key");

    const wrap = await wrapDEKForMember(mem.encPubKeyJwk, Sync._dekKey);

    await Sync._api("/.netlify/functions/sync-dek-wrap-put", {
      auth:true,
      body:{ epoch, wrappings: [ { userId: targetUserId, wrap } ] }
    });

    return { ok:true };
  };

  // ---------- Enterprise policy + audit + exports ----------
  Sync.getPolicy = async () => {
    await Sync.ensureToken();
    return Sync._api("/.netlify/functions/sync-policy-get", { auth:true, body:{} });
  };

  Sync.setPolicy = async (policy) => {
    await Sync.ensureToken();
    const out = await Sync._api("/.netlify/functions/sync-policy-set", { auth:true, body:{ policy: policy || {} } });
    // Policy set bumps tokenVersion -> force re-auth on this device.
    const cfg = await Sync.getConfig();
    cfg.tokenVersion = Number(out.tokenVersion || cfg.tokenVersion || 1);
    cfg.token = "";
    await Sync.setConfig(cfg);
    Sync.lock();
    return out;
  };

  Sync.listAudit = async ({ beforeId=0, limit=100, actionPrefix="", verifyChain=false }={}) => {
    await Sync.ensureToken();
    return Sync._api("/.netlify/functions/sync-audit-list", { auth:true, body:{ beforeId, limit, actionPrefix, verifyChain } });
  };

  Sync.exportOrg = async () => {
    await Sync.ensureToken();
    return Sync._api("/.netlify/functions/sync-org-export", { auth:true, body:{} });
  };


Sync.upgradeOrgToPerVaultKeys = async () => {
  await Sync.ensureToken();
  const cfg0 = await Sync.getConfig();
  if(cfg0.role !== 'owner') throw new Error('owner-required');

  const km0 = String(cfg0.keyModel||"");
  if(km0 === "wrapped-epoch-vault-v1") return { ok:true, already:true };
  if(km0 !== "wrapped-dek-v1") throw new Error("org-legacy-keymodel");

  await Sync.ensureDEK(); // org DEK (will become epoch key for v6)

  const keys = ["skyenote_vault","skyecash_ledger","skyefocus_log"];
  for(const k of keys){
    try{ await Sync.pullVault(k); }catch(_){ /* ignore */ }
  }

  const cfg = await Sync.getConfig();
  const orgId = cfg.orgId;
  const orgEpoch = Number(cfg.orgEpoch||1);

  for(const vk of keys){
    const rec = await idbGet(vk);
    if(!rec) continue;

    const raw = crypto.getRandomValues(new Uint8Array(32));
    const vKey = await crypto.subtle.importKey("raw", raw, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);

    const wrap = await encryptU8(raw, Sync._dekKey);
    const putOut = await Sync._api("/.netlify/functions/sync-vaultkey-put", {auth:true, body:{ vaultKey: vk, epoch: orgEpoch, wrap, restricted:false }});
    const keyRev = Number((putOut && (putOut.keyRev || putOut.vaultKeyRev)) || 1);
    await idbPut(Sync._vaultWrapKey(vk, orgEpoch), { epoch: orgEpoch, keyRev, wrap, restricted:false, perm:"editor", cachedAt: new Date().toISOString() });

    const cipher = await encryptJSON(rec, vKey);
    const env = { format:"skye-sync-envelope/v4", orgId, orgEpoch, vaultKey: vk, vaultKeyRev: keyRev, createdAt: new Date().toISOString(), cipher };
    const ciphertextB64 = u8ToB64(new TextEncoder().encode(JSON.stringify(env)));

    const meta = await Sync.getVaultMeta(vk);
    const baseRev = Number(meta.remoteRev || 0);

    const out = await Sync._api("/.netlify/functions/sync-vault-push", {
      auth:true,
      body:{ vaultKey: vk, baseRev, orgEpoch, ciphertextB64, meta:{ updatedAt: rec.updatedAt || null, localEncrypted: !!rec.encrypted, vaultFormat: rec.format || null, vaultKeyRev: keyRev } }
    });

    meta.remoteRev = Number(out.rev || (baseRev + 1));
    meta.dirty = false;
    meta.conflict = false;
    meta.lastPushAt = new Date().toISOString();
    await Sync.setVaultMeta(vk, meta);
  }

  const out2 = await Sync._api("/.netlify/functions/sync-org-upgrade-to-vaultkeys", {auth:true, body:{}});
  const cfg2 = await Sync.getConfig();
  cfg2.keyModel = out2.keyModel || "wrapped-epoch-vault-v1";
  cfg2.tokenVersion = Number(out2.tokenVersion || cfg2.tokenVersion || 1);
  cfg2.token = "";
  await Sync.setConfig(cfg2);
  Sync.lock();
  await Sync.ensureToken();
  return { ok:true };
};


Sync.rotateOrgKey = async () => {
  await Sync.ensureToken();
  const cfg0 = await Sync.getConfig();
  if(cfg0.role !== 'owner') throw new Error('owner-required');

  const km0 = String(cfg0.keyModel||"");
  if(km0 === "passphrase-v1") throw new Error("org-legacy-keymodel");

  if(km0 === "wrapped-epoch-vault-v1"){
    await Sync.ensureDEK(); // current epoch key

    const keys = ["skyenote_vault","skyecash_ledger","skyefocus_log"];
    const vaultRaw = {};

    for(const k of keys){
      try{
        await Sync.ensureVaultKey(k, { autoCreate:true });
        const info = Sync.getVaultKeyInfo(k);
        if(info && info.raw) vaultRaw[k] = info.raw;
      }catch(_){ /* ignore */ }
    }

    const out = await Sync._api("/.netlify/functions/sync-org-rotate-key", {auth:true, body:{}});

    const cfg = await Sync.getConfig();
    cfg.keyModel = out.keyModel || cfg.keyModel;
    cfg.orgSaltB64 = out.orgSaltB64 || cfg.orgSaltB64;
    cfg.orgKdfIterations = out.orgKdfIterations || cfg.orgKdfIterations;
    cfg.orgEpoch = Number(out.orgEpoch || cfg.orgEpoch || 1);
    cfg.tokenVersion = Number(out.tokenVersion || cfg.tokenVersion || 1);
    cfg.token = "";
    cfg.dekReady = false;
    await Sync.setConfig(cfg);
    Sync.lock();

    await Sync.ensureToken();

    const epoch = Number((await Sync.getConfig()).orgEpoch||1);
    const epochKey = await crypto.subtle.generateKey({name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
    Sync._dekKey = epochKey;
    Sync._dekMeta = { epoch };

    const members = await Sync.listMembers();
    const targets = (members?.members||[]).filter(m=>m.status === 'active' && m.encPubKeyJwk);
    const wrappings = [];
    for(const m of targets){
      try{
        const wrap = await wrapDEKForMember(m.encPubKeyJwk, epochKey);
        wrappings.push({ userId: m.id, wrap });
      }catch(_){ /* ignore */ }
    }

    await Sync._api("/.netlify/functions/sync-dek-wrap-put", {auth:true, body:{ epoch, wrappings }});

    for(const k of keys){
      try{
        const raw = vaultRaw[k];
        if(!raw) continue;
        const wrap = await encryptU8(raw, epochKey);
        const putOut = await Sync._api("/.netlify/functions/sync-vaultkey-put", {auth:true, body:{ vaultKey: k, epoch, wrap }});
        const keyRev = Number((putOut && (putOut.keyRev || putOut.vaultKeyRev)) || (Sync.getVaultKeyInfo(k)?.keyRev||1));
        await idbPut(Sync._vaultWrapKey(k, epoch), { epoch, keyRev, wrap, restricted:false, perm:"editor", cachedAt: new Date().toISOString() });
      }catch(_){ /* ignore */ }
    }

    const cfg2 = await Sync.getConfig();
    cfg2.dekReady = true;
    await Sync.setConfig(cfg2);
    return out;
  }

  if(km0 === "wrapped-dek-v1"){
    await Sync.ensureDEK();

    const keys = ["skyenote_vault","skyecash_ledger","skyefocus_log"];
    for(const k of keys){
      try{ await Sync.pullVault(k); }catch(_){ /* ignore */ }
    }

    const out = await Sync._api("/.netlify/functions/sync-org-rotate-key", {auth:true, body:{}});

    const cfg = await Sync.getConfig();
    cfg.keyModel = out.keyModel || cfg.keyModel;
    cfg.orgSaltB64 = out.orgSaltB64 || cfg.orgSaltB64;
    cfg.orgKdfIterations = out.orgKdfIterations || cfg.orgKdfIterations;
    cfg.orgEpoch = Number(out.orgEpoch || cfg.orgEpoch || 1);
    cfg.tokenVersion = Number(out.tokenVersion || cfg.tokenVersion || 1);
    cfg.token = "";
    cfg.dekReady = false;
    await Sync.setConfig(cfg);
    Sync.lock();

    await Sync.ensureToken();

    const epoch = Number((await Sync.getConfig()).orgEpoch||1);
    const dekKey = await crypto.subtle.generateKey({name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
    Sync._dekKey = dekKey;
    Sync._dekMeta = { epoch };

    const members = await Sync.listMembers();
    const targets = (members?.members||[]).filter(m=>m.status === 'active' && m.encPubKeyJwk);
    const wrappings = [];
    for(const m of targets){
      try{
        const wrap = await wrapDEKForMember(m.encPubKeyJwk, dekKey);
        wrappings.push({ userId: m.id, wrap });
      }catch(_){ /* ignore */ }
    }

    await Sync._api("/.netlify/functions/sync-dek-wrap-put", {auth:true, body:{ epoch, wrappings }});

    for(const k of keys){
      try{
        const m = await Sync.getVaultMeta(k);
        await Sync.pushVault(k, { force: true });
        m.dirty = false;
        m.conflict = false;
        await Sync.setVaultMeta(k, m);
      }catch(_){ /* ignore */ }
    }

    const cfg2 = await Sync.getConfig();
    cfg2.dekReady = true;
    await Sync.setConfig(cfg2);
    return out;
  }

  throw new Error("org-legacy-keymodel");
};

  Sync.getVaultMeta = async (vaultKey) => {
    const meta = await idbGet(Sync._vaultMetaKey(vaultKey));
    return Object.assign({ remoteRev: 0, dirty:false, lastLocalChangeAt:null, lastPushAt:null, lastPullAt:null, conflict:false }, meta || {});
  };

  Sync.setVaultMeta = async (vaultKey, meta) => {
    const next = Object.assign({ remoteRev: 0, dirty:false, lastLocalChangeAt:null, lastPushAt:null, lastPullAt:null, conflict:false }, meta || {});
    await idbPut(Sync._vaultMetaKey(vaultKey), next);
    return next;
  };

  Sync.markDirty = async (vaultKey) => {
    try{
      const cfg = await Sync.getConfig();
      if(!cfg.enabled) return;
      const m = await Sync.getVaultMeta(vaultKey);
      m.dirty = true;
      m.lastLocalChangeAt = new Date().toISOString();
      await Sync.setVaultMeta(vaultKey, m);
    }catch(_){/* ignore */}
  };


Sync._encryptEnvelopeB64 = async (plainObj, vaultKey) => {
  const cfg = await Sync.getConfig();
  await Sync.ensureKey();

  const km = String(cfg.keyModel||"");
  let env = null;

  if(km === "passphrase-v1"){
    const key = Sync._legacyKey;
    if(!key) throw new Error("sync-locked");
    const cipher = await encryptJSON(plainObj, key);
    env = {
      format: "skye-sync-envelope/v2",
      orgId: cfg.orgId,
      orgEpoch: Number(cfg.orgEpoch||1),
      createdAt: new Date().toISOString(),
      kdf: { saltB64: cfg.orgSaltB64, iterations: Number(cfg.orgKdfIterations||250000), hash: "SHA-256" },
      cipher
    };
  }else if(km === "wrapped-dek-v1"){
    const key = Sync._dekKey;
    if(!key) throw new Error("sync-locked");
    const cipher = await encryptJSON(plainObj, key);
    env = {
      format: "skye-sync-envelope/v3",
      orgId: cfg.orgId,
      orgEpoch: Number(cfg.orgEpoch||1),
      createdAt: new Date().toISOString(),
      cipher
    };
  }else if(km === "wrapped-epoch-vault-v1"){
    const vk = String(vaultKey||"").trim();
    if(!vk) throw new Error("vaultKey-required");
    const vKey = await Sync.ensureVaultKey(vk, { autoCreate:true });
    if(!vKey) throw new Error("sync-locked");
    const cipher = await encryptJSON(plainObj, vKey);
    env = {
      format: "skye-sync-envelope/v4",
      orgId: cfg.orgId,
      orgEpoch: Number(cfg.orgEpoch||1),
      vaultKey: vk,
      vaultKeyRev: Number((Sync.getVaultKeyInfo(vk)?.keyRev)||1),
      createdAt: new Date().toISOString(),
      cipher
    };
  }else{
    const key = Sync._dekKey || Sync._legacyKey;
    if(!key) throw new Error("sync-locked");
    const cipher = await encryptJSON(plainObj, key);
    env = { format:"skye-sync-envelope/v3", orgId: cfg.orgId, orgEpoch: Number(cfg.orgEpoch||1), createdAt: new Date().toISOString(), cipher };
  }

  const u8 = new TextEncoder().encode(JSON.stringify(env));
  return u8ToB64(u8);
};

Sync._decryptEnvelopeB64 = async (ciphertextB64, vaultKeyHint) => {
  const cfg = await Sync.getConfig();
  await Sync.ensureKey();

  const u8 = b64ToU8(ciphertextB64);
  const env = JSON.parse(new TextDecoder().decode(u8));
  if(!env || !env.cipher) throw new Error("sync-bad-envelope");

  const fmt = String(env.format||"");
  if(fmt === "skye-sync-envelope/v2"){
    const key = Sync._legacyKey;
    if(!key) throw new Error("sync-locked");
    return decryptJSON(env.cipher, key);
  }

  if(fmt === "skye-sync-envelope/v3"){
    const key = Sync._dekKey;
    if(!key) throw new Error("sync-locked");
    return decryptJSON(env.cipher, key);
  }

  if(fmt === "skye-sync-envelope/v4"){
const vk = String(env.vaultKey || vaultKeyHint || "").trim();
if(!vk) throw new Error("vaultKey-required");
const wantRev = Number(env.vaultKeyRev || 1);

let vKey = await Sync.ensureVaultKey(vk, { autoCreate:false, minKeyRev: wantRev });
if(!vKey) throw new Error("sync-locked");

try{
  return await decryptJSON(env.cipher, vKey);
}catch(e){
  // Vault key rotated (or cache stale): try one forced refresh.
  if(!navigator.onLine) throw e;
  vKey = await Sync.ensureVaultKey(vk, { autoCreate:false, forceRefresh:true, minKeyRev: wantRev });
  return await decryptJSON(env.cipher, vKey);
}
  }

  const km = String(cfg.keyModel||"");
  const key = (km === "passphrase-v1") ? Sync._legacyKey : Sync._dekKey;
  if(!key) throw new Error("sync-locked");
  return decryptJSON(env.cipher, key);
};

  // --- CRDT merge helpers (unchanged) ---
  function _parseTs(s){
    const t = Date.parse(String(s||""));
    return Number.isFinite(t) ? t : 0;
  }

  function _stamp(ts, dev){
    return { t: _parseTs(ts), d: String(dev||"") };
  }

  function _cmpStamp(a, b){
    if(a.t !== b.t) return a.t - b.t;
    if(a.d === b.d) return 0;
    return a.d < b.d ? -1 : 1;
  }

  function _pickNewer(aItem, bItem, getStamp){
    if(aItem && !bItem) return aItem;
    if(!aItem && bItem) return bItem;
    if(!aItem && !bItem) return null;
    const as = getStamp(aItem);
    const bs = getStamp(bItem);
    return (_cmpStamp(as, bs) >= 0) ? aItem : bItem;
  }

  function _mergeById(aList, bList, getId, getStamp){
    const map = new Map();
    (Array.isArray(aList)?aList:[]).forEach(it=>{ map.set(getId(it), it); });
    (Array.isArray(bList)?bList:[]).forEach(it=>{
      const id = getId(it);
      const cur = map.get(id);
      map.set(id, _pickNewer(cur, it, getStamp));
    });
    return Array.from(map.values()).filter(Boolean);
  }

  function _noteStamp(n){
    const eff = n.deletedAt || n.updatedAt || n.createdAt;
    const dev = n.deletedByDevice || n.updatedByDevice || n.createdByDevice;
    return _stamp(eff, dev);
  }

  function _txStamp(x){
    const eff = x.deletedAt || x.updatedAt || x.createdAt || x.date;
    const dev = x.deletedByDevice || x.updatedByDevice || x.createdByDevice;
    return _stamp(eff, dev);
  }

  function _sessStamp(s){
    const eff = s.deletedAt || s.updatedAt || s.endedAt || s.startedAt;
    const dev = s.deletedByDevice || s.updatedByDevice || s.createdByDevice;
    return _stamp(eff, dev);
  }

  function _projStamp(p){
    const eff = p.deletedAt || p.updatedAt || p.createdAt;
    const dev = p.deletedByDevice || p.updatedByDevice || p.createdByDevice;
    return _stamp(eff, dev);
  }

  function _mergeSkyeNote(a, b){
    const out = { schemaVersion: 2, selected: null, notes: [] };
    const notes = _mergeById(a?.notes, b?.notes, (n)=>String(n?.id||""), _noteStamp);
    out.notes = notes;
    const pickSel = (sel)=>notes.find(n=>n.id===sel && !n.deletedAt);
    const sa = pickSel(a?.selected);
    const sb = pickSel(b?.selected);
    const chosen = _pickNewer(sa, sb, _noteStamp);
    if(chosen) out.selected = chosen.id;
    else {
      const live = notes.filter(n=>!n.deletedAt);
      live.sort((x,y)=>_cmpStamp(_noteStamp(y), _noteStamp(x)));
      out.selected = live[0]?.id || null;
    }
    return out;
  }

  function _mergeSkyeCash(a, b){
    const out = { schemaVersion: 2, tx: [] };
    out.tx = _mergeById(a?.tx, b?.tx, (x)=>String(x?.id||""), _txStamp);
    return out;
  }

  function _mergeSkyeFocus(a, b){
    const out = { schemaVersion: 2 };

    const aMeta = a?._meta || {};
    const bMeta = b?._meta || {};
    const settingsStamp = (m)=>_stamp(m.settingsUpdatedAt, m.settingsUpdatedByDevice);
    const activeStamp = (m)=>_stamp(m.activeProjectUpdatedAt, m.activeProjectUpdatedByDevice);

    const pickSettingsFromA = _cmpStamp(settingsStamp(aMeta), settingsStamp(bMeta)) >= 0;
    out.settings = JSON.parse(JSON.stringify((pickSettingsFromA ? (a?.settings) : (b?.settings)) || {workMin:25, breakMin:5}));

    out.projects = _mergeById(a?.projects, b?.projects, (p)=>String(p?.id||""), _projStamp);
    if(!out.projects.length) out.projects = [{id:"p-default", name:"General"}];

    const pickActiveFromA = _cmpStamp(activeStamp(aMeta), activeStamp(bMeta)) >= 0;
    out.activeProjectId = String((pickActiveFromA ? (a?.activeProjectId) : (b?.activeProjectId)) || out.projects[0].id);
    if(!out.projects.find(p=>p.id===out.activeProjectId)) out.activeProjectId = out.projects[0].id;

    out.sessions = _mergeById(a?.sessions, b?.sessions, (s)=>String(s?.id||""), _sessStamp);

    out.timer = { mode:"work", running:false, endAt:null, remainingSec: (out.settings.workMin||25)*60, lastWorkStart:null };

    out._meta = {
      settingsUpdatedAt: (pickSettingsFromA ? aMeta.settingsUpdatedAt : bMeta.settingsUpdatedAt) || new Date().toISOString(),
      settingsUpdatedByDevice: (pickSettingsFromA ? aMeta.settingsUpdatedByDevice : bMeta.settingsUpdatedByDevice) || "",
      activeProjectUpdatedAt: (pickActiveFromA ? aMeta.activeProjectUpdatedAt : bMeta.activeProjectUpdatedAt) || new Date().toISOString(),
      activeProjectUpdatedByDevice: (pickActiveFromA ? aMeta.activeProjectUpdatedByDevice : bMeta.activeProjectUpdatedByDevice) || ""
    };

    return out;
  }

  async function _autoMergeRecord(vaultKey, localRec, remoteRec){
    if(!localRec || !remoteRec) return null;
    if(localRec.encrypted || remoteRec.encrypted) return null;
    if(!localRec.data || !remoteRec.data) return null;

    let mergedData = null;
    if(vaultKey === "skyenote_vault") mergedData = _mergeSkyeNote(localRec.data, remoteRec.data);
    else if(vaultKey === "skyecash_ledger") mergedData = _mergeSkyeCash(localRec.data, remoteRec.data);
    else if(vaultKey === "skyefocus_log") mergedData = _mergeSkyeFocus(localRec.data, remoteRec.data);
    else return null;

    const now = new Date().toISOString();
    return Object.assign({}, localRec, {
      format: "skye-mini-ops/v3",
      buildId: BUILD.buildId,
      schemaVersion: BUILD.schemaVersion,
      encrypted: false,
      data: mergedData,
      updatedAt: now
    });
  }

  Sync.pushVault = async (vaultKey, opts) => {
    await Sync.ensureToken();
    await Sync.ensureKey();
    const rec = await idbGet(vaultKey);
    if(!rec) return { ok:false, error:"vault-empty" };
    const meta = await Sync.getVaultMeta(vaultKey);
    const baseRev = Number(meta.remoteRev || 0);
    const force = !!(opts && opts.force);

    const ciphertextB64 = await Sync._encryptEnvelopeB64(rec, vaultKey);

const cfgNow = await Sync.getConfig();
const metaObj = { updatedAt: rec.updatedAt || null, localEncrypted: !!rec.encrypted, vaultFormat: rec.format || null };
try{
  if(_usesVaultKeys(cfgNow)){
    const info = Sync.getVaultKeyInfo(vaultKey);
    if(info && info.keyRev) metaObj.vaultKeyRev = Number(info.keyRev||1);
  }
}catch(_){ /* ignore */ }

    try{
      const out = await Sync._api("/.netlify/functions/sync-vault-push", {
        auth:true,
        body:{ vaultKey, baseRev: (force? baseRev : baseRev), orgEpoch: Number(cfgNow.orgEpoch||1), ciphertextB64, meta: metaObj }
      });
      meta.remoteRev = Number(out.rev || (baseRev + 1));
      meta.dirty = false;
      meta.conflict = false;
      meta.lastPushAt = new Date().toISOString();
      await Sync.setVaultMeta(vaultKey, meta);
      return { ok:true, rev: meta.remoteRev };
    }catch(e){
      if(e && e.status === 409 && e.message === 'org-epoch-mismatch'){
        const cfg = await Sync.getConfig();
        if(e.data && e.data.orgEpoch){
          cfg.orgEpoch = Number(e.data.orgEpoch || cfg.orgEpoch || 1);
          cfg.tokenVersion = Number(e.data.tokenVersion || cfg.tokenVersion || 1);
          await Sync.setConfig(cfg);
        }
        Sync.lock();
        throw new Error('sync-rekey-required');
      }

      // Vault key revision mismatch (per-vault key rotation safety).
      // Server requires the client to encrypt under the current vault key revision.
      if(e && e.status === 409 && (e.message === 'vaultkey-stale' || e.message === 'vaultkey-ahead')){
        try{
          const required = Number((e.data && e.data.requiredKeyRev) || 0);
          if(required > 0 && navigator.onLine){
            // Force refresh the wrapped vault key and retry once.
            await Sync.ensureVaultKey(vaultKey, { autoCreate:false, forceRefresh:true, minKeyRev: required });
            const rec2 = await idbGet(vaultKey);
            const cfg2 = await Sync.getConfig();
            const cipher2 = await Sync._encryptEnvelopeB64(rec2, vaultKey);
            const info2 = Sync.getVaultKeyInfo(vaultKey);
            const metaObjR = Object.assign({}, metaObj, { vaultKeyRev: Number((info2 && info2.keyRev) || required) });
            const outR = await Sync._api("/.netlify/functions/sync-vault-push", {
              auth:true,
              body:{ vaultKey, baseRev: baseRev, orgEpoch: Number(cfg2.orgEpoch||1), ciphertextB64: cipher2, meta: metaObjR }
            });
            meta.remoteRev = Number(outR.rev || (baseRev + 1));
            meta.dirty = false;
            meta.conflict = false;
            meta.lastPushAt = new Date().toISOString();
            await Sync.setVaultMeta(vaultKey, meta);
            return { ok:true, rev: meta.remoteRev, retried:true };
          }
        }catch(_){ /* fall through */ }
      }

      if(e && e.status === 409 && e.data && e.data.current){
        const cur = e.data.current;
        try{
          if(cur && cur.ciphertextB64){
            const remoteRec = await Sync._decryptEnvelopeB64(cur.ciphertextB64, vaultKey);
            const localRec = await idbGet(vaultKey);
            const mergedRec = await _autoMergeRecord(vaultKey, localRec, remoteRec);
            if(mergedRec){
              await idbPut(vaultKey, mergedRec);
              const mergedCipher = await Sync._encryptEnvelopeB64(mergedRec, vaultKey);
              const cfg = await Sync.getConfig();
const metaObj2 = { updatedAt: mergedRec.updatedAt || null, localEncrypted: !!mergedRec.encrypted, vaultFormat: mergedRec.format || null };
try{
  if(_usesVaultKeys(cfg)){
    const info = Sync.getVaultKeyInfo(vaultKey);
    if(info && info.keyRev) metaObj2.vaultKeyRev = Number(info.keyRev||1);
  }
}catch(_){ /* ignore */ }
              let out2 = null;
              try{
                out2 = await Sync._api("/.netlify/functions/sync-vault-push", {
                  auth:true,
                  body:{ vaultKey, baseRev: Number(cur.rev||0), orgEpoch: Number(cfg.orgEpoch||1), ciphertextB64: mergedCipher, meta: metaObj2 }
                });
              }catch(e2){
                if(e2 && e2.status === 409 && (e2.message === 'vaultkey-stale' || e2.message === 'vaultkey-ahead')){
                  const required = Number((e2.data && e2.data.requiredKeyRev) || 0);
                  if(required > 0 && navigator.onLine){
                    await Sync.ensureVaultKey(vaultKey, { autoCreate:false, forceRefresh:true, minKeyRev: required });
                    const infoR = Sync.getVaultKeyInfo(vaultKey);
                    metaObj2.vaultKeyRev = Number((infoR && infoR.keyRev) || required);
                    const mergedCipher2 = await Sync._encryptEnvelopeB64(mergedRec, vaultKey);
                    out2 = await Sync._api("/.netlify/functions/sync-vault-push", {
                      auth:true,
                      body:{ vaultKey, baseRev: Number(cur.rev||0), orgEpoch: Number(cfg.orgEpoch||1), ciphertextB64: mergedCipher2, meta: metaObj2 }
                    });
                  } else {
                    throw e2;
                  }
                } else {
                  throw e2;
                }
              }
              meta.remoteRev = Number(out2.rev || (Number(cur.rev||0)+1));
              meta.dirty = false;
              meta.conflict = false;
              meta.lastPushAt = new Date().toISOString();
              await Sync.setVaultMeta(vaultKey, meta);
              return { ok:true, merged:true, rev: meta.remoteRev };
            }
          }
        }catch(_){ /* fall through */ }

        meta.conflict = true;
        await Sync.setVaultMeta(vaultKey, meta);
        await idbPut(Sync._conflictKey(vaultKey), { vaultKey, at: new Date().toISOString(), remote: e.data.current });
        return { ok:false, conflict:true, current: e.data.current };
      }
      throw e;
    }
  };

  Sync.pullVault = async (vaultKey) => {
    await Sync.ensureToken();
    await Sync.ensureKey();
    const meta = await Sync.getVaultMeta(vaultKey);
    const sinceRev = Number(meta.remoteRev || 0);

    const out = await Sync._api("/.netlify/functions/sync-vault-pull", {
      auth:true,
      body:{ vaultKey, sinceRev }
    });

    if(out && out.orgEpoch){
      const cfg = await Sync.getConfig();
      cfg.orgEpoch = Number(out.orgEpoch || cfg.orgEpoch || 1);
      cfg.tokenVersion = Number(out.tokenVersion || cfg.tokenVersion || 1);
      await Sync._maybeLockOnOrgChange(cfg);
      await Sync.setConfig(cfg);
    }

    if(out.upToDate) return { ok:true, upToDate:true, rev: sinceRev };
    if(!out || !out.rev || !out.ciphertextB64) return { ok:false, error:"bad-pull" };

    const cfg = await Sync.getConfig();
    const epoch = Number(out.epoch || 1);
    if(epoch !== Number(cfg.orgEpoch||1)){
      meta.conflict = true;
      await Sync.setVaultMeta(vaultKey, meta);
      await idbPut(Sync._conflictKey(vaultKey), { vaultKey, at: new Date().toISOString(), remote: { rev: out.rev, epoch, ciphertextB64: out.ciphertextB64, meta: out.meta, updatedAt: out.updatedAt }, note: 'epoch-mismatch' });
      throw new Error('sync-epoch-mismatch-vault');
    }

    const rec = await Sync._decryptEnvelopeB64(out.ciphertextB64, vaultKey);
    await idbPut(vaultKey, rec);

    meta.remoteRev = Number(out.rev);
    meta.dirty = false;
    meta.conflict = false;
    meta.lastPullAt = new Date().toISOString();
    await Sync.setVaultMeta(vaultKey, meta);

    return { ok:true, upToDate:false, rev: meta.remoteRev };
  };

  Sync.syncVault = async (vaultKey) => {
    const meta = await Sync.getVaultMeta(vaultKey);
    if(meta.dirty){
      const r = await Sync.pushVault(vaultKey);
      if(r.conflict) return r;
      try { await Sync.pullVault(vaultKey); } catch(_) {}
      return r;
    }
    return Sync.pullVault(vaultKey);
  };

  // ---------- Signed update channel ----------
  async function importUpdatePubKeyJwk(jwk, usage){
    // Supports EC P-256 (local key) OR RSA (customer-managed HSM / KMS asymmetric key exported as JWK).
    if(jwk && jwk.kty === 'RSA'){
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
        true,
        usage
      );
      return { key, alg:'RSASSA-PKCS1_v1_5' };
    }
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name:'ECDSA', namedCurve:'P-256' },
      true,
      usage
    );
    return { key, alg:'ECDSA' };
  }

  async function sha256B64FromArrayBuffer(ab){
    const digest = await crypto.subtle.digest('SHA-256', ab);
    return u8ToB64(new Uint8Array(digest));
  }

  Sync.checkSignedUpdate = async () => {
    const cfg = await Sync.getConfig();
    if(!cfg.update?.enabled) return { ok:false, error:"updates-disabled" };

    const jsonUrl0 = await Sync._apiUrl(cfg.update.channelJson);
    const sigUrl0 = await Sync._apiUrl(cfg.update.channelSig);
    const bust = `cb=${Date.now()}`;
    const jsonUrl = jsonUrl0 + (jsonUrl0.includes('?') ? '&' : '?') + bust;
    const sigUrl = sigUrl0 + (sigUrl0.includes('?') ? '&' : '?') + bust;

    const [jRes, sRes] = await Promise.all([
      fetch(jsonUrl, { cache:'no-store' }),
      fetch(sigUrl, { cache:'no-store' })
    ]);
    if(!jRes.ok) return { ok:false, error:`update-json-${jRes.status}` };
    if(!sRes.ok) return { ok:false, error:`update-sig-${sRes.status}` };

    const jsonText = await jRes.text();
    const sigB64 = (await sRes.text()).trim();

    let manifest = null;
    try{ manifest = JSON.parse(jsonText); }catch(_){ return { ok:false, error:"update-json-bad" }; }

    let pubJwk = cfg.update.pubKeyJwk;
    if(!pubJwk){
      try{
        const pUrl = await Sync._apiUrl('/updates/public.jwk');
        const pRes = await fetch(pUrl, { cache:'no-store' });
        if(pRes.ok){
          pubJwk = await pRes.json();
          cfg.update.pubKeyJwk = pubJwk;
          await Sync.setConfig(cfg);
        }
      }catch(_){ /* ignore */ }
    }
    if(!pubJwk) return { ok:false, error:"update-missing-pubkey" };

    const vk = await importUpdatePubKeyJwk(pubJwk, ["verify"]);
    const dataU8 = new TextEncoder().encode(jsonText);
    const sigU8 = b64ToU8(sigB64);
    const alg = (vk.alg === "ECDSA") ? {name:"ECDSA", hash:"SHA-256"} : {name:"RSASSA-PKCS1-v1_5"};
    const ok = await crypto.subtle.verify(alg, vk.key, sigU8, dataU8);
    if(!ok) return { ok:false, error:"update-signature-invalid" };

    // Optional but strongly recommended: verify the server is actually serving the assets
    // that the signed manifest claims (prevents a signed JSON pointing at tampered assets).
    const verifyAssets = (cfg.update.verifyAssets !== false);
    if(verifyAssets && manifest && Array.isArray(manifest.assets) && manifest.assets.length){
      for(const a of manifest.assets){
        const p = String(a && a.path || '').trim();
        const want = String(a && a.sha256 || '').trim();
        if(!p || !want) return { ok:false, error:'update-manifest-bad-assets' };
        const u0 = await Sync._apiUrl(p.startsWith('/') ? p : ('/' + p));
        const u = u0 + (u0.includes('?') ? '&' : '?') + `v=${encodeURIComponent(String(manifest.buildId||''))}`;
        const r = await fetch(u, { cache:'no-store' });
        if(!r.ok) return { ok:false, error:`update-asset-${r.status}`, asset:p };
        const ab = await r.arrayBuffer();
        const got = await sha256B64FromArrayBuffer(ab);
        if(got !== want) return { ok:false, error:'update-asset-hash-mismatch', asset:p };
      }
    }

    const isNew = String(manifest.buildId || "") && String(manifest.buildId) !== String(BUILD.buildId);
    return { ok:true, verified:true, isNew, manifest };
  };

  SkyeShell.Sync = Sync;

  window.SkyeShell = SkyeShell;
})();
