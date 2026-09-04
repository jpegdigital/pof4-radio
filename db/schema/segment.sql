-- The kept unit of the show: a break followed by 3–5 songs, with every word, clip and timing.
-- Two states — `written` (voiced_at is null: records, lines and log known; rows can be painted,
-- nothing can be played) → `voiced` (elements + notes present) — and immutable after that: a
-- voice call on a voiced segment returns the kept row. There is no status column beyond
-- voiced_at; the browser is the state machine.
--
--   records   Record[]            the segment's songs in play order
--   lines     Line[]              {seq, treatment, legalId?, words, leadLine?} — the break at seq 0,
--                                 then each song's line; segues have no line
--   log       SegmentLog          {slots, fallbacks, topOfHour} after checkSegmentLog
--   dropped   [{pick, reason}]    records that fell out of this segment (no card)
--   elements  Element[]           the player's input, written by voice
--   notes     Note[]              one per clip: treatment, words, clip key, clipMs, bedInMs, leadMs, atMs, fallback
--   usage     {discover?, cards, write, voice}  tokens per call
create table segment (
  id          uuid primary key default gen_random_uuid(),
  station_id  uuid not null references station (id) on delete cascade,
  seq         integer not null,                        -- 1-based position within the station
  prompt      text not null,                           -- the ask in force when produced
  records     jsonb not null,
  lines       jsonb not null,
  log         jsonb not null,
  dropped     jsonb not null default '[]'::jsonb,
  elements    jsonb,
  notes       jsonb,
  usage       jsonb not null default '{}'::jsonb,
  model       text not null,
  written_at  timestamptz not null default now(),
  voiced_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (station_id, seq)
);

create index segment_station_seq_idx on segment (station_id, seq desc);
