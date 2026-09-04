-- What is known about a record, keyed by the Qobuz track id actually played. Shared by every
-- station: the first to play a record pays for its card, every later one reuses it. Corrected in
-- place (an UPDATE); a kept segment never re-reads it — its timings were produced from the card
-- as it stood then.
create table card (
  id          text primary key,                        -- Qobuz track id
  name        text not null,
  artists     jsonb not null,                          -- string[]
  intro_ms    integer not null,                        -- instrumental intro; 0 = starts on the vocal
  sure        boolean not null,                        -- the model's confidence in intro_ms
  post        text not null,                           -- the first sung words, "" if none
  outro       text not null,                           -- cold | fade
  outro_ms    integer not null,
  energy      integer not null,                        -- 1–5
  tempo       text not null,                           -- down | mid | up
  mood        text not null,
  notes       jsonb not null,                          -- talking points, string[]
  thinking    text not null,                           -- the model's reasoning, for the control view
  model       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger card_touch
  before update on card
  for each row execute function touch_updated_at();
