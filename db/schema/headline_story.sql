-- Current known revision; original evidence remains in the append-only snapshots.
create table headline_story (
  id text primary key,
  revision text not null,
  article_id text not null,
  article_revision text not null,
  snapshot_id uuid not null references headline_snapshot(id),
  updated_at timestamptz not null default now()
);
