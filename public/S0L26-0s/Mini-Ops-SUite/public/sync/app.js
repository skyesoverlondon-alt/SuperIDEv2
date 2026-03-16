(function(){
  "use strict";
  const S = window.SkyeShell;
  if(!S) return;

  const VAULTS = [
    { key:"skyenote_vault", label:"SkyeNote", open:"../skyenote/" },
    { key:"skyecash_ledger", label:"SkyeCash", open:"../skyecash/" },
    { key:"skyefocus_log", label:"SkyeFocus", open:"../skyefocus/" }
  ];

  const els = {
    build: S.q("#buildBadge"),
    syncStatus: S.q("#syncStatus"),
    netStatus: S.q("#netStatus"),
    baseUrl: S.q("#baseUrl"),
    saveBase: S.q("#saveBase"),
    testConn: S.q("#testConn"),
    checkUpdates: S.q("#checkUpdates"),

    orgId: S.q("#orgId"),
    userId: S.q("#userId"),
    role: S.q("#role"),
    keyModel: S.q("#keyModel"),
    remoteSalt: S.q("#remoteSalt"),
    dekStatus: S.q("#dekStatus"),
    orgEpoch: S.q("#orgEpoch"),
    tokenVersion: S.q("#tokenVersion"),
    copyOrg: S.q("#copyOrg"),
    copyUser: S.q("#copyUser"),

    btnRotateKey: S.q("#btnRotateKey"),
    btnMigrate: S.q("#btnMigrate"),
    btnUpgradeVaultKeys: S.q("#btnUpgradeVaultKeys"),

    btnUnlock: S.q("#btnUnlock"),
    btnLock: S.q("#btnLock"),
    btnDisable: S.q("#btnDisable"),

    inviteRole: S.q("#inviteRole"),
    inviteHours: S.q("#inviteHours"),
    btnInvite: S.q("#btnInvite"),
    btnMembers: S.q("#btnMembers"),

    joinCode: S.q("#joinCode"),
    joinName: S.q("#joinName"),
    btnJoin: S.q("#btnJoin"),

    newOrg: S.q("#newOrg"),
    newName: S.q("#newName"),
    btnCreate: S.q("#btnCreate"),

    memberCount: S.q("#memberCount"),
    memberList: S.q("#memberList"),

    vaultRows: S.q("#vaultRows"),
    btnPullAll: S.q("#btnPullAll"),
    btnPushAll: S.q("#btnPushAll"),
    btnSyncAll: S.q("#btnSyncAll"),

    // Enterprise policy
    btnPolicyLoad: S.q("#btnPolicyLoad"),
    btnPolicySave: S.q("#btnPolicySave"),
    polSessionTtl: S.q("#polSessionTtl"),
    polMaxCipher: S.q("#polMaxCipher"),
    polRequireDevice: S.q("#polRequireDevice"),
    polAuditReads: S.q("#polAuditReads"),
    polRequireIp: S.q("#polRequireIp"),
    polIpAllow: S.q("#polIpAllow"),
    btnOrgExport: S.q("#btnOrgExport"),

    // Audit
    btnAuditLoad: S.q("#btnAuditLoad"),
    btnAuditMore: S.q("#btnAuditMore"),
    btnAuditProof: S.q("#btnAuditProof"),
    btnAuditExport: S.q("#btnAuditExport"),
    auditFilter: S.q("#auditFilter"),
    auditList: S.q("#auditList"),

    // SSO
    ssoOrgId: S.q("#ssoOrgId"),
    ssoDeviceLabel: S.q("#ssoDeviceLabel"),
    btnOidcLogin: S.q("#btnOidcLogin"),
    btnSamlLogin: S.q("#btnSamlLogin"),
    btnWebAuthnEnroll: S.q("#btnWebAuthnEnroll"),
  };

  S.attachBuildBadge(els.build);

  let AUDIT_CURSOR = 0;
  let AUDIT_EVENTS = [];


async function consumeSsoResult(){
  let raw = null;
  try{ raw = localStorage.getItem("skyesync_sso_result"); }catch(_){}
  if(!raw) return false;
  let out = null;
  try{ out = JSON.parse(raw); }catch(_){ out = null; }
  try{ localStorage.removeItem("skyesync_sso_result"); }catch(_){}
  if(!out || !out.token || !out.orgId || !out.userId) return false;

  const cfg = await S.Sync.getConfig();
  cfg.baseUrl = String(els.baseUrl.value||cfg.baseUrl||"").trim() || cfg.baseUrl || location.origin;
  cfg.enabled = true;
  cfg.orgId = out.orgId;
  cfg.userId = out.userId;
  cfg.role = out.role || cfg.role || "viewer";
  cfg.token = out.token;
  cfg.keyModel = out.keyModel || cfg.keyModel || "";
  if(out.orgSaltB64) cfg.orgSaltB64 = out.orgSaltB64;
  if(out.orgKdfIterations) cfg.orgKdfIterations = Number(out.orgKdfIterations)||cfg.orgKdfIterations;
  if(out.orgEpoch) cfg.orgEpoch = Number(out.orgEpoch)||cfg.orgEpoch;
  if(out.tokenVersion) cfg.tokenVersion = Number(out.tokenVersion)||cfg.tokenVersion;
  if(out.policy) cfg.policy = out.policy;

  await S.Sync.setConfig(cfg);

  // Force a token validation + key upload (for SSO-provisioned accounts).
  try{ await S.Sync.ensureToken(); }catch(_){}

  S.toast("SSO sign-in complete");
  return true;
}

async function startOidcLogin(){
  if(!navigator.onLine){ S.toast("Offline"); return; }
  const orgId = String(els.ssoOrgId.value||"").trim();
  if(!orgId){ S.toast("Org ID required"); return; }
  const deviceId = await S.Sync.getDeviceId();
  try{
    const res = await fetch("/.netlify/functions/sso-oidc-start", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ orgId, deviceId })
    });
    const txt = await res.text();
    let j = null;
    try{ j = txt ? JSON.parse(txt) : null; }catch(_){ j = null; }
    if(!res.ok){ S.toast((j && j.error) ? j.error : "OIDC start failed"); return; }
    if(!j || !j.authorizeUrl || !j.state || !j.codeVerifier){ S.toast("OIDC not configured"); return; }

    try{ sessionStorage.setItem("skyesync_oidc_"+j.state, JSON.stringify({ codeVerifier: j.codeVerifier, deviceId })); }catch(_){}
    location.href = j.authorizeUrl;
  }catch(_){
    S.toast("OIDC start failed");
  }
}

async function startSamlLogin(){
  if(!navigator.onLine){ S.toast("Offline"); return; }
  const orgId = String(els.ssoOrgId.value||"").trim();
  if(!orgId){ S.toast("Org ID required"); return; }
  const deviceId = await S.Sync.getDeviceId();
  const url = new URL(location.origin + "/sso/saml/login");
  url.searchParams.set("orgId", orgId);
  url.searchParams.set("deviceId", deviceId);
  url.searchParams.set("returnTo", "/sync/#sso=1");
  location.href = url.toString();
}

async function enrollWebAuthn(){
  if(!navigator.credentials || !window.PublicKeyCredential){ S.toast("WebAuthn not supported"); return; }
  if(!navigator.onLine){ S.toast("Offline"); return; }
  try{ await S.Sync.ensureToken(); }catch(_){ S.toast("Sign in first"); return; }
  const cfg = await S.Sync.getConfig();
  if(!cfg.token){ S.toast("Sign in first"); return; }

  function b64urlToBuf(s){
    s = String(s||"").replace(/-/g,"+").replace(/_/g,"/");
    while(s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
    return out.buffer;
  }
  function bufToB64url(buf){
    const b = new Uint8Array(buf);
    let s="";
    for(let i=0;i<b.length;i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"" );
  }

  function regOptionsFromJSON(pk){
    const out = JSON.parse(JSON.stringify(pk));
    out.challenge = b64urlToBuf(out.challenge);
    if(out.user && out.user.id) out.user.id = b64urlToBuf(out.user.id);
    if(out.excludeCredentials){
      out.excludeCredentials = out.excludeCredentials.map(c=>({ ...c, id: b64urlToBuf(c.id) }));
    }
    return out;
  }

  function credToJSON(cred){
    return {
      id: cred.id,
      type: cred.type,
      rawId: bufToB64url(cred.rawId),
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      response: {
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        attestationObject: bufToB64url(cred.response.attestationObject),
        transports: (cred.response.getTransports ? cred.response.getTransports() : undefined)
      }
    };
  }

  async function post(url, body){
    const res = await fetch(url, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization": "Bearer " + cfg.token
      },
      body: JSON.stringify(body)
    });
    const txt = await res.text();
    let j = null;
    try{ j = txt ? JSON.parse(txt) : null; }catch(_){ j = null; }
    if(!res.ok){ throw new Error((j && j.error) ? j.error : "request-failed"); }
    return j;
  }

  try{
    const opt = await post("/.netlify/functions/webauthn-register-options", {});
    const pk = regOptionsFromJSON(opt.publicKey);
    const cred = await navigator.credentials.create({ publicKey: pk });
    const credJson = credToJSON(cred);
    await post("/.netlify/functions/webauthn-register-verify", { challengeId: opt.challengeId, response: credJson });
    S.toast("Security key enrolled");
  }catch(_){
    S.toast("Enroll failed");
  }
}

  function policyFromInputs(){
    const ipLines = String(els.polIpAllow?.value||'')
      .split(/\r?\n/)
      .map(s=>s.trim())
      .filter(Boolean);
    const policy = {
      sessionTtlSec: els.polSessionTtl?.value ? Number(els.polSessionTtl.value) : undefined,
      maxCiphertextBytes: els.polMaxCipher?.value ? Number(els.polMaxCipher.value) : undefined,
      requireDeviceId: !!els.polRequireDevice?.checked,
      auditVaultReads: !!els.polAuditReads?.checked,
      requireIpAllowlist: !!els.polRequireIp?.checked,
      ipAllowlist: ipLines
    };
    return policy;
  }

  function policyToInputs(policy){
    policy = policy || {};
    if(els.polSessionTtl) els.polSessionTtl.value = policy.sessionTtlSec ? String(policy.sessionTtlSec) : '';
    if(els.polMaxCipher) els.polMaxCipher.value = policy.maxCiphertextBytes ? String(policy.maxCiphertextBytes) : '';
    if(els.polRequireDevice) els.polRequireDevice.checked = !!policy.requireDeviceId;
    if(els.polAuditReads) els.polAuditReads.checked = !!policy.auditVaultReads;
    if(els.polRequireIp) els.polRequireIp.checked = !!policy.requireIpAllowlist;
    if(els.polIpAllow) els.polIpAllow.value = Array.isArray(policy.ipAllowlist) ? policy.ipAllowlist.join("\n") : '';
  }

  function setNetBadge(){
    const online = navigator.onLine;
    els.netStatus.textContent = online ? "🌐 Online" : "🌐 Offline";
    els.netStatus.classList.toggle('good', online);
    els.netStatus.classList.toggle('bad', !online);
  }

  window.addEventListener('online', ()=>{ setNetBadge(); refresh(); });
  window.addEventListener('offline', ()=>{ setNetBadge(); refresh(); });

  async function ensureUpdatePubKey(cfg){
    if(cfg.update && cfg.update.pubKeyJwk) return cfg;
    try{
      const res = await fetch('../updates/public.jwk', { cache:'no-store' });
      if(!res.ok) return cfg;
      const jwk = await res.json();
      cfg.update.pubKeyJwk = jwk;
      await S.Sync.setConfig(cfg);
      return cfg;
    }catch(_){ return cfg; }
  }

  async function refreshIdentity(cfg){
    els.baseUrl.value = (cfg.baseUrl || "");
    els.orgId.value = cfg.orgId || "";
    els.userId.value = cfg.userId || "";
    els.role.value = cfg.role || "";
    els.keyModel.value = cfg.keyModel || "";
    // orgSalt is legacy (passphrase-v1). Keep display minimal.
    els.remoteSalt.value = cfg.orgSaltB64 ? (String(cfg.orgSaltB64).slice(0,10) + "…") : "";
    els.orgEpoch.value = String(cfg.orgEpoch || "");
    els.tokenVersion.value = String(cfg.tokenVersion || "");

    // Prefill SSO orgId if empty
    if(els.ssoOrgId && !String(els.ssoOrgId.value||"").trim()) els.ssoOrgId.value = cfg.orgId || "";

    const km = String(cfg.keyModel||"");
    const unlocked = S.Sync.hasKey();
    if(km === 'passphrase-v1') els.dekStatus.value = unlocked ? 'legacy key unlocked' : 'legacy key locked';
    else els.dekStatus.value = unlocked ? 'DEK unlocked' : (cfg.dekReady ? 'DEK locked' : 'DEK pending');

    if(els.btnMigrate){
      els.btnMigrate.disabled = !(cfg.role === 'owner' && km === 'passphrase-v1');
    }
    if(els.btnUpgradeVaultKeys){
      els.btnUpgradeVaultKeys.disabled = !(cfg.role === 'owner' && km === 'wrapped-dek-v1');
    }

    const enabled = !!cfg.enabled;
    const txt = enabled
      ? (unlocked ? "☁️ Sync: enabled (key ready)" : `☁️ Sync: enabled (${km==='passphrase-v1'?'legacy key locked':'key locked/pending'})`)
      : "☁️ Sync: disabled";
    els.syncStatus.textContent = txt;
    els.syncStatus.classList.toggle('good', enabled && unlocked);
    els.syncStatus.classList.toggle('warn', enabled && !unlocked);
    els.syncStatus.classList.toggle('bad', !enabled);
  }

  async function renderVaultRows(){
    const cfg = await S.Sync.getConfig();
    const enabled = !!cfg.enabled;

    let rows = "";
    for(const v of VAULTS){
      const meta = await S.Sync.getVaultMeta(v.key);
      const dirty = !!meta.dirty;
      const conflict = !!meta.conflict;
      const rev = Number(meta.remoteRev || 0);

      rows += `
        <tr data-vault="${S.esc(v.key)}">
          <td>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="tag">${S.esc(v.label)}</span>
              <a class="btn secondary" href="${S.esc(v.open)}" style="padding:6px 8px;border-radius:10px">Open</a>
              ${conflict ? `<span class="badge bad">conflict</span>` : ``}
            </div>
          </td>
          <td class="right"><span class="mono">${enabled ? rev : "—"}</span></td>
          <td>${enabled ? (dirty ? '<span class="badge warn">dirty</span>' : '<span class="badge good">clean</span>') : '—'}</td>
          <td><span class="mono" style="opacity:.8">${meta.lastPushAt ? new Date(meta.lastPushAt).toLocaleString() : '—'}</span></td>
          <td><span class="mono" style="opacity:.8">${meta.lastPullAt ? new Date(meta.lastPullAt).toLocaleString() : '—'}</span></td>
          <td class="right">
            <div class="row" style="justify-content:flex-end;gap:8px">
              <button class="btn secondary" data-pull ${!enabled?'disabled':''}>Pull</button>
              <button class="btn secondary" data-push ${(!enabled || !dirty)?'disabled':''}>Push</button>
              <button class="btn" data-sync ${!enabled?'disabled':''}>Sync</button>
            </div>
          </td>
        </tr>`;
    }

    els.vaultRows.innerHTML = rows;

    S.qa('[data-pull]', els.vaultRows).forEach(btn=>btn.addEventListener('click', async (e)=>{
      const key = e.target.closest('tr').getAttribute('data-vault');
      await withSyncKey(async()=>{
        const r = await S.Sync.pullVault(key);
        S.toast(r.upToDate ? 'Up to date' : 'Pulled');
      });
      await refresh();
    }));

    S.qa('[data-push]', els.vaultRows).forEach(btn=>btn.addEventListener('click', async (e)=>{
      const key = e.target.closest('tr').getAttribute('data-vault');
      await withSyncKey(async()=>{
        const r = await S.Sync.pushVault(key);
        if(r.conflict) S.toast('Push conflict (snapshot saved)');
        else if(r.merged) S.toast('Merged + pushed');
        else S.toast('Pushed');
      });
      await refresh();
    }));

    S.qa('[data-sync]', els.vaultRows).forEach(btn=>btn.addEventListener('click', async (e)=>{
      const key = e.target.closest('tr').getAttribute('data-vault');
      await withSyncKey(async()=>{
        const r = await S.Sync.syncVault(key);
        if(r.conflict) S.toast('Sync conflict (snapshot saved)');
        else if(r.merged) S.toast('Merged + synced');
        else S.toast(r.upToDate ? 'Up to date' : 'Synced');
      });
      await refresh();
    }));
  }

  async function renderMembers(list){
    const cfg = await S.Sync.getConfig();
    const canManage = (cfg.role === 'owner' || cfg.role === 'admin');

    els.memberCount.textContent = `${(list?.members||[]).length} members`;
    const items = (list?.members||[]).map(m=>{
      const roleTag = `<span class="tag">${S.esc(m.role)}</span>`;
      const statusTag = m.status && m.status !== 'active'
        ? `<span class="badge bad">${S.esc(m.status)}</span>`
        : `<span class="badge good">active</span>`;

      const isWrapped = (cfg.keyModel==='wrapped-dek-v1' || cfg.keyModel==='wrapped-epoch-vault-v1');

      const dekTag = isWrapped
        ? (m.dekReady ? `<span class="badge good">key ready</span>` : `<span class="badge warn">key pending</span>`)
        : `<span class="badge warn">legacy org</span>`;

      const encTag = (canManage && !m.encPubKeyJwk) ? `<span class="badge warn">enc key missing</span>` : ``;
      const name = S.esc(m.name || m.id);
      const idShort = S.esc(String(m.id||'').slice(0,8) + '…');

      const roleSel = canManage ? `
        <select data-role style="max-width:140px">
          <option value="viewer" ${m.role==='viewer'?'selected':''}>viewer</option>
          <option value="editor" ${m.role==='editor'?'selected':''}>editor</option>
          <option value="admin" ${m.role==='admin'?'selected':''}>admin</option>
          <option value="owner" ${m.role==='owner'?'selected':''}>owner</option>
        </select>
        <button class="btn secondary" data-setrole>Set role</button>
      ` : '';

      const statusCtl = canManage ? `
        <button class="btn secondary" data-status="${m.status==='active'?'revoked':'active'}">${m.status==='active'?'Revoke':'Restore'}</button>
      ` : '';

      const grantCtl = (canManage && isWrapped && m.status==='active' && !m.dekReady) ? `
        <button class="btn" data-grant ${!m.encPubKeyJwk?'disabled':''}>Grant access</button>
      ` : '';

      return `
        <div class="item" data-user="${S.esc(m.id)}">
          <div style="min-width:0">
            <p class="t">${name}</p>
            <p class="s mono">${idShort}</p>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${roleTag} ${statusTag} ${dekTag} ${encTag}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center">
            ${roleSel}
            ${statusCtl}
            ${grantCtl}
          </div>
        </div>`;
    }).join('') || `<div class="note">No members loaded.</div>`;

    els.memberList.innerHTML = items;

    if(canManage){
      S.qa('[data-setrole]', els.memberList).forEach(btn=>{
        btn.addEventListener('click', async (e)=>{
          const wrap = e.target.closest('[data-user]');
          const userId = wrap.getAttribute('data-user');
          const sel = wrap.querySelector('[data-role]');
          const role = sel.value;
          try{
            await S.Sync.setMemberRole(userId, role);
            S.toast('Role updated');
            await refreshMembers();
          }catch(err){
            S.toast('Role update failed');
          }
        });
      });

      S.qa('[data-status]', els.memberList).forEach(btn=>{
        btn.addEventListener('click', async (e)=>{
          const wrap = e.target.closest('[data-user]');
          const userId = wrap.getAttribute('data-user');
          const next = e.target.getAttribute('data-status');
          const ok = await S.confirm('Change member status', `${next==='revoked'?'Revoke':'Restore'} this member?`, next==='revoked'?'Revoke':'Restore');
          if(!ok) return;
          try{
            await S.Sync.setMemberStatus(userId, next);
            S.toast('Status updated');
            await refreshMembers();

            // Optional: per-vault key rotation on revoke (limited scope).
            if(next === 'revoked'){
              const cfg = await S.Sync.getConfig();
              const km = String(cfg.keyModel||"");

              if((cfg.role === 'owner' || cfg.role === 'admin') && km === 'wrapped-epoch-vault-v1'){
  const picksHtml = VAULTS.map(v=>{
    return `<label class="pick"><input type="checkbox" data-vaultpick value="${S.esc(v.key)}" checked> <span>${S.esc(v.label)}</span></label>`;
  }).join('');

  const html = `
    <div style="margin-top:4px">
      <div>Recommended: rotate vault keys for the vaults this member could access. This re-encrypts only the selected vaults with fresh per-vault keys.</div>
      <div style="margin-top:10px">
        ${picksHtml}
      </div>
      <div style="margin-top:10px;opacity:.9">Revoked members cannot decrypt future updates for rotated vaults, even if ciphertext leaks later.</div>
    </div>`;
  const r2 = await S.modal({ title:'Rotate vault keys?', html, okText:'Rotate selected', cancelText:'Skip', showInput:false });
                if(r2.ok){
                  const picks = Array.from(document.querySelectorAll('#modalText input[data-vaultpick]'))
                    .filter(x=>x && x.checked)
                    .map(x=>x.value);
                  if(picks.length){
                    await withSyncKey(async()=>{ for(const k of picks){ await S.Sync.rotateVaultKey(k); } });
                    S.toast('Vault keys rotated');
                    await refresh();
                    await refreshMembers();
                  }
                }
              }

              // Optional: org epoch rotation (rewrap-only in v6). Not required if you rotated vaults, but can invalidate cached epoch keys.
              if(cfg.role === 'owner'){
                const doRot = await S.confirm('Rotate org epoch too?', 'Optional: rotate org epoch key (rewrap-only) to invalidate cached epoch keys after a revocation.', 'Rotate');
                if(doRot){
                  await withSyncKey(async()=>{ await S.Sync.rotateOrgKey(); });
                  S.toast('Org epoch rotated');
                  await refresh();
                  await refreshMembers();
                }
              }
            }
          }catch(_){
            S.toast('Status update failed');
          }
        });
      });

      S.qa('[data-grant]', els.memberList).forEach(btn=>{
        btn.addEventListener('click', async (e)=>{
          const wrap = e.target.closest('[data-user]');
          const userId = wrap.getAttribute('data-user');
          const ok = await S.confirm('Grant access', 'Wrap the org encryption key (DEK) to this member?', 'Grant');
          if(!ok) return;
          try{
            await withSyncKey(async()=>{
              await S.Sync.grantMemberKey(userId);
            });
            S.toast('Access granted');
            await refreshMembers();
          }catch(_){
            S.toast('Grant failed');
          }
        });
      });
    }
  }

  async function refreshMembers(){
    const cfg = await S.Sync.getConfig();
    if(!cfg.enabled) { els.memberList.innerHTML = '<div class="note">Sync disabled.</div>'; els.memberCount.textContent='0'; return; }
    try{
      const list = await S.Sync.listMembers();
      await renderMembers(list);
    }catch(_){
      els.memberList.innerHTML = '<div class="note">Members unavailable (check auth/server).</div>';
    }
  }

  function renderAudit(){
    const items = (AUDIT_EVENTS||[]).map(ev=>{
      const ts = ev.createdAt ? new Date(ev.createdAt).toLocaleString() : '';
      const sev = ev.severity || 'info';
      const sevBadge = sev === 'warn' ? '<span class="badge warn">warn</span>' : (sev === 'error' ? '<span class="badge bad">error</span>' : '<span class="badge good">info</span>');
      const act = S.esc(ev.action||'');
      const who = S.esc(String(ev.userId||'').slice(0,8) + '…');
      const did = ev.deviceId ? S.esc(String(ev.deviceId).slice(0,10) + '…') : '—';
      const detail = ev.detail ? S.esc(JSON.stringify(ev.detail)) : '';
      return `
        <div class="item">
          <div style="min-width:0">
            <p class="t" style="margin:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="tag mono">${act}</span>
              ${sevBadge}
              <span class="mono" style="opacity:.85">${S.esc(ts)}</span>
            </p>
            <p class="s mono" style="margin:6px 0 0;opacity:.85">user ${who} • device ${did}</p>
            <p class="s mono" style="margin:6px 0 0;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${detail}</p>
          </div>
        </div>`;
    }).join('') || '<div class="note">No audit events loaded.</div>';

    if(els.auditList) els.auditList.innerHTML = items;
  }

  async function loadAudit(reset){
    const cfg = await S.Sync.getConfig();
    if(!cfg.enabled){ S.toast('Sync disabled'); return; }
    if(!navigator.onLine){ S.toast('Offline'); return; }

    const filter = String(els.auditFilter?.value||'').trim();
    const beforeId = reset ? 0 : (AUDIT_CURSOR||0);

    try{
      await S.Sync.ensureToken();
      const out = await S.Sync.listAudit({ beforeId, limit: 100, actionPrefix: filter, verifyChain: true });
      const evs = out.events || [];
      if(reset){ AUDIT_EVENTS = evs; }
      else { AUDIT_EVENTS = (AUDIT_EVENTS||[]).concat(evs); }
      AUDIT_CURSOR = out.nextCursor || 0;
      renderAudit();
      if(out.chainOk === false) S.toast('Audit chain warning: slice not internally linked');
      else S.toast(reset ? 'Audit loaded' : 'More loaded');
    }catch(_){
      S.toast('Audit load failed (admin required)');
    }
  }

  async function loadPolicyUI(){
    if(!navigator.onLine){ S.toast('Offline'); return; }
    try{
      await S.Sync.ensureToken();
      const out = await S.Sync.getPolicy();
      policyToInputs(out.policy || {});
      S.toast('Policy loaded');
    }catch(_){
      S.toast('Policy unavailable (owner/admin only)');
    }
  }

  async function savePolicyUI(){
    if(!navigator.onLine){ S.toast('Offline'); return; }
    const cfg = await S.Sync.getConfig();
    if(cfg.role !== 'owner'){ S.toast('Owner required'); return; }
    const ok = await S.confirm('Apply policy', 'This will bump token version and force re-auth on all devices. Continue?', 'Apply');
    if(!ok) return;
    try{
      const policy = policyFromInputs();
      await S.Sync.setPolicy(policy);
      S.toast('Policy saved (re-auth required)');
      await refresh();
      await refreshMembers();
    }catch(err){
      S.toast('Policy save failed');
    }
  }

  async function exportOrgUI(){
    if(!navigator.onLine){ S.toast('Offline'); return; }
    const cfg = await S.Sync.getConfig();
    if(cfg.role !== 'owner'){ S.toast('Owner required'); return; }
    await withSyncKey(async()=>{
      const out = await S.Sync.exportOrg();
      const b64 = out.gzipB64;
      if(!b64){ S.toast('Export failed'); return; }
      const bin = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
      const blob = new Blob([bin], { type: 'application/gzip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      a.download = `skye-sync-export-${ts}.json.gz`;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      S.toast('Export downloaded');
    });
  }

  async function withSyncKey(fn){
    const cfg = await S.Sync.getConfig();
    if(!cfg.enabled){ S.toast('Sync disabled'); return; }
    if(!navigator.onLine){ S.toast('Offline'); return; }

    if(!S.Sync.hasKey()){
      const km = String(cfg.keyModel||'');
      try{
        if(km === 'passphrase-v1'){
          const r = await S.modal({
            title:'Unlock legacy key',
            text:'This org is using legacy passphrase-based encryption (passphrase-v1). Enter the team passphrase to decrypt sync blobs. This is not stored. Lock clears it.',
            okText:'Unlock',
            cancelText:'Cancel',
            type:'password',
            placeholder:'Sync passphrase',
            require:true
          });
          if(!r.ok) return;
          await S.Sync.unlock(r.value);
        } else {
          await S.Sync.unlock();
        }
      } catch(err){
        const msg = String(err?.message||'Unlock failed');
        if(msg === 'sync-key-pending') { S.toast('Key pending: ask owner/admin to Grant access'); return; }
        if(msg === 'org-legacy-keymodel') { S.toast('Legacy org detected: use passphrase unlock or migrate.'); return; }
        if(msg === 'passphrase-required') { S.toast('Passphrase required'); return; }
        S.toast('Unlock failed');
        return;
      }
    }

    try{ await fn(); }
    catch(err){
      let msg = String(err?.message||'sync failed');
      if(msg === 'sync-rekey-required') msg = 'Re-key required (org key rotated). Unlock session again (owner must grant if needed).';
      if(msg === 'sync-epoch-mismatch-vault') msg = 'Vault is still encrypted under an older org epoch. Owner must rotate/re-encrypt vaults.';
      if(msg === 'sync-key-pending') msg = 'Key pending: ask owner/admin to Grant access.';
      S.toast(msg);
    }
  }

  async function testConnection(){
    const cfg = await S.Sync.getConfig();
    if(!navigator.onLine) { S.toast('Offline'); return; }
    try{
      // soft test: pull empty / check challenge requires orgId and userId
      if(!cfg.enabled || !cfg.orgId || !cfg.userId){
        S.toast('No org/user yet');
        return;
      }
      await S.Sync.ensureToken();
      S.toast('Auth OK');
    }catch(err){
      S.toast('Test failed');
    }
  }

  async function refresh(){
    setNetBadge();
    await consumeSsoResult();
    let cfg = await S.Sync.getConfig();
    cfg = await ensureUpdatePubKey(cfg);
    await refreshIdentity(cfg);
    try{ policyToInputs(cfg.policy || {}); }catch(_){ /* ignore */ }
    await renderVaultRows();

    const hash = location.hash || '';
    const m = hash.match(/vault=([^&]+)/);
    if(m){
      const key = decodeURIComponent(m[1]);
      const tr = S.q(`tr[data-vault="${CSS.escape(key)}"]`, els.vaultRows);
      if(tr) tr.scrollIntoView({behavior:'smooth', block:'center'});
    }
  }

  els.saveBase.addEventListener('click', async ()=>{
    const cfg = await S.Sync.getConfig();
    cfg.baseUrl = String(els.baseUrl.value||'').trim();
    await S.Sync.setConfig(cfg);
    S.toast('Saved');
    await refresh();
  });

  els.testConn.addEventListener('click', testConnection);

  els.btnUnlock.addEventListener('click', async ()=>{
    await withSyncKey(async()=>{ S.toast('Unlocked'); });
    await refresh();
  });

  els.btnLock.addEventListener('click', async ()=>{
    S.Sync.lock();
    S.toast('Locked');
    await refresh();
  });

  els.btnDisable.addEventListener('click', async ()=>{
    const ok = await S.confirm('Disable sync', 'Disable sync on this device? Local vaults remain.', 'Disable');
    if(!ok) return;
    await S.Sync.disable();
    S.toast('Sync disabled');
    await refresh();
    await refreshMembers();
  });

  els.copyOrg.addEventListener('click', async ()=>{
    try{ await navigator.clipboard.writeText(els.orgId.value||''); S.toast('Copied'); }catch(_){ S.toast('Copy failed'); }
  });
  els.copyUser.addEventListener('click', async ()=>{
    try{ await navigator.clipboard.writeText(els.userId.value||''); S.toast('Copied'); }catch(_){ S.toast('Copy failed'); }
  });

  els.btnCreate.addEventListener('click', async ()=>{
    if(!navigator.onLine){ S.toast('Offline'); return; }
    const org = (els.newOrg.value||'').trim();
    const name = (els.newName.value||'').trim();
    if(!org || !name){ S.toast('Org + name required'); return; }

    try{
      const cfg = await S.Sync.getConfig();
      cfg.baseUrl = String(els.baseUrl.value||'').trim();
      await S.Sync.setConfig(cfg);

      await S.Sync.createOrg(org, name);
      S.toast('Org created');
      await refresh();
      await refreshMembers();
    }catch(err){
      S.toast('Create failed');
    }
  });

  els.btnJoin.addEventListener('click', async ()=>{
    if(!navigator.onLine){ S.toast('Offline'); return; }
    const code = (els.joinCode.value||'').trim();
    const name = (els.joinName.value||'').trim();
    if(!code || !name){ S.toast('Invite + name required'); return; }

    try{
      const cfg = await S.Sync.getConfig();
      cfg.baseUrl = String(els.baseUrl.value||'').trim();
      await S.Sync.setConfig(cfg);

      await S.Sync.joinWithInvite(code, name);
      S.toast('Joined');
      await refresh();
      await refreshMembers();
    }catch(err){
      S.toast('Join failed');
    }
  });

  els.btnInvite.addEventListener('click', async ()=>{
    if(!navigator.onLine){ S.toast('Offline'); return; }
    await withSyncKey(async ()=>{
      const role = els.inviteRole.value;
      const hrs = Number(els.inviteHours.value || 72);
      const out = await S.Sync.createInvite(role, hrs);
      const code = out.inviteCode;
      await S.modal({
        title:'Invite code',
        text:`Share this invite code with your teammate. After they join, an owner/admin must click “Grant access” to wrap the org key (DEK) to their device.\n\n${code}`,
        okText:'OK',
        cancelText:'Close',
        type:'text',
        placeholder:'',
        require:false
      });
      try{ await navigator.clipboard.writeText(code); }catch(_){/* ignore */}
    });
  });

  els.btnMembers.addEventListener('click', refreshMembers);

  // Enterprise controls
  if(els.btnPolicyLoad) els.btnPolicyLoad.addEventListener('click', loadPolicyUI);
  if(els.btnPolicySave) els.btnPolicySave.addEventListener('click', savePolicyUI);
  if(els.btnOrgExport) els.btnOrgExport.addEventListener('click', exportOrgUI);

  if(els.btnAuditLoad) els.btnAuditLoad.addEventListener('click', ()=>loadAudit(true));
  if(els.btnAuditMore) els.btnAuditMore.addEventListener('click', ()=>loadAudit(false));
  if(els.btnAuditExport) 
  if(els.btnAuditProof) els.btnAuditProof.addEventListener('click', async ()=>{
    try{
      const prefix = String(els.auditFilter?.value||'').trim();
      const res = await S.Sync._api('/.netlify/functions/sync-audit-pack', { auth:true, body:{ actionPrefix: prefix || undefined } });
      if(!res || !res.zipB64) throw new Error('no-zip');
      const u8 = S.b64ToU8(res.zipB64);
      const blob = new Blob([u8], {type:'application/zip'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = res.filename || 'skye-audit-proofpack.zip';
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      S.toast('Proof pack exported');
    }catch(e){
      S.toast('Proof pack export failed');
    }
  });

els.btnAuditExport.addEventListener('click', async ()=>{
    try{
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), events: AUDIT_EVENTS }, null, 2)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      a.download = `skye-audit-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      S.toast('Audit exported');
    }catch(_){ S.toast('Export failed'); }
  });

  if(els.auditFilter) els.auditFilter.addEventListener('change', ()=>loadAudit(true));

  els.btnPullAll.addEventListener('click', async ()=>{
    await withSyncKey(async ()=>{
      for(const v of VAULTS){
        await S.Sync.pullVault(v.key);
      }
      S.toast('Pulled all');
    });
    await refresh();
  });

  els.btnPushAll.addEventListener('click', async ()=>{
    await withSyncKey(async ()=>{
      for(const v of VAULTS){
        const m = await S.Sync.getVaultMeta(v.key);
        if(m.dirty) await S.Sync.pushVault(v.key);
      }
      S.toast('Pushed dirty');
    });
    await refresh();
  });

  els.btnSyncAll.addEventListener('click', async ()=>{
    await withSyncKey(async ()=>{
      for(const v of VAULTS){
        await S.Sync.syncVault(v.key);
      }
      S.toast('Sync complete');
    });
    await refresh();
  });

  els.checkUpdates.addEventListener('click', async ()=>{
    if(!navigator.onLine){ S.toast('Offline'); return; }
    try{
      const cfg = await S.Sync.getConfig();
      await ensureUpdatePubKey(cfg);
      const r = await S.Sync.checkSignedUpdate();
      if(!r.ok) { S.toast(r.error || 'update check failed'); return; }
      const m = r.manifest;
      const msg = r.isNew
        ? `New verified build: ${m.buildId}\nNotes: ${m.notes || ''}`
        : `Up to date (verified). Build: ${m.buildId}`;
      await S.modal({title:'Signed update check', text: msg, okText:'OK', cancelText:'Close', type:'text', placeholder:'', require:false});
    }catch(err){
      S.toast('Update check failed');
    }
  });

  els.btnRotateKey.addEventListener('click', async ()=>{
    const cfg = await S.Sync.getConfig();
    if(cfg.role !== 'owner') { S.toast('Owner only'); return; }
    if(!navigator.onLine){ S.toast('Offline'); return; }

    if(String(cfg.keyModel||'') === 'passphrase-v1'){
      S.toast('Legacy org: migrate to wrapped DEK first');
      return;
    }

    await withSyncKey(async()=>{});

    const km = String(cfg.keyModel||'');
    const msg = (km === 'wrapped-epoch-vault-v1')
      ? 'Rotate org epoch + generate a new epoch key + re-wrap for active members + re-wrap vault keys (no vault blob re-encryption).'
      : 'Rotate org epoch + generate a new DEK + re-wrap for active members + re-encrypt/push vaults.';
    const ok = await S.confirm('Rotate org key', msg, 'Rotate');
    if(!ok) return;

    try{
      await S.Sync.rotateOrgKey();
      S.toast('Rotated + re-encrypted');
      await refresh();
      await refreshMembers();
    }catch(_){
      S.toast('Rotation failed');
    }
  });

  els.btnMigrate.addEventListener('click', async ()=>{
    const cfg = await S.Sync.getConfig();
    if(cfg.role !== 'owner') { S.toast('Owner only'); return; }
    if(!navigator.onLine){ S.toast('Offline'); return; }

    const km = String(cfg.keyModel||'');
    if(km !== 'passphrase-v1'){ S.toast('Already on wrapped-dek'); return; }

    const r = await S.modal({
      title:'Migrate to wrapped DEK',
      text:'This will (1) pull latest vaults using the legacy passphrase key, then (2) switch the org to per-member wrapped DEK, then (3) re-encrypt/push vaults under the new model. You will need the current legacy sync passphrase.',
      okText:'Migrate',
      cancelText:'Cancel',
      type:'password',
      placeholder:'Legacy sync passphrase',
      require:true
    });
    if(!r.ok) return;

    try{
      await S.Sync.migrateOrgToWrappedDEK(r.value);
      S.toast('Migrated + re-encrypted');
      await refresh();
      await refreshMembers();
    }catch(err){
      S.toast(String(err?.message||'Migration failed'));
    }
  });
if(els.btnUpgradeVaultKeys){
  els.btnUpgradeVaultKeys.addEventListener('click', async ()=>{
    const cfg = await S.Sync.getConfig();
    if(cfg.role !== 'owner') { S.toast('Owner only'); return; }
    if(!navigator.onLine){ S.toast('Offline'); return; }

    const km = String(cfg.keyModel||'');
    if(km !== 'wrapped-dek-v1'){ S.toast('Not needed'); return; }

    await withSyncKey(async()=>{});

    const ok = await S.confirm(
      'Upgrade to per-vault keys',
      'This is a one-time upgrade: generate per-vault keys, re-encrypt vault blobs once, then switch to wrapped-epoch-vault-v1 (faster rotations + per-vault access control). Continue?',
      'Upgrade'
    );
    if(!ok) return;

    try{
      await S.Sync.upgradeOrgToPerVaultKeys();
      S.toast('Upgraded');
      await refresh();
      await refreshMembers();
    }catch(_){
      S.toast('Upgrade failed');
    }
  });
}




  // SSO buttons
  if(els.btnOidcLogin) els.btnOidcLogin.addEventListener('click', startOidcLogin);
  if(els.btnSamlLogin) els.btnSamlLogin.addEventListener('click', startSamlLogin);
  if(els.btnWebAuthnEnroll) els.btnWebAuthnEnroll.addEventListener('click', enrollWebAuthn);

  // init
  (async()=>{
    await refresh();
    await refreshMembers();
  })();
})();
