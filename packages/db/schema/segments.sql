-- One DJ segment: commentary in, a few tracks, commentary out. The unit the worker
-- produces and the player consumes. `tracks` is the resolved Spotify tracks (ids the DJ
-- actually got back from search — never a hallucinated one), frozen at plan time.
--
-- status: queued → planning → ready → played, or failed. A failed segment is terminal;
-- the player just asks for another one.
create table segments (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'queued'
                  check (status in ('queued', 'planning', 'ready', 'played', 'failed')),
  listener_prompt text not null,           -- what the listener asked for, verbatim
  intro           text,                    -- the DJ's spoken lead-in
  outro           text,                    -- the DJ's spoken sign-off for this block
  tracks          jsonb not null default '[]'::jsonb, -- [{id, uri, name, artists, album, durationMs}]
  model           text,                    -- which Claude planned it
  error           text,
  played_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index segments_status_created_idx on segments (status, created_at);

create trigger segments_touch
  before update on segments
  for each row execute function touch_updated_at();
