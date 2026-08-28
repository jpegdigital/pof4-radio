-- The one Spotify account the station plays through (a Premium account).
-- Single row on purpose: Guard is the only identity, and it admits one household.
-- `refresh_token` is long-lived; `access_token` is the current hour's, refreshed by
-- the web app on demand (packages/spotify refreshToken()). Nothing here is written by
-- the worker: it uses the client-credentials flow for search.
create table spotify_account (
  id              boolean primary key default true check (id), -- the singleton trick
  spotify_user_id text not null,
  display_name    text,
  product         text,                     -- 'premium' is required for playback
  scope           text not null,
  refresh_token   text not null,
  access_token    text not null,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger spotify_account_touch
  before update on spotify_account
  for each row execute function touch_updated_at();
