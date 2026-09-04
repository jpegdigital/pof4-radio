# Data Model: Slot-First Show

**Feature**: `004-slot-first` | **Date**: 2026-09-04 | **Source of truth once built**: `db/schema/*.sql`, `docs/domain.html`

Four tables remain: `session`, `session_slot`, `track`, `settings`. The schema is declarative
(`db/schema/<table>.sql`, one file per table) and applied by diff (`pnpm db:plan` → `db:apply`).

## `session` — unchanged

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `prompt` | text not null | the ask, verbatim |
| `voice_id` | text not null | roster voice |
| `created_at`, `updated_at` | timestamptz | `session_touch` trigger |

Doubles as the production lock: the fill rung and the slot rung take
`select … for update nowait` on it; a second producer gets 409. The track pull does not.

## `session_slot` — rewritten

Replaces today's `session_slot` (which hangs off `session_segment`). One row per position; written
in three phases by producers that never overlap in columns.

```sql
create table session_slot (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references session (id) on delete cascade,
  seq             integer not null,           -- 1-based position in the show

  -- the proposal, landed by the fill rung
  title           text not null,              -- the song as the proposer named it
  artist          text not null,
  why             text not null,              -- the proposer's line
  hits            jsonb not null,             -- Hit[] — the streamable versions Qobuz found, up to 3

  -- the pick, the chart, the copy and the timing: one Claude call, one update
  qobuz_id        text,                       -- the pick: one of hits[].id
  clock_ms        integer,                    -- the browser's clock at the write, ms since local midnight
  ramp_ms         integer,                    -- chart
  sure            boolean,                    -- chart
  post            text,                       -- chart: where the vocal lands, in words
  outro           text,                       -- chart: cold | fade
  outro_ms        integer,                    -- chart
  energy          integer,                    -- chart, feel: 1..5
  tempo           text,                       -- chart, feel: down | mid | up
  mood            text,                       -- chart, feel
  kind            text,                       -- copy: break | talkup | sweeper | segue
  words           text,                       -- copy; null for a segue
  lead_line       text,                       -- copy, breaks
  legal_id        text,                       -- copy: the server's, when due
  treatment       text,                       -- copy: why this kind, here (or why the writer gave nothing)
  fallback        jsonb,                      -- {from, to, reason} when a rule stepped the kind down
  record_under_ms integer,                    -- timing, breaks
  voice_in_ms     integer,                    -- timing, talkups
  thinking        text,                       -- receipt; never on the wire

  -- the clip
  clip_key        text,                       -- bucket key; written only after the PUT succeeded
  voiced_at       timestamptz,                -- set ⇒ done

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (session_id, seq)
);
create trigger session_slot_touch before update on session_slot for each row execute function touch_updated_at();
create index session_slot_qobuz_idx on session_slot (qobuz_id) where qobuz_id is not null;  -- prior charts, the pull's proof
```

### `hits` — one element

```ts
interface Hit {            // Qobuz's tags, verbatim from search (qobuz.ts `Track` minus `streamable`)
  id: string;
  title: string;           // version folded in: "Dreams (2001 Remaster)"
  artists: string[];
  album: string;
  image: string | null;    // Qobuz CDN URL
  durationMs: number;
}
```

### Status — derived, never stored

| Status | Derivation |
|---|---|
| `proposed` | `qobuz_id is null` |
| `written` | `qobuz_id is not null and voiced_at is null` |
| `voiced` | `voiced_at is not null` |

`clip_key` present always means the media exists; `voiced_at` without a key is a segue.

### Validation rules (enforced in code, table-tested)

- `qobuz_id ∈ hits[].id` (the writer cannot pick outside the slot's hits).
- `kind = 'break'` iff `isBreak(seq, breakEvery)`; the writer's other choice is recorded in `fallback`.
- `kind = 'talkup'` requires `ramp_ms ≥ 7000 and sure`; else `segue`, reason in `fallback`.
- `kind ∈ {talkup, sweeper}` requires non-empty `words`; else `segue`.
- `record_under_ms` only on a break, `≤ 10000`; `voice_in_ms` only on a talkup, `≤ 10000`.
- `ramp_ms`, `outro_ms` clamped to `[0, pick.durationMs]`.
- `legal_id` only on a break, only when `legalIdDue(seq, clock_ms, lastBreakClockMs)`.
- The chart columns are all set or all null (null only on the "writer gave nothing" segue, R3).

### State transitions

```
(none) ──fill──▶ proposed ──slot rung: write──▶ written ──slot rung: voice──▶ voiced
                                                   │ (voicing failed: stays written; next request voices only)
                                                   └──{again:true} on voiced: new clip_key, voiced_at bumped
```

No transition ever goes backwards. Nothing is deleted except by `pnpm db:clear` (the session cascade).

## `track` — reshaped

```sql
create table track (
  id           text primary key,      -- Qobuz track id
  title        text not null,         -- the tags, as Qobuz gave them (copied from the picked hit at pull time)
  artists      jsonb not null,        -- string[]
  album        text not null,
  image        text,                  -- Qobuz CDN URL
  duration_ms  integer not null,
  audio_key    text not null,         -- tracks/<id>.mp3
  bytes        integer not null,
  created_at   timestamptz not null default now()
);
```

A row exists only after the bytes are known to be in the bucket (a `PUT` that succeeded, or a
`HEAD` that found them). Nothing judged ever lands here.

## `settings` — one new row

| Key | Value | Read by |
|---|---|---|
| `clock` | `{"breakEvery":5,"fill":6,"lowWater":2}` | every fill and slot request (`loadClock`, throws if missing); the snapshot copies it to the browser |

Existing rows (`station.identity`, `voices`) unchanged. The header comment in `settings.sql` is
rewritten to list what exists today (it still describes `prompt.*` keys from the first build).

## Gone

`session_segment`, `card`, `station`, `segment` — dropped by the schema diff. The `common.sql`
trigger function stays (three tables use it).

## Relationships

```
session 1 ──▶ N session_slot (session_id, cascade)
session_slot.qobuz_id ──▶ track.id   (no FK: the slot is written before the track is held)
session_slot.hits[].id               (the candidates the pick was made from)
```

## On the wire

See `contracts/sessions-api.md` for the documents; the shapes are derived from these rows by
`doc.ts` (`slotDoc(row, held)`): the tags of a written slot are `hits.find(h => h.id === qobuz_id)`,
never a join to `track`; `held` is `track.id = any(picked ids)` across the session in one query;
`thinking`, `hits` (once picked) and `clock_ms` stay off the wire.
