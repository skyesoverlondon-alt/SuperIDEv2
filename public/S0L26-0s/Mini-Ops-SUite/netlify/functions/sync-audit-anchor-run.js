const { tx, query } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { dayBoundsUTC, computeDailyRoot } = require('./_anchor');
const { kmsSignDigest } = require('./_kms');
const { auditTx } = require('./_audit');

function utcDayString(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const da = String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const token = authUser(event);
  const runToken = (event.headers && (event.headers['x-anchor-token'] || event.headers['X-Anchor-Token'])) || '';

  // Allow scheduled/manual runs via shared secret.
  const allowSecret = process.env.ANCHOR_RUN_TOKEN && String(runToken) === String(process.env.ANCHOR_RUN_TOKEN);

  if(!allowSecret){
    if(!token) return bad(event, 401, 'unauthorized');
    if(!requireRole(token, 'admin')) return bad(event, 403, 'forbidden');
  }

  const body = json(event) || {};
  const orgId = allowSecret ? String(body.orgId||'').trim() : token.orgId;
  if(!orgId) return bad(event, 400, 'orgId-required');

  // Default: anchor yesterday (most common operational pattern)
  const day = String(body.day||'').trim() || utcDayString(new Date(Date.now() - 24*3600*1000));

  try{
    const { start, end } = dayBoundsUTC(day);

    const rows = await query(
      'SELECT hash FROM sync_audit WHERE org_id=$1 AND created_at >= $2 AND created_at < $3 ORDER BY id ASC',
      [orgId, start.toISOString(), end.toISOString()]
    );

    const hashes = rows.rows.map(r=>String(r.hash||'')).filter(Boolean);
    const { rootHash, digestBytes } = computeDailyRoot(hashes);

    const sig = await kmsSignDigest(digestBytes, {});

    const out = await tx(async (client)=>{
      const ins = await client.query(
        `INSERT INTO sync_audit_anchors(org_id, day, root_hash, alg, key_id, signature_b64)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (org_id, day) DO UPDATE SET
           root_hash=excluded.root_hash,
           alg=excluded.alg,
           key_id=excluded.key_id,
           signature_b64=excluded.signature_b64,
           created_at=now()
         RETURNING org_id, day, root_hash, alg, key_id, signature_b64, created_at`,
        [orgId, day, rootHash, sig.alg, sig.keyId, sig.signatureB64]
      );

      try{
        await auditTx(client, event, { orgId, userId: token ? token.sub : null, deviceId: token ? (token.did||null) : null, action:'audit.anchor', severity:'info', detail:{ day, count: hashes.length, signer:'aws-kms' } });
      }catch(_){ /* ignore */ }

      return ins.rows[0];
    });

    return ok(event, { ok:true, anchor: out, auditCount: hashes.length });
  }catch(e){
    return bad(event, 500, 'anchor-failed');
  }
};
