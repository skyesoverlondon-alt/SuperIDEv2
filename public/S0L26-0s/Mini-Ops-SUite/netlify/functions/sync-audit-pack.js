const crypto = require('crypto');
const { tx, query } = require('./_db');
const { json, ok, bad, preflight } = require('./_util');
const { requireCtx, stableJson, b64url } = require('./_authz');

const { zipSync, strToU8 } = require('fflate');

function sha256Hex(buf){
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256B64UrlUtf8(s){
  const h = crypto.createHash('sha256').update(Buffer.from(String(s||''), 'utf8')).digest();
  return b64url(h);
}

function computeAuditHash(evt){
  // Must match _audit.js payload hashing (stableJson + sha256 + base64url)
  const payload = {
    orgId: String(evt.org_id||''),
    userId: evt.user_id ? String(evt.user_id) : '',
    deviceId: evt.device_id ? String(evt.device_id) : '',
    action: String(evt.action||''),
    severity: String(evt.severity||'info'),
    detail: evt.detail || {},
    reqId: evt.req_id ? String(evt.req_id) : '',
    ip: evt.ip ? String(evt.ip) : '',
    ua: evt.ua ? String(evt.ua) : '',
    ts: String(evt.event_ts||''),
    prevHash: evt.prev_hash ? String(evt.prev_hash) : ''
  };
  return sha256B64UrlUtf8(stableJson(payload));
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole:'admin' });
  if(auth.resp) return auth.resp;
  const ctx = auth.ctx;

  const body = json(event) || {};
  const actionPrefix = body.actionPrefix ? String(body.actionPrefix).slice(0,120) : '';
  const startId = body.startId ? Number(body.startId) : null;
  const endId = body.endId ? Number(body.endId) : null;

  try{
    const org = await query('SELECT id, policy, token_version, key_epoch, key_model FROM sync_orgs WHERE id=$1', [ctx.orgId]);
    if(org.rowCount !== 1) return bad(event, 404, 'org-not-found');

    const anchors = await query('SELECT id, day, root_hash, alg, key_id, signature_b64, created_at FROM sync_audit_anchors WHERE org_id=$1 ORDER BY day DESC LIMIT 4000', [ctx.orgId]);

    const where = ['org_id=$1'];
    const params = [ctx.orgId];
    let p = 2;
    if(actionPrefix){
      where.push(`action LIKE $${p++}`);
      params.push(actionPrefix + '%');
    }
    if(startId && Number.isFinite(startId)){
      where.push(`id >= $${p++}`); params.push(Math.floor(startId));
    }
    if(endId && Number.isFinite(endId)){
      where.push(`id <= $${p++}`); params.push(Math.floor(endId));
    }

    const rows = await query(
      `SELECT id, org_id, user_id, device_id, action, severity, detail, req_id, ip, ua, prev_hash, hash, event_ts, created_at
       FROM sync_audit
       WHERE ${where.join(' AND ')}
       ORDER BY id ASC`,
      params
    );

    // Build JSONL + verify chain for verifiable rows (event_ts present)
    const outLines = [];
    let verify = { total: rows.rowCount, verifiable: 0, ok: 0, failed: 0, firstVerifiableId: null, lastVerifiableId: null, failures: [] };

    for(const r of rows.rows){
      outLines.push(JSON.stringify(r));
      if(r.event_ts){
        verify.verifiable += 1;
        if(verify.firstVerifiableId === null) verify.firstVerifiableId = r.id;
        verify.lastVerifiableId = r.id;

        const recomputed = computeAuditHash(r);
        const stored = String(r.hash||'');
        if(recomputed !== stored){
          verify.failed += 1;
          if(verify.failures.length < 50) verify.failures.push({ id:r.id, reason:'hash-mismatch', stored, recomputed });
        } else {
          verify.ok += 1;
        }
      }
    }

    const exportedAt = new Date().toISOString();
    const manifest = {};
    const files = {};

    const auditJsonl = outLines.join('\n') + '\n';
    files['audit/events.jsonl'] = strToU8(auditJsonl);
    manifest['audit/events.jsonl'] = { sha256: sha256Hex(files['audit/events.jsonl']), bytes: files['audit/events.jsonl'].length };

    const verifyObj = {
      exportedAt,
      orgId: ctx.orgId,
      filter: { actionPrefix: actionPrefix || null, startId: startId || null, endId: endId || null },
      verification: verify,
      note: "Rows created before migrate_v11 may have event_ts=NULL and are not recomputable; verification covers verifiable rows only."
    };
    files['audit/verify.json'] = strToU8(JSON.stringify(verifyObj, null, 2));
    manifest['audit/verify.json'] = { sha256: sha256Hex(files['audit/verify.json']), bytes: files['audit/verify.json'].length };

    files['audit/anchors.json'] = strToU8(JSON.stringify({ exportedAt, anchors: anchors.rows }, null, 2));
    manifest['audit/anchors.json'] = { sha256: sha256Hex(files['audit/anchors.json']), bytes: files['audit/anchors.json'].length };

    files['org/policy.json'] = strToU8(JSON.stringify({ exportedAt, policy: org.rows[0].policy || {} }, null, 2));
    manifest['org/policy.json'] = { sha256: sha256Hex(files['org/policy.json']), bytes: files['org/policy.json'].length };

    const readme = [
      "SkyeSync Audit Proof Pack",
      "",
      "Contents:",
      "- audit/events.jsonl: append-only audit rows exported from server",
      "- audit/verify.json: verification summary + notes",
      "- audit/anchors.json: WORM daily anchors (if enabled/used)",
      "- org/policy.json: exported org policy snapshot",
      "- manifest.json: sha256 of each file for tamper evidence",
      "",
      "Offline verification:",
      "1) Confirm manifest.json hashes match file content (sha256).",
      "2) For rows with event_ts present, verify audit hash recomputation matches stored 'hash' and prev_hash chains as expected.",
      "",
      "Note:",
      "Rows created before migrate_v11 may not be recomputable because event_ts was not stored historically."
    ].join("\n");
    files['README.txt'] = strToU8(readme);
    manifest['README.txt'] = { sha256: sha256Hex(files['README.txt']), bytes: files['README.txt'].length };

    files['manifest.json'] = strToU8(JSON.stringify({ exportedAt, files: manifest }, null, 2));
    manifest['manifest.json'] = { sha256: sha256Hex(files['manifest.json']), bytes: files['manifest.json'].length };

    const zipped = zipSync(files, { level: 6 });
    const zipB64 = Buffer.from(zipped).toString('base64');
    const zipSha256 = sha256Hex(zipped);

    const ts = exportedAt.replace(/[:.]/g,'-');
    const filename = `skye-audit-proofpack-${ctx.orgId}-${ts}.zip`;

    return ok(event, { ok:true, filename, zipB64, sha256: zipSha256, verify });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
