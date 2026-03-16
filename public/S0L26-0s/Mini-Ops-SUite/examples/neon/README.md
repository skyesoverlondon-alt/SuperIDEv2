# Neon / Postgres setup

1) Create a Neon Postgres project
2) Open the SQL editor
3) Run `../../sql/sync_schema.sql`
4) If upgrading, run migrations up to the latest (currently `../../sql/migrate_v8.sql`)
5) Copy your connection string into Netlify as `DATABASE_URL`

