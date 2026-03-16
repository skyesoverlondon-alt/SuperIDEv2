(function(){
  'use strict';

  function setText(t){
    const el = document.querySelector('#status');
    if(el) el.textContent = t;
  }

  function b64ToObj(b64){
    try{ return JSON.parse(atob(b64)); }catch(_){ return null; }
  }

  function b64urlToBuf(s){
    s = String(s||'').replace(/-/g,'+').replace(/_/g,'/');
    while(s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
    return out.buffer;
  }

  function bufToB64url(buf){
    const b = new Uint8Array(buf);
    let s='';
    for(let i=0;i<b.length;i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  function publicKeyFromJSON(pk){
    // Deep convert challenge + allowCredentials ids
    const out = JSON.parse(JSON.stringify(pk));
    out.challenge = b64urlToBuf(out.challenge);
    if(out.allowCredentials){
      out.allowCredentials = out.allowCredentials.map(c=>({ ...c, id: b64urlToBuf(c.id) }));
    }
    if(out.excludeCredentials){
      out.excludeCredentials = out.excludeCredentials.map(c=>({ ...c, id: b64urlToBuf(c.id) }));
    }
    return out;
  }

  function credentialToJSON(cred){
    return {
      id: cred.id,
      type: cred.type,
      rawId: bufToB64url(cred.rawId),
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      response: {
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        authenticatorData: bufToB64url(cred.response.authenticatorData),
        signature: bufToB64url(cred.response.signature),
        userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null
      }
    };
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
    const node = document.getElementById('ssoPayload');
    const payload = node ? b64ToObj(node.dataset.payload||'') : null;
    if(!payload){
      return;
    }

    if(payload.mode === 'final'){
      try{ localStorage.setItem('skyesync_sso_result', JSON.stringify(payload.result)); }catch(_){/* ignore */}
      location.replace('/sync/#sso=1');
      return;
    }

    if(payload.mode === 'webauthn'){
      try{
        const pk = publicKeyFromJSON(payload.webauthn.publicKey);
        const cred = await navigator.credentials.get({ publicKey: pk });
        const wa = credentialToJSON(cred);
        const out = await postJSON(payload.finalizeEndpoint, {
          preAuthToken: payload.preAuthToken,
          webauthn: { challengeId: payload.webauthn.challengeId, response: wa }
        });
        try{ localStorage.setItem('skyesync_sso_result', JSON.stringify(out)); }catch(_){/* ignore */}
        location.replace('/sync/#sso=1');
      }catch(e){
        setText('WebAuthn failed: ' + (e.message || 'unknown'));
      }
      return;
    }

    if(payload.mode === 'error'){
      setText('SSO error: ' + (payload.error || 'unknown'));
    }
  }

  run();
})();
