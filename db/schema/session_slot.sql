-- One track's introduction: how it is brought on air, every word said over it, and eventually
-- the clip that says them. The program half is written whole by the program rung (one Claude
-- call, every slot of a segment in one transaction) and is immutable after; the voice half is
-- landed by the audio rung one slot at a time. voiced_at set ⇒ done: nothing more will ever
-- happen to this slot. clip_key is written only after the bucket PUT succeeded, so a key
-- always points at media; a voiced slot without one has nothing to say (a segue). The mix is
-- the player's: the writer's two numbers plus house constants, the clip's length read on load.
create table session_slot (
  id          uuid primary key default gen_random_uuid(),
  segment_id  uuid not null references session_segment (id) on delete cascade,
  seq         integer not null,                        -- 1-based, matches the track's position in tracks
  track_id    text not null,                           -- the Qobuz id of tracks[seq - 1]
  -- the program half, immutable once written
  kind        text not null,                           -- break | talkup | sweeper | segue
  words       text,                                    -- everything said; null for a segue
  lead_line   text,                                    -- breaks: the one sentence that talks the record in, said last
  legal_id    text,                                    -- said dry before the bed comes in; top-of-hour breaks only
  why         text not null,                           -- the writer's one line: why this treatment here
  fallback    jsonb,                                   -- {from, to, reason} when a rule stepped the kind down
  record_under_ms integer,                             -- breaks: how far before the voice ends the record starts under it
  voice_in_ms integer,                                 -- talkups: how far into the record the voice comes in
  -- the voice half, landed by the audio rung
  clip_key    text,                                    -- bucket key of the clip; written only after the PUT succeeded
  voiced_at   timestamptz,                             -- set ⇒ done
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (segment_id, seq)
);

create trigger session_slot_touch
  before update on session_slot
  for each row execute function touch_updated_at();
