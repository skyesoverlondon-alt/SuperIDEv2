const { tx } = require('./_db');
const { json, ok, bad, preflight } = require('./_util');
const { requireCtx, stableJson, sha256B64UrlUtf8 } = require('./_authz');
const { evalPosture } = require('./_posture');
const { auditTx } = require('./_audit');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole:'viewer', skipPosture:true });
  if(auth.resp) return auth.resp;
  const ctx = auth.ctx;

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const posture = body.posture;
  if(!posture || typeof posture !== 'object') return bad(event, 400, 'posture-required');

  const dp = (ctx.policy.devicePosture && typeof ctx.policy.devicePosture === 'object') ? ctx.policy.devicePosture : {};
  const ev = evalPosture(posture, dp);
  const postureHash = sha256B64UrlUtf8(stableJson(ev.normalized || posture));

  try{
    await tx(async (client)=>{
      await client.query(
        `INSERT INTO sync_device_posture(org_id,user_id,device_id,posture,posture_hash,status,reasons,assessed_at,last_seen_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,now(),now())
         ON CONFLICT (org_id,user_id,device_id) DO UPDATE SET
           posture=excluded.posture,
           posture_hash=excluded.posture_hash,
           status=excluded.status,
           reasons=excluded.reasons,
           assessed_at=now(),
           last_seen_at=now()`,
        [ctx.orgId, ctx.userId, ctx.deviceId || '', ev.normalized || posture, postureHash, ev.status, ev.reasons]
      );

      await auditTx(client, event, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        deviceId: ctx.deviceId || null,
        action: 'posture.submit',
        severity: (ev.status === 'compliant') ? 'info' : 'warn',
        detail: { status: ev.status, reasons: ev.reasons }
      });
    });

    return ok(event, { ok:true, status: ev.status, reasons: ev.reasons, postureHash });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
