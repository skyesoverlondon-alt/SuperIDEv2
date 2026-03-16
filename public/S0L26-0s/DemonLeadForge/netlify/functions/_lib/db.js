import { neon } from '@neondatabase/serverless';
import { makeId } from './http.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('DATABASE_URL is not configured yet. Functions that need Neon will fail until it is set.');
}

export const sql = databaseUrl ? neon(databaseUrl) : null;

let schemaPromise;

export async function ensureSchema() {
  if (!sql) throw new Error('DATABASE_URL is not configured.');
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await sql(`
      CREATE TABLE IF NOT EXISTS app_users (
        identity_uid TEXT PRIMARY KEY,
        email TEXT,
        full_name TEXT,
        user_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        app_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_ip TEXT
      );
    `);

    await sql(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_identity_uid TEXT,
        title TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await sql(`
      CREATE TABLE IF NOT EXISTS sheets (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        owner_identity_uid TEXT,
        title TEXT NOT NULL,
        source_summary TEXT,
        source_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
        row_count INTEGER NOT NULL DEFAULT 0,
        blob_json_key TEXT,
        blob_csv_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await sql(`
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
        business_name TEXT,
        contact_name TEXT,
        emails JSONB NOT NULL DEFAULT '[]'::jsonb,
        phones JSONB NOT NULL DEFAULT '[]'::jsonb,
        websites JSONB NOT NULL DEFAULT '[]'::jsonb,
        address TEXT,
        page_title TEXT,
        source_url TEXT,
        notes TEXT,
        raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await sql(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        owner_identity_uid TEXT,
        title TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await sql(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await sql(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_identity_uid TEXT,
        event_type TEXT NOT NULL,
        summary TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await sql(`CREATE INDEX IF NOT EXISTS idx_sheets_owner_project ON sheets(owner_identity_uid, project_id, created_at DESC);`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_leads_sheet ON leads(sheet_id);`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_threads_owner_project ON threads(owner_identity_uid, project_id, updated_at DESC);`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at);`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);`);
  })();

  return schemaPromise;
}

export async function logAudit({ actorIdentityUid = null, eventType, summary = '', payload = {} }) {
  await ensureSchema();
  await sql`
    INSERT INTO audit_events (id, actor_identity_uid, event_type, summary, payload)
    VALUES (${makeId('audit')}, ${actorIdentityUid}, ${eventType}, ${summary}, ${JSON.stringify(payload)}::jsonb)
  `;
}

export async function upsertUser({ identityUid, email = '', fullName = '', userMetadata = {}, appMetadata = {}, rawJson = {}, lastIp = '' }) {
  await ensureSchema();
  await sql`
    INSERT INTO app_users (identity_uid, email, full_name, user_metadata, app_metadata, raw_json, last_ip)
    VALUES (
      ${identityUid},
      ${email},
      ${fullName},
      ${JSON.stringify(userMetadata)}::jsonb,
      ${JSON.stringify(appMetadata)}::jsonb,
      ${JSON.stringify(rawJson)}::jsonb,
      ${lastIp}
    )
    ON CONFLICT (identity_uid)
    DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      user_metadata = EXCLUDED.user_metadata,
      app_metadata = EXCLUDED.app_metadata,
      raw_json = EXCLUDED.raw_json,
      last_seen_at = NOW(),
      last_ip = EXCLUDED.last_ip
  `;
}

export async function ensureDefaultProject(identityUid) {
  await ensureSchema();
  const existing = await sql`
    SELECT id, title, description, created_at, updated_at
    FROM projects
    WHERE owner_identity_uid = ${identityUid}
    ORDER BY created_at ASC
    LIMIT 1
  `;

  if (existing.length) return existing[0];

  const project = {
    id: makeId('project'),
    title: 'Command Deck',
    description: 'Default project space for lead generation, sheet storage, and AI threads.'
  };

  await sql`
    INSERT INTO projects (id, owner_identity_uid, title, description)
    VALUES (${project.id}, ${identityUid}, ${project.title}, ${project.description})
  `;

  return project;
}

export async function ensureThread({ ownerIdentityUid, projectId, threadId = null, title = 'Lead Command Thread' }) {
  await ensureSchema();

  if (threadId) {
    const existing = await sql`
      SELECT id, project_id, owner_identity_uid, title, created_at, updated_at
      FROM threads
      WHERE id = ${threadId}
      LIMIT 1
    `;
    if (existing.length) return existing[0];
  }

  const created = {
    id: makeId('thread'),
    projectId,
    ownerIdentityUid,
    title
  };

  await sql`
    INSERT INTO threads (id, project_id, owner_identity_uid, title)
    VALUES (${created.id}, ${created.projectId}, ${created.ownerIdentityUid}, ${created.title})
  `;

  return {
    id: created.id,
    project_id: created.projectId,
    owner_identity_uid: created.ownerIdentityUid,
    title: created.title
  };
}

export async function appendMessage({ threadId, role, content, metadata = {} }) {
  await ensureSchema();
  await sql`
    INSERT INTO messages (id, thread_id, role, content, metadata)
    VALUES (${makeId('msg')}, ${threadId}, ${role}, ${content}, ${JSON.stringify(metadata)}::jsonb)
  `;

  await sql`
    UPDATE threads
    SET updated_at = NOW()
    WHERE id = ${threadId}
  `;
}
