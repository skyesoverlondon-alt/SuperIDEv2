const crypto = require('crypto');
const { query } = require('./_db');
const { jwtVerify, bad } = require('./_util');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');

function b64url(buf){
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function stableJson(v){
  if(v === null || v === undefined) return 'null';
  if(typeof v !== 'object') return JSON.stringify(v);
  if(Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}
function sha256B64UrlUtf8(s){
  const h = crypto.createHash('sha256').update(Buffer.from(String(s||''), 'utf8')).digest();
  return b64url(h);
}
function header(event, name){
  const h = event.headers || {};
  const lc = name.toLowerCase();
  return String(h[lc] || h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || '').trim();
}
function parseBearer(event){
  const auth = header(event, 'authorization');
  const m = String(auth||'').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}
function rawBodyUtf8(event){
  const b = event.body || '';
  if(!b) return '';
  if(event.isBase64Encoded){
    try{ return Buffer.from(b, 'base64').toString('utf8'); }catch(_){ return ''; }
  }
  return String(b);
}
function getDeviceId(event){
  return header(event, 'x-skye-device-id') || header(event, 'x-device-id') || '';
}

async function importEcdsaPub(pubJwk){
  const subtle = crypto.webcrypto.subtle;
  return subtle.importKey('jwk', pubJwk, { name:'ECDSA', namedCurve:'P-256' }, true, ['verify']);
}
async function verifyEcdsaUtf8(pubJwk, msgUtf8, signatureB64){
  const subtle = crypto.webcrypto.subtle;
  const pubKey = await importEcdsaPub(pubJwk);
  const enc = new TextEncoder();
  const data = enc.encode(String(msgUtf8||''));
  const sig = Buffer.from(String(signatureB64||''), 'base64');
  return subtle.verify({ name:'ECDSA', hash:'SHA-256' }, pubKey, sig, data);
}

async function storeNonce(orgId, userId, nonce, ttlSec){
  try{ await query('DELETE FROM sync_token_nonces WHERE expires_at < now()'); }catch(_){ /* ignore */ }
  const exp = new Date(Date.now() + (ttlSec*1000)).toISOString();
  const ins = await query(
    'INSERT INTO sync_token_nonces(org_id,user_id,nonce,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [orgId, userId, nonce, exp]
  );
  return ins.rowCount === 1;
}

const ROLES = ['viewer','editor','admin','owner'];
function roleRank(r){ return Math.max(0, ROLES.indexOf(String(r||'viewer'))); }

async function requireCtx(event, opts = {}){
  const minRole = String(opts.minRole || 'viewer');
  const skipIpAllowlist = !!opts.skipIpAllowlist;
  const skipPosture = !!opts.skipPosture;
  const skipTokenBinding = !!opts.skipTokenBinding;
  const allowRevoked = !!opts.allowRevoked;

  const tok = parseBearer(event);
  if(!tok) return { resp: bad(event, 401, 'unauthorized') };

  let token = null;
  try{ token = jwtVerify(tok); }catch(_){ token = null; }
  if(!token || !token.sub || !token.orgId) return { resp: bad(event, 401, 'unauthorized') };

  let row = null;
  try{
    const r = await query(
      `SELECT
         o.id as org_id,
         o.token_version as org_token_version,
         o.policy as org_policy,
         u.id as user_id,
         u.role as user_role,
         u.status as user_status,
         u.revoked_at as user_revoked_at,
         COALESCE(u.token_version, 1) as user_token_version,
         u.pubkey_jwk as user_pubkey_jwk
       FROM sync_orgs o
       JOIN sync_users u ON u.org_id=o.id
       WHERE o.id=$1 AND u.id=$2`,
      [token.orgId, token.sub]
    );
    if(r.rowCount !== 1) return { resp: bad(event, 401, 'unauthorized') };
    row = r.rows[0];
  }catch(_){
    return { resp: bad(event, 500, 'db-error') };
  }

  const policy = normalizePolicy(row.org_policy || {});
  const orgTv = Number(row.org_token_version || 1);
  const userTv = Number(row.user_token_version || 1);

  const tvTok = (token.tv !== undefined && token.tv !== null) ? Number(token.tv) : 0;
  if((!tvTok && orgTv !== 1) || (tvTok && tvTok !== orgTv)){
    return { resp: bad(event, 401, 'token-stale', { tokenVersion: orgTv }) };
  }

  const uvTok = (token.uv !== undefined && token.uv !== null) ? Number(token.uv) : 0;
  if((!uvTok && userTv !== 1) || (uvTok && uvTok !== userTv)){
    return { resp: bad(event, 401, 'user-token-stale', { userTokenVersion: userTv }) };
  }

  if(String(row.user_status) !== 'active' && !allowRevoked){
    return { resp: bad(event, 403, 'user-disabled') };
  }

  if(roleRank(row.user_role) < roleRank(minRole)){
    return { resp: bad(event, 403, 'forbidden') };
  }

  if(!skipIpAllowlist){
    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return { resp: bad(event, 403, 'ip-not-allowed') };
    }
  }

  const deviceId = getDeviceId(event) || String(token.did || '');
  if(policy.requireDeviceId && !deviceId){
    return { resp: bad(event, 400, 'deviceId-required') };
  }
  if(token.did && deviceId && String(token.did) !== String(deviceId)){
    return { resp: bad(event, 409, 'device-mismatch') };
  }

  const dp = (policy.devicePosture && typeof policy.devicePosture === 'object') ? policy.devicePosture : {};
  const postureRequired = !!dp.requireForApi;
  if(postureRequired && !skipPosture){
    const maxAgeSec = Number(dp.maxAgeSec || 3600);
    try{
      const pr = await query(
        'SELECT status, reasons, assessed_at, last_seen_at FROM sync_device_posture WHERE org_id=$1 AND user_id=$2 AND device_id=$3',
        [row.org_id, row.user_id, deviceId || '']
      );
      if(pr.rowCount !== 1){
        return { resp: bad(event, 428, 'posture-required', { why: ['no-posture-on-file'] }) };
      }
      const pRow = pr.rows[0];
      const last = new Date(pRow.last_seen_at || pRow.assessed_at || 0).getTime();
      if(!last || (Date.now() - last) > (maxAgeSec*1000)){
        return { resp: bad(event, 428, 'posture-stale', { why: ['posture-too-old'], maxAgeSec }) };
      }
      if(String(pRow.status) !== 'compliant'){
        return { resp: bad(event, 403, 'posture-noncompliant', { why: (pRow.reasons || []) }) };
      }
      try{ await query('UPDATE sync_device_posture SET last_seen_at=now() WHERE org_id=$1 AND user_id=$2 AND device_id=$3', [row.org_id, row.user_id, deviceId || '']); }catch(_){}
    }catch(_){
      return { resp: bad(event, 500, 'db-error') };
    }
  }

  const tb = (policy.tokenBinding && typeof policy.tokenBinding === 'object') ? policy.tokenBinding : {};
  const bindingRequired = !!tb.requireForApi;
  if(bindingRequired && !skipTokenBinding){
    const ts = header(event, 'x-skye-bind-ts');
    const nonce = header(event, 'x-skye-bind-nonce');
    const sig = header(event, 'x-skye-bind');
    if(!ts || !nonce || !sig){
      return { resp: bad(event, 428, 'token-binding-required') };
    }
    const tsNum = Number(ts);
    const maxSkewSec = Number(tb.maxSkewSec || 120);
    if(!Number.isFinite(tsNum)) return { resp: bad(event, 400, 'bad-bind-ts') };
    const nowSec = Math.floor(Date.now()/1000);
    if(Math.abs(nowSec - tsNum) > maxSkewSec){
      return { resp: bad(event, 401, 'bind-ts-skew', { maxSkewSec }) };
    }
    const n = String(nonce||'');
    if(n.length < 12 || n.length > 96) return { resp: bad(event, 400, 'bad-bind-nonce') };

    const bodyStr = rawBodyUtf8(event);
    const bodyHash = sha256B64UrlUtf8(bodyStr || '');
    const bodyHashHdr = header(event, 'x-skye-body-hash');
    if(bodyHashHdr && bodyHashHdr !== bodyHash){
      return { resp: bad(event, 400, 'body-hash-mismatch') };
    }

    const canonical = [
      'v1',
      String(event.httpMethod||'').toUpperCase(),
      String(event.path||''),
      String(tok),
      String(deviceId||''),
      String(tsNum),
      n,
      bodyHash
    ].join('\n');

    let okSig = false;
    try{ okSig = await verifyEcdsaUtf8(row.user_pubkey_jwk, canonical, sig); }catch(_){ okSig = false; }
    if(!okSig) return { resp: bad(event, 403, 'token-binding-failed') };

    const nonceTtlSec = Number(tb.nonceTtlSec || 600);
    try{
      const fresh = await storeNonce(row.org_id, row.user_id, n, nonceTtlSec);
      if(!fresh) return { resp: bad(event, 409, 'replay-detected') };
    }catch(_){
      return { resp: bad(event, 500, 'db-error') };
    }
  }

  return {
    ctx: {
      token,
      bearer: tok,
      orgId: row.org_id,
      userId: row.user_id,
      role: row.user_role,
      deviceId: deviceId || null,
      policy,
      orgTokenVersion: orgTv,
      userTokenVersion: userTv
    }
  };
}

module.exports = { requireCtx, stableJson, sha256B64UrlUtf8, b64url };
