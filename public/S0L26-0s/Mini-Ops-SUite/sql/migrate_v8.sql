-- v8 migration: DB-backed rate limiting + safety indexes

-- Rate limit windowed counter table (idempotent)
create table if not exists sync_rate_limits(
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  created_at timestamptz not null default now(),
  primary key(bucket, window_start)
);

-- Optional: keep it fast
create index if not exists idx_sync_rate_limits_bucket on sync_rate_limits(bucket);
create index if not exists idx_sync_rate_limits_window on sync_rate_limits(window_start);
