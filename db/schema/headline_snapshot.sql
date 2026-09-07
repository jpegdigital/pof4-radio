-- Evidence and editorial decision for a break; never rewritten on a voice retry.
create table headline_snapshot (
  id uuid primary key,
  snapshot jsonb not null,
  audit jsonb not null,
  created_at timestamptz not null default now()
);
