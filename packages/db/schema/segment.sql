-- History log: one row per segment the DJ finished, append-only. There is no status — the
-- browser is the state machine; a row exists only once the segment is planned.
-- `talk` is the single spoken bridge (an intro on the first segment); `tracks` are the
-- resolved Spotify tracks in play order (ids the DJ got back from search, never invented).
create table segment (
  id          uuid primary key default gen_random_uuid(),
  station_id  uuid not null references station (id) on delete cascade,
  seq         integer not null,                        -- 1-based position within the station
  prompt      text not null,                           -- the ask in force when planned
  talk        text not null,
  tracks      jsonb not null,                          -- [{id, uri, name, artists, album, durationMs}]
  model       text not null,
  created_at  timestamptz not null default now(),
  unique (station_id, seq)
);

create index segment_station_seq_idx on segment (station_id, seq desc);
