-- The new home page's unit: one prompt hydrated into a playlist. Claude proposes records by
-- name; Spotify search resolves each to a real track or it is dropped with why. Both halves are
-- kept — `tracks` is what plays, `dropped` is the troubleshooting trail for picks that died.
create table session (
  id          uuid primary key default gen_random_uuid(),
  prompt      text not null,                            -- the listener's ask, verbatim
  voice_id    text not null,                            -- roster voice picked at creation
  rationale   text not null,                            -- why this set answers the ask, compose's words
  proposed    jsonb not null default '{}'::jsonb,       -- telemetry, pass 1: {rationale, picks: [{artist, title, why}]}
  candidates  jsonb not null default '[]'::jsonb,       -- telemetry, hydration: every Spotify hit as offered to compose
  tracks      jsonb not null,                           -- the playlist: [{id, uri, name, artists, album, image, durationMs, pick, why}] — the gate for every later step
  dropped     jsonb not null,                           -- reasons from all three stages: string[]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger session_touch
  before update on session
  for each row execute function touch_updated_at();
