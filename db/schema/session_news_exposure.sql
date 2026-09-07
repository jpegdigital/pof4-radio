-- Conservative acknowledgment: a full, uninterrupted break voice finished in live mode.
-- Preparation, skips and replay are never treated as hearing a story.
create table session_news_exposure (
  session_id uuid not null references session(id) on delete cascade,
  seq integer not null,
  clip_key text not null,
  story_id text not null,
  revision text not null,
  heard_at timestamptz not null default now(),
  primary key (session_id, seq, clip_key, story_id, revision)
);
