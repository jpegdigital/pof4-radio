-- One position in the show. Written in three phases by producers that never overlap in columns,
-- and status is derived from what is present, never stored:
--   proposed   the fill rung landed a title, an artist, a why and the hits Qobuz found
--   written    the slot rung picked one hit, charted it, wrote the copy and set the timing
--              (qobuz_id set, voiced_at null — a voicing that failed leaves it here)
--   voiced     the clip exists (clip_key), or there was nothing to say (a segue): voiced_at set
-- Nothing goes backwards. `{again: true}` on a voiced slot moves clip_key to a new take and bumps
-- voiced_at; the words never change. clip_key is written only after the bucket PUT succeeded, so a
-- key always points at media. The mix is the player's: the writer's two numbers plus house
-- constants, the clip's length read on load.
create table session_slot (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references session (id) on delete cascade,
  seq             integer not null,                    -- 1-based position in the show

  -- the proposal, landed by the fill rung
  title           text not null,                       -- the song as the proposer named it
  artist          text not null,
  why             text not null,                       -- the proposer's line
  hits            jsonb not null,                      -- Hit[] — the streamable versions Qobuz found, up to 3

  -- the pick, the chart, the copy and the timing: one Claude call, one update
  qobuz_id        text,                                -- the pick: one of hits[].id
  clock_ms        integer,                             -- the browser's clock at the write, ms since local midnight
  ramp_ms         integer,                             -- chart: the instrumental ramp before the first vocal
  sure            boolean,                             -- chart: the writer's confidence in ramp_ms
  post            text,                                -- chart: where the vocal lands, in words
  outro           text,                                -- chart: cold | fade
  outro_ms        integer,                             -- chart: where the ending begins
  energy          integer,                             -- chart, feel: 1..5
  tempo           text,                                -- chart, feel: down | mid | up
  mood            text,                                -- chart, feel
  kind            text,                                -- copy: break | talkup | sweeper | segue
  words           text,                                -- copy; null for a segue
  lead_line       text,                                -- copy, breaks: the one sentence that talks the song in, said last
  legal_id        text,                                -- copy: the server's, said dry before the bed, when due
  treatment       text,                                -- copy: why this kind, here (or why the writer gave nothing)
  fallback        jsonb,                               -- {from, to, reason} when a rule stepped the kind down
  record_under_ms integer,                             -- timing, breaks: how far before the voice ends the song starts under it
  voice_in_ms     integer,                             -- timing, talk-ups: how far into the song the voice comes in
  thinking        text,                                -- receipt; never on the wire

  -- the clip
  clip_key        text,                                -- bucket key; written only after the PUT succeeded
  voiced_at       timestamptz,                         -- set ⇒ done

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (session_id, seq)
);

create trigger session_slot_touch
  before update on session_slot
  for each row execute function touch_updated_at();

-- Prior charts of a version from other sessions, and the pull's proof that a slot picked it.
create index session_slot_qobuz_idx on session_slot (qobuz_id) where qobuz_id is not null;
