create table if not exists creator_projects (
  id text primary key,
  owner_key text not null,
  title text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_projects_owner_key_idx on creator_projects (owner_key);
create index if not exists creator_projects_updated_at_idx on creator_projects (updated_at desc);

create table if not exists creator_render_jobs (
  id text primary key,
  project_id text not null,
  episode_id text not null,
  owner_key text not null,
  status text not null,
  kind text not null,
  filename text,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_render_jobs_owner_key_idx on creator_render_jobs (owner_key);
create index if not exists creator_render_jobs_project_id_idx on creator_render_jobs (project_id);
