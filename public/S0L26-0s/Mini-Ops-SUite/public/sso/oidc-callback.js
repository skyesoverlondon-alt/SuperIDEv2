(function(){
  'use strict';

  function qs(){
    const u = new URL(location.href);
    return {
      code: u.searchParams.get('code') || '',
      state: u.searchParams.get('state') || '',
      error: u.searchParams.get('error') || '',
      errorDesc: u.searchParams.get('error_description') || ''
    };
  }

  function setStatus(t){
    const el = document.getElementById('status');
    if(el) el.textContent = t;
  }

  function loadPending(state){
    try{
      const raw = sessionStorage.getItem('skyesync_oidc_' + state);
      return raw ? JSON.parse(raw) : null;
    }catch(_){ return null; }
  }

  function clearPending(state){
    try{ sessionStorage.removeItem('skyesync_oidc_' + state); }catch(_){/* ignore */}
  }

  async function postJSON(url, body){
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const txt = await res.text();
    let j = null;
    try{ j = txt ? JSON.parse(txt) : null; }catch(_){ j = null; }
    if(!res.ok){
      const err = (j && j.error) ? j.error : (txt || 'request-failed');
      const e = new Error(err);
      e.status = res.status;
      e.data = j;
      throw e;
    }
    return j;
  }

  async function run(){
    const p = qs();
    if(p.error){
      setStatus('SSO error: ' + p.error + (p.errorDesc ? (' — ' + p.errorDesc) : ''));
      return;
    }
    if(!p.code || !p.state){
      setStatus('Missing code/state');
      return;
    }

    const pending = loadPending(p.state);
    if(!pending || !pending.codeVerifier || !pending.deviceId){
      setStatus('Missing local verifier (open the SSO login from /sync)');
      return;
    }

    try{
      setStatus('Exchanging code…');
      const out = await postJSON('/.netlify/functions/sso-oidc-callback', {
        code: p.code,
        state: p.state,
        codeVerifier: pending.codeVerifier,
        deviceId: pending.deviceId
      });

      clearPending(p.state);
      try{ localStorage.setItem('skyesync_sso_result', JSON.stringify(out)); }catch(_){/* ignore */}
      setStatus('Done. Redirecting…');
      location.replace('/sync/#sso=1');
    }catch(e){
      setStatus('SSO failed: ' + (e.message || 'unknown'));
    }
  }

  run();
})();
