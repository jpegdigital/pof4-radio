-- A record we hold: the MP3 320 pulled from Qobuz once and kept in the bucket forever, shared by
-- every session that plays it (the first to play a record pays for its pull). Keyed by the Qobuz
-- track id — the id in session_segment.tracks and session_slot.track_id. A row exists only after
-- the PUT succeeded (bucket first, row second), so a row always points at media; a record with no
-- row has not been pulled yet. The rest of the record's metadata lives in the playlist that chose
-- it; name and artists are here so the table reads as the library.
create table track (
  id          text primary key,                        -- Qobuz track id
  name        text not null,
  artists     jsonb not null,                          -- string[]
  audio_key   text not null,                           -- bucket key: tracks/<id>.mp3
  bytes       integer not null,                        -- the MP3's size, for the bill
  created_at  timestamptz not null default now()
);
