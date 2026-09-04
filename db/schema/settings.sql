-- Settings: what /settings edits and the server reads per request. One row per key; the text
-- and the roster live only here (no copy or fallback in code).
--
--   prompt.system     who the DJ is and the standing rules (the system prompt of every call)
--   prompt.discover   the hour brief — {request}, {dj}, {played}, {clock}, {identity}
--   prompt.card       the card brief — {record}
--   prompt.write      the segment brief — {request}, {dj}, {records}, {cards}, {previous_words},
--                     {clock}, {legal_id}
--   station.identity  {"calls","city","onAir"} — copied onto each station at creation
--   voices            the DJ roster as JSON — [{id, name, gender, modelId, stability, ...}] in
--                     picker order, first is the default (shape: packages/dj voice.ts)
--
-- The known placeholders live in packages/dj program/prompt.ts (`PROMPT_SLOTS`). A prompt key
-- with no row is a fault the producer throws on; a missing `voices` row is an empty roster.
create table settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

create trigger settings_touch
  before update on settings
  for each row execute function touch_updated_at();
