const crypto = require('crypto');

function getReqId(event){
  const h = event.headers || {};
  return String(h['x-nf-request-id'] || h['x-request-id'] || h['X-Request-Id'] || h['X-Nf-Request-Id'] || crypto.randomUUID());
}

function getClientIp(event){
  const h = event.headers || {};
  // Netlify commonly provides x-nf-client-connection-ip; fall back to x-forwarded-for.
  const ip = h['x-nf-client-connection-ip'] || h['X-Nf-Client-Connection-Ip'] || h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  if(!ip) return '';
  // x-forwarded-for can be a list.
  return String(ip).split(',')[0].trim();
}

function getUserAgent(event){
  const h = event.headers || {};
  return String(h['user-agent'] || h['User-Agent'] || '').slice(0, 300);
}

function _isIPv4(ip){
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip);
}

function _ipv4ToInt(ip){
  const parts = ip.split('.').map(n=>Number(n));
  if(parts.length !== 4) return null;
  for(const p of parts){ if(!Number.isInteger(p) || p < 0 || p > 255) return null; }
  // >>>0 forces unsigned
  return (((parts[0]<<24) | (parts[1]<<16) | (parts[2]<<8) | parts[3]) >>> 0);
}

function _expandIPv6(ip){
  // returns array of 8 16-bit ints or null
  ip = String(ip).trim();
  if(!ip) return null;
  // Strip zone id if present (e.g. fe80::1%lo0)
  ip = ip.split('%')[0];

  const hasDouble = ip.includes('::');
  let head = ip;
  let tail = '';
  if(hasDouble){
    const parts = ip.split('::');
    head = parts[0];
    tail = parts[1];
  }

  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];

  // Handle IPv4-embedded in tail (e.g. ::ffff:192.168.1.1)
  function parsePart(p){
    if(_isIPv4(p)){
      const v = _ipv4ToInt(p);
      if(v === null) return null;
      return [(v >>> 16) & 0xffff, v & 0xffff];
    }
    if(!/^[0-9a-fA-F]{1,4}$/.test(p)) return null;
    return [parseInt(p,16) & 0xffff];
  }

  const parts16 = [];
  for(const p of headParts){
    const a = parsePart(p);
    if(!a) return null;
    parts16.push(...a);
  }

  const tail16 = [];
  for(const p of tailParts){
    const a = parsePart(p);
    if(!a) return null;
    tail16.push(...a);
  }

  if(!hasDouble){
    if(parts16.length !== 8) return null;
    return parts16;
  }

  if(parts16.length + tail16.length > 8) return null;
  const zeros = new Array(8 - parts16.length - tail16.length).fill(0);
  return [...parts16, ...zeros, ...tail16];
}

function _ipv6ToBigInt(ip){
  const parts = _expandIPv6(ip);
  if(!parts) return null;
  let out = 0n;
  for(const p of parts){
    out = (out << 16n) + BigInt(p);
  }

  // Token binding (proof-of-possession)
  if(policy.tokenBinding && typeof policy.tokenBinding === 'object'){
    const t = policy.tokenBinding;
    const to = {};
    if(t.requireForApi !== undefined) to.requireForApi = !!t.requireForApi;
    if(t.maxSkewSec !== undefined){
      const v = Number(t.maxSkewSec);
      if(Number.isFinite(v) && v >= 15 && v <= 600) to.maxSkewSec = Math.floor(v);
    }
    if(t.nonceTtlSec !== undefined){
      const v = Number(t.nonceTtlSec);
      if(Number.isFinite(v) && v >= 60 && v <= 3600) to.nonceTtlSec = Math.floor(v);
    }
    if(Object.keys(to).length) out.tokenBinding = to;
  }

  // Device posture checks
  if(policy.devicePosture && typeof policy.devicePosture === 'object'){
    const d = policy.devicePosture;
    const do2 = {};
    if(d.requireForApi !== undefined) do2.requireForApi = !!d.requireForApi;
    if(d.maxAgeSec !== undefined){
      const v = Number(d.maxAgeSec);
      if(Number.isFinite(v) && v >= 60 && v <= (7*24*3600)) do2.maxAgeSec = Math.floor(v);
    }
    if(d.requireSecureContext !== undefined) do2.requireSecureContext = !!d.requireSecureContext;
    if(d.requireWebAuthn !== undefined) do2.requireWebAuthn = !!d.requireWebAuthn;
    if(d.minBrowserMajor !== undefined){
      const v = Number(d.minBrowserMajor);
      if(Number.isFinite(v) && v >= 0 && v <= 999) do2.minBrowserMajor = Math.floor(v);
    }
    if(Array.isArray(d.allowedPlatforms)) do2.allowedPlatforms = d.allowedPlatforms.map(String).map(x=>x.trim()).filter(Boolean).slice(0,100);
    if(Object.keys(do2).length) out.devicePosture = do2;
  }




  // WebAuthn (hardware-backed key attestation)
  if(policy.webauthn && typeof policy.webauthn === 'object'){
    const w = policy.webauthn;
    const wo = {};
    if(w.requireForLogin !== undefined) wo.requireForLogin = !!w.requireForLogin;
    if(w.enforceEnrollment !== undefined) wo.enforceEnrollment = !!w.enforceEnrollment;

    if(w.userVerification){
      const uv = String(w.userVerification).toLowerCase();
      if(['required','preferred','discouraged'].includes(uv)) wo.userVerification = uv;
    }

    if(w.attestation){
      const at = String(w.attestation).toLowerCase();
      if(['none','direct','indirect','enterprise'].includes(at)) wo.attestation = at;
    }

    if(Array.isArray(w.allowedAAGUIDs)){
      wo.allowedAAGUIDs = w.allowedAAGUIDs.map(String).map(s=>s.trim()).filter(Boolean).slice(0, 100);
    }

    if(Object.keys(wo).length) out.webauthn = wo;
  }
  return out;
}

function _parseCidr(entry){
  const s = String(entry||'').trim();
  if(!s) return null;
  if(s.includes('/')){
    const [ip, bitsStr] = s.split('/');
    const bits = Number(bitsStr);
    if(!Number.isFinite(bits)) return null;
    return { ip: ip.trim(), bits };
  }
  return { ip: s, bits: null };
}

function ipInAllowlist(ip, allowlist){
  ip = String(ip||'').trim();
  if(!ip) return false;
  const list = Array.isArray(allowlist) ? allowlist : [];
  if(list.length === 0) return true; // no allowlist => allow

  const is4 = _isIPv4(ip);
  const ip4 = is4 ? _ipv4ToInt(ip) : null;
  const ip6 = !is4 ? _ipv6ToBigInt(ip) : null;

  for(const raw of list){
    const e = _parseCidr(raw);
    if(!e) continue;
    const t = e.ip;

    if(_isIPv4(t)){
      if(!is4) continue;
      const net = _ipv4ToInt(t);
      if(net === null) continue;
      if(e.bits === null){
        if(ip4 === net) return true;
      } else {
        const bits = Math.max(0, Math.min(32, e.bits));
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        if(((ip4 & mask) >>> 0) === ((net & mask) >>> 0)) return true;
      }
      continue;
    }

    // IPv6 exact or CIDR
    const net6 = _ipv6ToBigInt(t);
    if(net6 === null) continue;
    if(is4) continue;

    if(e.bits === null){
      if(ip6 === net6) return true;
    } else {
      const bits = Math.max(0, Math.min(128, e.bits));
      const shift = 128n - BigInt(bits);
      const mask = bits === 0 ? 0n : ((~0n) << shift) & ((1n<<128n)-1n);
      if((ip6 & mask) === (net6 & mask)) return true;
    }
  }

  return false;
}

function normalizePolicy(policy){
  if(!policy || typeof policy !== 'object') return {};
  const out = {};

  if(Array.isArray(policy.ipAllowlist)) out.ipAllowlist = policy.ipAllowlist.map(String).map(s=>s.trim()).filter(Boolean).slice(0, 200);

  if(policy.sessionTtlSec !== undefined){
    const v = Number(policy.sessionTtlSec);
    if(Number.isFinite(v) && v >= 300 && v <= (30*24*3600)) out.sessionTtlSec = Math.floor(v);
  }

  if(policy.maxCiphertextBytes !== undefined){
    const v = Number(policy.maxCiphertextBytes);
    if(Number.isFinite(v) && v >= 1_000_000 && v <= 20_000_000) out.maxCiphertextBytes = Math.floor(v);
  }

  if(policy.requireDeviceId !== undefined) out.requireDeviceId = !!policy.requireDeviceId;
  if(policy.requireIpAllowlist !== undefined) out.requireIpAllowlist = !!policy.requireIpAllowlist;

  if(policy.auditVaultReads !== undefined) out.auditVaultReads = !!policy.auditVaultReads;

  if(policy.auditRetentionDays !== undefined){
    const v = Number(policy.auditRetentionDays);
    if(Number.isFinite(v) && v >= 7 && v <= 3650) out.auditRetentionDays = Math.floor(v);
  }


  // Token binding (proof-of-possession)
  if(policy.tokenBinding && typeof policy.tokenBinding === 'object'){
    const t = policy.tokenBinding;
    const to = {};
    if(t.requireForApi !== undefined) to.requireForApi = !!t.requireForApi;
    if(t.maxSkewSec !== undefined){
      const v = Number(t.maxSkewSec);
      if(Number.isFinite(v) && v >= 15 && v <= 600) to.maxSkewSec = Math.floor(v);
    }
    if(t.nonceTtlSec !== undefined){
      const v = Number(t.nonceTtlSec);
      if(Number.isFinite(v) && v >= 60 && v <= 3600) to.nonceTtlSec = Math.floor(v);
    }
    if(Object.keys(to).length) out.tokenBinding = to;
  }

  // Device posture checks
  if(policy.devicePosture && typeof policy.devicePosture === 'object'){
    const d = policy.devicePosture;
    const do2 = {};
    if(d.requireForApi !== undefined) do2.requireForApi = !!d.requireForApi;
    if(d.maxAgeSec !== undefined){
      const v = Number(d.maxAgeSec);
      if(Number.isFinite(v) && v >= 60 && v <= (7*24*3600)) do2.maxAgeSec = Math.floor(v);
    }
    if(d.requireSecureContext !== undefined) do2.requireSecureContext = !!d.requireSecureContext;
    if(d.requireWebAuthn !== undefined) do2.requireWebAuthn = !!d.requireWebAuthn;
    if(d.minBrowserMajor !== undefined){
      const v = Number(d.minBrowserMajor);
      if(Number.isFinite(v) && v >= 0 && v <= 999) do2.minBrowserMajor = Math.floor(v);
    }
    if(Array.isArray(d.allowedPlatforms)) do2.allowedPlatforms = d.allowedPlatforms.map(String).map(x=>x.trim()).filter(Boolean).slice(0,100);
    if(Object.keys(do2).length) out.devicePosture = do2;
  }




  // WebAuthn (hardware-backed key attestation)
  if(policy.webauthn && typeof policy.webauthn === 'object'){
    const w = policy.webauthn;
    const wo = {};
    if(w.requireForLogin !== undefined) wo.requireForLogin = !!w.requireForLogin;
    if(w.enforceEnrollment !== undefined) wo.enforceEnrollment = !!w.enforceEnrollment;

    if(w.userVerification){
      const uv = String(w.userVerification).toLowerCase();
      if(['required','preferred','discouraged'].includes(uv)) wo.userVerification = uv;
    }

    if(w.attestation){
      const at = String(w.attestation).toLowerCase();
      if(['none','direct','indirect','enterprise'].includes(at)) wo.attestation = at;
    }

    if(Array.isArray(w.allowedAAGUIDs)){
      wo.allowedAAGUIDs = w.allowedAAGUIDs.map(String).map(s=>s.trim()).filter(Boolean).slice(0, 100);
    }

    if(Object.keys(wo).length) out.webauthn = wo;
  }
  return out;
}

module.exports = {
  getReqId,
  getClientIp,
  getUserAgent,
  ipInAllowlist,
  normalizePolicy
};
