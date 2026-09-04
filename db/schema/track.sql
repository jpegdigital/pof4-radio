-- A track we hold: the MP3 320 pulled from Qobuz once and kept in the bucket forever, shared by
-- every session that plays it (the first to play a track pays for its pull). Keyed by the Qobuz
-- track id — the id in session_slot.qobuz_id. A row exists only after the bytes are known to be
-- in the bucket (a PUT that succeeded, or a HEAD that found them), so a row always points at
-- media; a track with no row has not been pulled yet. The tags are Qobuz's own, copied from the
-- picked hit at pull time; nothing judged ever lands here.
create table track (
  id           text primary key,                       -- Qobuz track id
  title        text not null,                          -- version folded in: "Dreams (2001 Remaster)"
  artists      jsonb not null,                         -- string[]
  album        text not null,
  image        text,                                   -- Qobuz CDN URL
  duration_ms  integer not null,
  audio_key    text not null,                          -- bucket key: tracks/<id>.mp3
  bytes        integer not null,                       -- the MP3's size, for the bill
  created_at   timestamptz not null default now()
);
