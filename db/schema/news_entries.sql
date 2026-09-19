-- Append-only scheduled editions. A date can have several runs; latest prepared_at wins.
-- Raw publisher evidence and model checks remain in headline_snapshot, shared with legacy receipts.
create table news_entries (
  id uuid primary key references headline_snapshot(id),
  edition_date date not null,
  place text not null,
  time_zone text not null,
  started_at timestamptz not null,
  prepared_at timestamptz not null,
  expires_at timestamptz not null,
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  check (prepared_at >= started_at and expires_at > prepared_at)
);

create index news_entries_latest on news_entries (place, edition_date desc, prepared_at desc);
