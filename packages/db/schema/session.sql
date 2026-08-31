-- One listening session: the ask and the voice, nothing else. Created instantly; everything
-- produced for it (playlists, programs, clips) lands on session_segment rows, one per sweep.
create table session (
  id          uuid primary key default gen_random_uuid(),
  prompt      text not null,                            -- the listener's ask, verbatim
  voice_id    text not null,                            -- roster voice picked at creation
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger session_touch
  before update on session
  for each row execute function touch_updated_at();
