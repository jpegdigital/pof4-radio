-- Settings: the DJ's prompt slots, edited on /settings and read by /api/station/next when a
-- segment is planned. One row per key; a key with no row is at its default (the defaults and
-- the known keys live in packages/dj prompt.ts — `PROMPT_SLOTS`). "Reset to default" deletes
-- the row. Placeholders in `value` are `{request}`, `{previous_talk}`, `{previous_tracks}`.
--
--   prompt.system   who the DJ is and the standing rules (sent with every segment, cached 1h)
--   prompt.opening  the first segment's user turn
--   prompt.bridge   every later segment's user turn
--   prompt.shift    appended to the bridge when the listener's request changed
create table settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

create trigger settings_touch
  before update on settings
  for each row execute function touch_updated_at();
