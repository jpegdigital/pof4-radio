# Data Model: Segment Station

Declarative schema in `packages/db/schema/*.sql` (applied with `pnpm db:plan` / `db:apply`).
Types in `packages/db/src/db.ts`; the producer's zod shapes in `packages/dj/src/program/shapes.ts`
(lifted from the sandbox's `make/shapes.ts`). Column names snake_case, types camelCase.

## `station` (changed)

One listener's show. `messages` is dropped (R6); the skeleton and the identity used are kept.

| column | type | notes |
|--------|------|-------|
| id | uuid pk | |
| prompt | text | the request in force (the latest; each segment keeps its own) |
| dj | text | the DJ's name on the mic (from the roster) |
| voice_id | text | the roster voice the show is voiced in |
| identity | jsonb | `{calls, city, onAir}` as of creation — copied from settings so a kept station keeps its call letters |
| skeleton | jsonb | the current hour's plan (below); replaced when a new hour is discovered |
| segment_count | integer | kept segments |
| created_at / updated_at | timestamptz | |

**Skeleton** (`jsonb`): `{ rationale, records: Record[], breaks: number[], plannedAt, hourStartMs }`
— `records` in play order (the sandbox's `Record`: id, uri, name, artists, album, image,
durationMs, pick + the pick's `why`); `breaks` = indexes into `records` where a segment starts
(every 3–5); `consumed` = how many records have been placed into segments. Discovery writes it;
`next` reads from `consumed`; when fewer than 3 remain (or the prompt changed), `next` discovers
again and appends a new skeleton.

## `segment` (changed)

The kept unit. Immutable once `voiced_at` is set. Old columns `talk`, `tracks` are dropped.

| column | type | notes |
|--------|------|-------|
| id | uuid pk | |
| station_id | uuid fk → station (cascade) | |
| seq | integer | 1-based; `unique (station_id, seq)` |
| prompt | text | the request when produced |
| records | jsonb | `Record[]` — the segment's songs in order (3–5) |
| lines | jsonb | `Line[]` — `{seq, treatment, legalId?, words, leadLine?}`: the break at seq 0 then each song's line; segues have no line |
| log | jsonb | `{slots: LogSlot[], fallbacks: LogFallback[], topOfHour: boolean}` after `checkLog` |
| dropped | jsonb | `[{pick, reason}]` records that fell out of this segment (no card) |
| elements | jsonb | `Element[]` — the player's input, written by `voice` |
| notes | jsonb | `Note[]` — one per clip: treatment, words, clip key, clipMs, bedInMs, leadMs, atMs, fallback |
| usage | jsonb | tokens per call `{discover?, cards, write, voice: {clips, failed}}` |
| model | text | |
| written_at | timestamptz | `open`/`next` set it |
| voiced_at | timestamptz null | `voice` sets it; null = words known, no audio yet |
| created_at | timestamptz | |

**States**: `written` (`voiced_at is null`; rows can be painted, nothing can be played) →
`voiced` (elements + notes present; immutable). A `voice` call on a voiced segment returns the
kept row (idempotent).

**Invariants** (enforced in `checkLog` / `assemble`, tested):
- `lines[0]` is the break; on `seq = 1` it carries `legalId`; on any segment where the hour turned since the previous break it carries `legalId`.
- A `talkup` line exists only for a record whose card has `introMs ≥ 7000`.
- `elements.length === 1 + records.length`; each song element's `talk` (if any) names a clip that exists in `notes`.
- Every `Note.fallback` names `from`/`to`/`reason`.

## `card` (new)

What is known about a record, keyed by the Spotify track id actually played (R5).

| column | type | notes |
|--------|------|-------|
| id | text pk | Spotify track id |
| name / artists | text / jsonb | as resolved |
| intro_ms | integer | instrumental intro; 0 = starts on the vocal |
| sure | boolean | the model's confidence in `intro_ms` |
| post | text | the first sung words, "" if none |
| outro | text | `cold` / `fade` |
| outro_ms | integer | |
| energy | integer 1–5 | |
| tempo | text | `down` / `mid` / `up` |
| mood | text | |
| notes | jsonb | talking points, `string[]` |
| thinking | text | the model's reasoning, kept for the control view |
| model | text | |
| created_at / updated_at | timestamptz | corrected in place; kept segments do not re-read |

## Clips (bucket objects)

Key `stations/<station_id>/<segment_id>/<seq>.mp3`, `Content-Type: audio/mpeg`, written once.
The segment's `notes[].clip` holds the key's last part (`<seq>`); the browser plays
`/api/clip/<segment_id>/<seq>`. The bed stays a static asset (`/bed.mp3`, copied by hand);
produced sweepers (`/sweepers/*.mp3`) are optional static assets.

## `settings` (rows changed)

| key | value |
|-----|-------|
| `prompt.system` | who the DJ is, standing rules (kept) |
| `prompt.discover` | the hour brief template — `{request}`, `{dj}`, `{played}`, `{clock}` |
| `prompt.card` | the card brief template — `{record}` |
| `prompt.write` | the segment brief template — `{request}`, `{dj}`, `{records}`, `{cards}`, `{previous_words}`, `{clock}`, `{legal_id}` |
| `station.identity` | `{"calls":"WFAI","city":"Dallas","onAir":"56.6, Claude Radio"}` |
| `voices` | unchanged |

`prompt.opening`, `prompt.bridge`, `prompt.shift` are retired (rows deleted by hand; the loader
no longer reads them). A fresh database needs the four prompt rows, the identity row and a
`voices` row before the home page can produce.

## Existing rows

The old `station` / `segment` rows (bridge + tracks) are not migrated: `db:apply` drops the
columns, and the resume list would show empty shows. Clear them first (`pnpm --filter @radio/db
clear`, or `delete from station`). Decision recorded in plan.md's assumptions.
