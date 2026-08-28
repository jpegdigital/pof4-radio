-- One listener's ongoing show and the DJ's memory of it. The browser keeps the id
-- (localStorage) and continues the same conversation across Stop/Run and reloads.
--
-- `messages` is the Claude conversation, already trimmed (each finished segment is three
-- messages: the request, the accepted finish_segment call, its result) and capped at the
-- last 20 segments. Only /api/station/next writes it, under a row lock.
create table station (
  id            uuid primary key default gen_random_uuid(),
  prompt        text not null,                          -- the listener's current ask
  messages      jsonb not null default '[]'::jsonb,
  segment_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger station_touch
  before update on station
  for each row execute function touch_updated_at();
