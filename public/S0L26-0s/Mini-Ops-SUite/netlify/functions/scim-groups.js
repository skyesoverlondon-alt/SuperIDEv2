const { tx, query } = require('./_db');
const { authScim, scimResp, scimError } = require('./_scim');
const { uuid } = require('./_util');

function parseJson(event){
  try{
    const b = event.body ? (event.isBase64Encoded ? Buffer.from(event.body,'base64').toString('utf8') : event.body) : '';
    return b ? JSON.parse(b) : {};
  }catch(_){ return null; }
}

function getIdFromPath(event){
  const p = String(event.path||'');
  const m = p.match(/\/Groups\/([^\/]+)$/);
  return m ? decodeURIComponent(m[1]) : '';
}

function inferMapping(displayName){
  const dn = String(displayName||'').trim();
  const mRole = dn.match(/^role\s*:\s*(viewer|editor|admin|owner)$/i);
  if(mRole) return { type:'role', role: mRole[1].toLowerCase() };
  const mVault = dn.match(/^vault\s*:\s*([^:]+)\s*:\s*(viewer|editor)$/i);
  if(mVault) return { type:'vault', vaultKey: mVault[1].trim(), perm: mVault[2].toLowerCase() };
  return {};
}

function toGroupRow(r, members){
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: String(r.id),
    externalId: r.external_id || undefined,
    displayName: r.display_name,
    members: (members||[]).map(u=>({ value: String(u.user_id), display: u.name || u.email || String(u.user_id) })),
    meta: { resourceType:'Group', created: r.created_at, lastModified: r.updated_at }
  };
}

const ROLE_ORDER = ['viewer','editor','admin','owner'];
function roleRank(r){ return Math.max(0, ROLE_ORDER.indexOf(String(r||'viewer'))); }

async function applyGroupEffects(client, orgId, groupId){
  // Fetch group + members
  const g = await client.query('SELECT id, display_name, mapping FROM sync_scim_groups WHERE org_id=$1 AND id=$2', [orgId, groupId]);
  if(g.rowCount !== 1) return;
  const mapping = g.rows[0].mapping || {};
  const mem = await client.query('SELECT user_id FROM sync_scim_group_members WHERE group_id=$1', [groupId]);
  const members = mem.rows.map(x=>String(x.user_id));

  // Role mapping: recompute role for each member based on all role:* groups
  if(mapping.type === 'role' && mapping.role){
    const role = String(mapping.role);
    if(ROLE_ORDER.includes(role)){
      for(const uid of members){
        // max across all role groups
        const rr = await client.query(
          `SELECT g.mapping->>'role' as role
           FROM sync_scim_group_members gm
           JOIN sync_scim_groups g ON g.id=gm.group_id
           WHERE g.org_id=$1 AND gm.user_id=$2 AND (g.mapping->>'type')='role'`,
          [orgId, uid]
        );
        let best = 'viewer';
        for(const r of rr.rows){
          const ro = String(r.role||'').toLowerCase();
          if(ROLE_ORDER.includes(ro) && roleRank(ro) > roleRank(best)) best = ro;
        }
        // Never downgrade an owner implicitly.
        const cur = await client.query('SELECT role FROM sync_users WHERE org_id=$1 AND id=$2', [orgId, uid]);
        if(cur.rowCount === 1){
          const curRole = String(cur.rows[0].role||'viewer');
          let next = best;
          if(curRole === 'owner') next = 'owner';
          await client.query('UPDATE sync_users SET role=$1 WHERE org_id=$2 AND id=$3', [next, orgId, uid]);
        }
      }
    }
  }

  // Vault mapping: enforce access for members
  if(mapping.type === 'vault' && mapping.vaultKey && mapping.perm){
    const vaultKey = String(mapping.vaultKey).trim();
    const perm = (String(mapping.perm).toLowerCase()==='editor') ? 'editor' : 'viewer';
    if(vaultKey){
      // Mark restricted if any vault groups exist
      await client.query('UPDATE sync_vault_keys SET restricted=true WHERE org_id=$1 AND vault_key=$2', [orgId, vaultKey]);

      // Upsert access for each member
      for(const uid of members){
        await client.query(
          `INSERT INTO sync_vault_access(org_id,vault_key,user_id,perm,created_by)
           VALUES($1,$2,$3,$4,null)
           ON CONFLICT (org_id,vault_key,user_id) DO UPDATE SET perm=excluded.perm`,
          [orgId, vaultKey, uid, perm]
        );
      }

      // Remove scim-managed grants for users no longer in group
      await client.query(
        `DELETE FROM sync_vault_access
         WHERE org_id=$1 AND vault_key=$2 AND created_by is null AND user_id NOT IN (
           SELECT user_id FROM sync_scim_group_members WHERE group_id=$3
         )`,
        [orgId, vaultKey, groupId]
      );
    }
  }
}

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
      const total = await query('SELECT count(*)::int as n FROM sync_scim_groups WHERE org_id=$1', [scim.orgId]);
      const rows = await query('SELECT id, display_name, external_id, mapping, created_at, updated_at FROM sync_scim_groups WHERE org_id=$1 ORDER BY created_at DESC OFFSET $2 LIMIT $3', [scim.orgId, offset, count]);
      const resources = [];
      for(const g of rows.rows){
        const mem = await query('SELECT u.id as user_id, u.name, u.email FROM sync_scim_group_members gm JOIN sync_users u ON u.id=gm.user_id WHERE gm.group_id=$1', [g.id]);
        resources.push(toGroupRow(g, mem.rows));
      }
      return scimResp(200, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: total.rows[0].n,
        startIndex,
        itemsPerPage: rows.rowCount,
        Resources: resources
      });
    }

    if(method === 'GET' && id){
      const g = await query('SELECT id, display_name, external_id, mapping, created_at, updated_at FROM sync_scim_groups WHERE org_id=$1 AND id=$2', [scim.orgId, id]);
      if(g.rowCount !== 1) return scimError(404, 'Not found');
      const mem = await query('SELECT u.id as user_id, u.name, u.email FROM sync_scim_group_members gm JOIN sync_users u ON u.id=gm.user_id WHERE gm.group_id=$1', [id]);
      return scimResp(200, toGroupRow(g.rows[0], mem.rows));
    }

    if(method === 'POST' && !id){
      const body = parseJson(event);
      if(!body) return scimError(400, 'Bad JSON', 'invalidSyntax');
      const displayName = String(body.displayName||'').trim();
      if(!displayName) return scimError(400, 'displayName required', 'invalidValue');

      const groupId = uuid();
      const mapping = Object.assign(inferMapping(displayName), (body.mapping && typeof body.mapping==='object' ? body.mapping : {}));
      const members = Array.isArray(body.members) ? body.members : [];

      await tx(async (client)=>{
        await client.query('INSERT INTO sync_scim_groups(id,org_id,display_name,external_id,mapping) VALUES($1,$2,$3,$4,$5)', [groupId, scim.orgId, displayName, body.externalId ? String(body.externalId).slice(0,200) : null, mapping]);
        for(const m of members){
          const uid = m && m.value ? String(m.value) : '';
          if(!uid) continue;
          await client.query('INSERT INTO sync_scim_group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [groupId, uid]);
        }
        await applyGroupEffects(client, scim.orgId, groupId);
      });

      const g = await query('SELECT id, display_name, external_id, mapping, created_at, updated_at FROM sync_scim_groups WHERE org_id=$1 AND id=$2', [scim.orgId, groupId]);
      const mem = await query('SELECT u.id as user_id, u.name, u.email FROM sync_scim_group_members gm JOIN sync_users u ON u.id=gm.user_id WHERE gm.group_id=$1', [groupId]);
      return scimResp(201, toGroupRow(g.rows[0], mem.rows));
    }

    if((method === 'PUT' || method === 'PATCH') && id){
      const body = parseJson(event);
      if(!body) return scimError(400, 'Bad JSON', 'invalidSyntax');

      const exists = await query('SELECT id FROM sync_scim_groups WHERE org_id=$1 AND id=$2', [scim.orgId, id]);
      if(exists.rowCount !== 1) return scimError(404, 'Not found');

      const displayName = body.displayName ? String(body.displayName).trim() : null;
      const externalId = body.externalId ? String(body.externalId).slice(0,200) : null;
      const members = Array.isArray(body.members) ? body.members : null;

      await tx(async (client)=>{
        if(displayName){
          const mapping = Object.assign(inferMapping(displayName), (body.mapping && typeof body.mapping==='object' ? body.mapping : {}));
          await client.query('UPDATE sync_scim_groups SET display_name=$1, mapping=$2, updated_at=now() WHERE org_id=$3 AND id=$4', [displayName, mapping, scim.orgId, id]);
        }
        if(externalId){
          await client.query('UPDATE sync_scim_groups SET external_id=$1, updated_at=now() WHERE org_id=$2 AND id=$3', [externalId, scim.orgId, id]);
        }
        if(members !== null){
          await client.query('DELETE FROM sync_scim_group_members WHERE group_id=$1', [id]);
          for(const m of members){
            const uid = m && m.value ? String(m.value) : '';
            if(!uid) continue;
            await client.query('INSERT INTO sync_scim_group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, uid]);
          }
        }
        await applyGroupEffects(client, scim.orgId, id);
      });

      const g = await query('SELECT id, display_name, external_id, mapping, created_at, updated_at FROM sync_scim_groups WHERE org_id=$1 AND id=$2', [scim.orgId, id]);
      const mem = await query('SELECT u.id as user_id, u.name, u.email FROM sync_scim_group_members gm JOIN sync_users u ON u.id=gm.user_id WHERE gm.group_id=$1', [id]);
      return scimResp(200, toGroupRow(g.rows[0], mem.rows));
    }

    if(method === 'DELETE' && id){
      const exists = await query('SELECT id FROM sync_scim_groups WHERE org_id=$1 AND id=$2', [scim.orgId, id]);
      if(exists.rowCount !== 1) return scimError(404, 'Not found');
      await tx(async (client)=>{
        await client.query('DELETE FROM sync_scim_groups WHERE org_id=$1 AND id=$2', [scim.orgId, id]);
      });
      return { statusCode: 204, headers:{'Cache-Control':'no-store'}, body:'' };
    }

    return scimError(405, 'Method not allowed');
  }catch(e){
    return scimError(500, 'Server error');
  }
};
