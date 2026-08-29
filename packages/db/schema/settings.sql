-- Settings: what /settings edits and the server reads per request. One row per key; the text
-- and the roster live only here (no copy or fallback in code).
--
--   prompt.system   who the DJ is and the standing rules (sent with every segment, cached 1h)
--   prompt.opening  the first segment's user turn
--   prompt.bridge   every later segment's user turn
--   prompt.shift    appended to the bridge when the listener's request changed
--   voices          the DJ roster as JSON — [{id, name, gender, modelId, stability, ...}] in
--                   picker order, first is the default (shape: packages/dj voice.ts)
--
-- Prompt placeholders in `value` are `{request}`, `{previous_talk}`, `{previous_tracks}`, `{dj}`
-- (the known keys live in packages/dj prompt.ts — `PROMPT_SLOTS`). A prompt key with no row is
-- a fault /api/station/next throws on; a missing `voices` row is an empty roster.
create table settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

create trigger settings_touch
  before update on settings
  for each row execute function touch_updated_at();
