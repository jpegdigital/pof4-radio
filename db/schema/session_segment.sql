-- The session's unit of show: one DJ break and its sweep of songs. Produced in stages, each
-- stage landing a column set whole; status is derived from what is present, never stored:
--   open        the row exists, nothing produced yet
--   playlisted  tracks present — the client can paint art and titles
--   programmed  session_slot rows present, some slot's voiced_at null — the words can be read
--   voiced      every slot's voiced_at set — the whole segment can play
-- Named session_segment only because the old station world still owns `segment`; rename when
-- that world is deleted.
create table session_segment (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references session (id) on delete cascade,
  num         integer not null,                        -- 1-based position within the session
  rationale   text,                                    -- compose's words: why this set answers the ask
  proposed    jsonb,                                   -- telemetry, pass 1: {rationale, picks: [{artist, title, why}]}
  candidates  jsonb,                                   -- telemetry, hydration: every Spotify hit as offered to compose
  tracks      jsonb,                                   -- the playlist: [{id, uri, name, artists, album, image, durationMs, pick, why}]
  dropped     jsonb,                                   -- reasons from all three stages: string[]
  program     jsonb,                                   -- telemetry, the program rung: the writer's raw output
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, num)
);

create trigger session_segment_touch
  before update on session_segment
  for each row execute function touch_updated_at();
