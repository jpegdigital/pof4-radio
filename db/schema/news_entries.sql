-- Append-only scheduled editions. A date can have several runs; latest prepared_at wins.
-- New editions contain raw source articles. Legacy options are retained for historical audits.
create table news_entries (
  id uuid primary key references headline_snapshot(id),
  edition_date date not null,
  place text not null,
  time_zone text not null,
  started_at timestamptz not null,
  prepared_at timestamptz not null,
  expires_at timestamptz not null,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  articles jsonb,
  constraint news_entries_raw_only check (articles is null or (
    jsonb_typeof(articles) = 'array' and options = '[]'::jsonb
    and not jsonb_path_exists(articles, '$[*] ? (exists (@.facts) || exists (@.checkedAt) || exists (@.topic) || exists (@.expiresAt))')
  )),
  check (prepared_at >= started_at and expires_at > prepared_at)
);

create index news_entries_latest on news_entries (place, edition_date desc, prepared_at desc);
