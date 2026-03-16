const { tx, query } = require('./_db');
const { authScim, scimResp, scimError } = require('./_scim');
const { uuid } = require('./_util');
const { deprovisionUserTx } = require('./_deprovision');

function parseJson(event){
  try{
    const b = event.body ? (event.isBase64Encoded ? Buffer.from(event.body,'base64').toString('utf8') : event.body) : '';
    return b ? JSON.parse(b) : {};
  }catch(_){ return null; }
}

function getIdFromPath(event){
  const p = String(event.path||'');
  const m = p.match(/\/Users\/([^\/]+)$/);
  return m ? decodeURIComponent(m[1]) : '';
}

function toUserRow(r){
  const email = r.email || '';
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: String(r.id),
    externalId: r.external_id || undefined,
    userName: email || String(r.id),
    displayName: r.name || email || String(r.id),
    name: { formatted: r.name || '' },
    emails: email ? [{ value: email, primary: true }] : [],
    active: (r.status === 'active'),
    meta: {
      resourceType: 'User',
      created: r.created_at,
      lastModified: r.last_login_at || r.created_at
    }
  };
}

const DUMMY_JWK = { kty:'EC', crv:'P-256', x:'0', y:'0' };

exports.handler = async (event) => {
  const scim = await authScim(event);
  if(!scim) return scimError(401, 'Unauthorized', 'invalidToken');

  const method = String(event.httpMethod||'GET').toUpperCase();
  const id = getIdFromPath(event);

  const qs = event.queryStringParameters || {};
  const startIndex = Math.max(1, Math.floor(Number(qs.startIndex||1)));
  const count = Math.max(1, Math.min(200, Math.floor(Number(qs.count||100))));

  try{
    if(method === 'GET' && !id){
      const offset = startIndex - 1;
      const total = await query('SELECT count(*)::int as n FROM sync_users WHERE org_id=$1', [scim.orgId]);
      const rows = await query('SELECT id, name, email, external_id, status, created_at, last_login_at FROM sync_users WHERE org_id=$1 ORDER BY created_at DESC OFFSET $2 LIMIT $3', [scim.orgId, offset, count]);
      return scimResp(200, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: total.rows[0].n,
        startIndex,
        itemsPerPage: rows.rowCount,
        Resources: rows.rows.map(toUserRow)
      });
    }

    if(method === 'GET' && id){
      const r = await query('SELECT id, name, email, external_id, status, created_at, last_login_at FROM sync_users WHERE org_id=$1 AND id=$2', [scim.orgId, id]);
      if(r.rowCount !== 1) return scimError(404, 'Not found');
      return scimResp(200, toUserRow(r.rows[0]));
    }

    if(method === 'POST' && !id){
      const body = parseJson(event);
      if(!body) return scimError(400, 'Bad JSON', 'invalidSyntax');
      const email = String(body.userName || (body.emails && body.emails[0] && body.emails[0].value) || '').trim();
      const name = String(body.displayName || (body.name && (body.name.formatted || body.name.givenName)) || '').trim();
      const active = (body.active !== false);
      if(!email) return scimError(400, 'userName/email required', 'invalidValue');

      await tx(async (client)=>{
        const ex = await client.query('SELECT id FROM sync_users WHERE org_id=$1 AND lower(email)=lower($2) LIMIT 1', [scim.orgId, email]);
        if(ex.rowCount === 1){
          const uid = ex.rows[0].id;
          await client.query('UPDATE sync_users SET name=COALESCE($1,name), status=$2, revoked_at=CASE WHEN $2<>\'active\' THEN now() ELSE null END, external_id=COALESCE($3,external_id) WHERE id=$4', [name||null, active?'active':'revoked', body.externalId ? String(body.externalId).slice(0,200) : null, uid]);
        } else {
          const userId = uuid();
          await client.query(
            'INSERT INTO sync_users(id,org_id,name,role,pubkey_jwk,enc_pubkey_jwk,status,email,external_id,sso_provider) VALUES($1,$2,$3,\'viewer\',$4,$5,$6,$7,$8,\'scim\')',
            [userId, scim.orgId, name||null, DUMMY_JWK, DUMMY_JWK, active?'active':'revoked', email, body.externalId ? String(body.externalId).slice(0,200) : null]
          );
        }
      });

      const r = await query('SELECT id, name, email, external_id, status, created_at, last_login_at FROM sync_users WHERE org_id=$1 AND lower(email)=lower($2) LIMIT 1', [scim.orgId, email]);
      return scimResp(201, toUserRow(r.rows[0]));
    }

    if((method === 'PUT' || method === 'PATCH') && id){
      const body = parseJson(event);
      if(!body) return scimError(400, 'Bad JSON', 'invalidSyntax');

      const r0 = await query('SELECT id FROM sync_users WHERE org_id=$1 AND id=$2', [scim.orgId, id]);
      if(r0.rowCount !== 1) return scimError(404, 'Not found');

      const email = String(body.userName || (body.emails && body.emails[0] && body.emails[0].value) || '').trim();
      const name = String(body.displayName || (body.name && (body.name.formatted || body.name.givenName)) || '').trim();
      const active = (body.active !== undefined) ? !!body.active : null;
      const externalId = body.externalId ? String(body.externalId).slice(0,200) : null;

      await tx(async (client)=>{
        if(email) await client.query('UPDATE sync_users SET email=$1 WHERE org_id=$2 AND id=$3', [email, scim.orgId, id]);
        if(name) await client.query('UPDATE sync_users SET name=$1 WHERE org_id=$2 AND id=$3', [name, scim.orgId, id]);
        if(externalId) await client.query('UPDATE sync_users SET external_id=$1 WHERE org_id=$2 AND id=$3', [externalId, scim.orgId, id]);
        if(active !== null){
          if(active){
            await client.query("UPDATE sync_users SET status='active', revoked_at=null WHERE org_id=$1 AND id=$2", [scim.orgId, id]);
          } else {
            await deprovisionUserTx(client, event, { orgId: scim.orgId, targetUserId: id, byUserId: null, deviceId: null, source:'scim', reason:'scim-active-false' });
          }
        }
      });

      const r = await query('SELECT id, name, email, external_id, status, created_at, last_login_at FROM sync_users WHERE org_id=$1 AND id=$2', [scim.orgId, id]);
      return scimResp(200, toUserRow(r.rows[0]));
    }

    if(method === 'DELETE' && id){
      const r0 = await query('SELECT id FROM sync_users WHERE org_id=$1 AND id=$2', [scim.orgId, id]);
      if(r0.rowCount !== 1) return scimError(404, 'Not found');
      await tx(async (client)=>{ await deprovisionUserTx(client, event, { orgId: scim.orgId, targetUserId: id, byUserId:null, deviceId:null, source:'scim', reason:'scim-delete' }); });
      return { statusCode: 204, headers:{'Cache-Control':'no-store'}, body:'' };
    }

    return scimError(405, 'Method not allowed');
  }catch(e){
    return scimError(500, 'Server error');
  }
};
