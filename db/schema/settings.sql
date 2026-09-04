-- Settings: what /settings edits and the server reads per request. One row per key; each lives
-- only here (no copy or fallback in code).
--
--   station.identity  {"calls","city","onAir"} — the brief and the legal ID (lib/identity.ts)
--   clock             {"breakEvery","fill","lowWater"} — how the show is paced (lib/clock.ts)
--   voices            the DJ roster as JSON — [{id, name, gender, modelId, stability, ...}] in
--                     picker order, first is the default (lib/voices.ts)
--
-- A missing identity or clock row is a fault the rungs throw on; a missing `voices` row is an
-- empty roster.
create table settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

create trigger settings_touch
  before update on settings
  for each row execute function touch_updated_at();
