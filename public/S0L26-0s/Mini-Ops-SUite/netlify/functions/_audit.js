const crypto = require('crypto');
const { getReqId, getClientIp, getUserAgent } = require('./_security');

function b64url(buf){
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function stableJson(v){
  // Very small stable stringify: sorts object keys recursively.
  if(v === null || v === undefined) return 'null';
  if(typeof v !== 'object') return JSON.stringify(v);
  if(Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}

async function auditTx(client, event, {orgId, userId, deviceId, action, severity='info', detail={}}){
  const reqId = getReqId(event);
  const ip = getClientIp(event);
  const ua = getUserAgent(event);
  const ts = new Date().toISOString();

  // Serialize audit chain per org to prevent forked chains under concurrency.
  try{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(orgId||'')]);
  }catch(_){ /* ignore */ }

  const prev = await client.query('SELECT id, hash FROM sync_audit WHERE org_id=$1 ORDER BY id DESC LIMIT 1', [orgId]);
  const prevHash = (prev.rowCount===1 && prev.rows[0].hash) ? String(prev.rows[0].hash) : '';

  const payload = {
    orgId: String(orgId||''),
    userId: userId ? String(userId) : '',
    deviceId: deviceId ? String(deviceId) : '',
    action: String(action||''),
    severity: String(severity||'info'),
    detail: detail || {},
    reqId,
    ip,
    ua,
    ts,
    prevHash
  };

  const hash = b64url(crypto.createHash('sha256').update(stableJson(payload)).digest());

  await client.query(
    'INSERT INTO sync_audit(org_id,user_id,device_id,action,severity,detail,req_id,ip,ua,prev_hash,hash,event_ts,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())',
    [orgId || null, userId || null, deviceId || null, action, severity, detail || {}, reqId, ip || null, ua || null, prevHash || null, hash, ts]
  );

  return { hash, prevHash, reqId, ip, ua, ts };
}

module.exports = { auditTx };
