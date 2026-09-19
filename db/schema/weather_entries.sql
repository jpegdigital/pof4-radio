-- Only complete successful pulls are published; previous runs are never overwritten.
create table weather_entries (
  id uuid primary key,
  edition_date date not null,
  place text not null,
  time_zone text not null,
  started_at timestamptz not null,
  prepared_at timestamptz not null,
  expires_at timestamptz not null,
  weather jsonb not null check (jsonb_typeof(weather) = 'object'),
  evidence jsonb not null,
  check (prepared_at >= started_at and expires_at > prepared_at)
);

create index weather_entries_latest on weather_entries (place, edition_date desc, prepared_at desc);
