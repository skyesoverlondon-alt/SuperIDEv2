import pg from 'pg';
const { Pool } = pg;

let pool;

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

export async function listProjects(ownerKey) {
  const current = getPool();
  if (!current) return null;
  const result = await current.query(
    `select id, title, payload, created_at, updated_at
     from creator_projects
     where owner_key = $1
     order by updated_at desc`,
    [ownerKey]
  );
  return result.rows.map((row) => ({
    ...row.payload,
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function saveProject(ownerKey, project) {
  const current = getPool();
  if (!current) return null;
  const result = await current.query(
    `insert into creator_projects (id, owner_key, title, payload)
     values ($1, $2, $3, $4::jsonb)
     on conflict (id)
     do update set
       owner_key = excluded.owner_key,
       title = excluded.title,
       payload = excluded.payload,
       updated_at = now()
     returning id, updated_at`,
    [project.id, ownerKey, project.title || 'Untitled Project', JSON.stringify(project)]
  );
  return result.rows[0];
}
