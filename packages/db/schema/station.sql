-- One listener's show. The memory of it is the kept rows (its segments), not a conversation:
-- every production brief is built from what has been played and what was said last. The browser
-- keeps the id (localStorage) and continues the same station across Stop/Run and reloads.
--
-- `skeleton` is the current hour's plan — { rationale, records: Record[], breaks: number[],
-- consumed, plannedAt } (shape: packages/dj program/shapes.ts) — written by discovery, consumed
-- segment by segment, replaced when a new hour is discovered. `identity` is the station's call
-- letters/city/on-air name as of creation, copied from settings so a kept station keeps them.
create table station (
  id            uuid primary key default gen_random_uuid(),
  prompt        text not null,                          -- the listener's current ask
  dj            text not null,                          -- the DJ's name on the mic (from the roster)
  voice_id      text not null,                          -- the roster voice the show is voiced in
  identity      jsonb not null,                         -- {calls, city, onAir}
  skeleton      jsonb not null default '{}'::jsonb,
  segment_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger station_touch
  before update on station
  for each row execute function touch_updated_at();
