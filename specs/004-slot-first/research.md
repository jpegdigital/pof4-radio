# Research: Slot-First Show

**Feature**: `004-slot-first` | **Date**: 2026-09-04

The design was decided before the spec (`docs/slot-first.md`, `docs/domain.html`). This file records
the choices the *implementation* still had to make after reading the code as it stands today, each
with what else was weighed. Nothing here reopens a decision in those two documents.

## R1. Where the routes live and what they are called

**Decision**: Five routes under `apps/web/src/app/api/sessions/`, one folder as today:

| Route | Rung |
|---|---|
| `POST /api/sessions` | create (unchanged shape; no longer inserts a segment) |
| `GET /api/sessions/:id` | the snapshot: the session, the clock, every slot |
| `POST /api/sessions/:id/fill` | the fill: propose, search, append |
| `POST /api/sessions/:id/slots/:seq` | the slot: write and voice in one request |
| `GET /api/sessions/:id/slots/:seq/clip` | the clip's bytes |
| `POST` / `GET /api/sessions/:id/slots/:seq/track` | pull the slot's picked track / stream its bytes |

**Rationale**: The track is addressed through the slot that picked it, not by a bare Qobuz id at
`/api/tracks/:id`, because the slot is the only proof that the station wants this record (the pull
spends the listener's Qobuz account) and the deck already addresses everything by session and
seq. The row and the bucket key stay the library's (`track.id`, `tracks/<id>.mp3`), and the pull is
not under the session lock, which is what "the library's, not the session's" means in
`slot-first.md`. One folder keeps `qobuz.ts` with two consumers (the fill and the pull) beside
them, no promotion to `lib/`.

**Alternatives considered**: `/api/tracks/:qobuzId` (cleaner ownership story; needs its own
"is this id picked by any slot" check and a cross-folder import of `qobuz.ts` — rejected as more
parts for the same guarantee). Voicing as a separate `POST …/slots/:seq/audio` (today's shape —
rejected by the design: one rung).

## R2. The slot rung's transaction and the voicing failure

**Decision**: One transaction holds the session lock across the write and the voicing. The write
lands as one `update` of the slot row; if ElevenLabs then fails, the handler **commits** the write
anyway and returns 502 with the reason. The slot is then *written, not voiced*; the next request
for it skips the writer and only voices.

**Rationale**: The spec's edge case ("the voicing fails after the write landed: the write is kept")
and FR-010's "together or not at all" for the write itself. Committing the write on a voicing
failure keeps the model call's product without a second transaction or a second lock window, so a
concurrent producer can never voice the same slot twice under the same first-take key.

**Alternatives considered**: Two transactions (write, commit, voice, update) — a second producer
could slip in between and both would write `<seq>.mp3`. Rolling back on voicing failure — throws
away a paid model call for a transient TTS error.

## R3. When the writer gives nothing usable

**Decision**: The writer is called once, retried once on a refusal or an invalid pick (an id not in
the slot's hits). If both fail, the slot is written as a **segue** with the pick set to the first
hit (Qobuz's top streamable result), no chart (the chart columns stay null), no words, no clip,
`treatment` carrying the reason, and it is stamped voiced. The show goes on.

**Rationale**: Spec edge case 6. A segue needs a pick to play at all; the first hit is what the
search ranked first and is what the compose step would have taken in the common case. The house
rules already treat a missing ramp as "not a talkup", so a null chart is a known state, not a
special one.

**Alternatives considered**: 502 and let the browser retry — the loop would stall on one bad
record and the listener would hear silence after the current track. Ask the writer a third time —
cost without evidence it helps.

## R4. How the server knows the hour turned (the legal ID)

**Decision**: The browser's clock (`clockMs`, ms since local midnight) is stored on the slot as
`clock_ms` when it is written. A break carries the legal ID when it is slot 1, or when the hour of
its `clock_ms` differs from the hour of the last break's `clock_ms` in the same session. Pure
function `legalIdDue(seq, clockMs, lastBreakClockMs)` in `rules.ts`, table-tested.

**Rationale**: `slot-first.md`: "Legal ID: still the server's, on breaks when the hour turns."
Today's code has only "segment 1 gets it". Storing the clock is one integer column and also a
useful receipt (when was this written, in the listener's day).

**Alternatives considered**: The server's own clock — wrong time zone for the listener. Passing the
last break's clock from the browser — the browser must not say what a slot is (FR-024).

## R5. The writer's brief: what it carries and where it comes from

**Decision**: One SQL read per write gathers, from `session_slot`:

- the slot itself (proposal + hits),
- the last three *written* slots of this session before it (kind, words, lead line, title, artist),
- every written slot before it (title, artist) — "everything played",
- every unwritten slot after it (title, artist) — "pending", for the proposer's benefit only,
- prior charts of any of this slot's hits from **other** sessions (`qobuz_id = any(hit ids)`,
  `session_id <> this`, newest three): ramp, sure, post, outro, feel, and the words that were said
  over it — offered as "another DJ's notes", read-only.

The weather and the headlines are pulled only when the clock says this slot is a break (`isBreak`).
The identity and the clock settings are read per request as today.

**Rationale**: FR-012 and the "Open" defaults in `slot-first.md`. Prior charts must be fetched for
all of a slot's hits because the pick is made in the same call the chart is.

## R6. The house rules over the new chart

**Decision**: `rules.ts` keeps its shape (pure, `RULES_TEXT` in the brief, enforcement after) and
changes its inputs: `checkSlot(seq, isBreak, written, hit)` replaces `checkProgram`. The rules:

1. If the clock says break, the kind is `break` (fallback recorded if the writer chose otherwise).
2. If the clock does not say break and the writer chose `break`, it steps down to `sweeper`.
3. A `talkup` needs `rampMs ≥ MIN_TALKUP_INTRO_MS` **and** `sure = true`; otherwise → `segue`
   (reason: "unsure of the ramp" or "ramp too short").
4. A `talkup` or `sweeper` with no words → `segue`.
5. Timing clamped as today (`MAX_RECORD_UNDER_MS`, `MAX_VOICE_IN_MS`); `rampMs`/`outroMs` clamped
   to the hit's duration.

**Rationale**: `slot-first.md` "What it costs": no independent check on the ramp; the writer's own
`sure` flag carries that job — "not sure means the voice does not chase the post".

## R7. The clock settings

**Decision**: One JSON row in `settings`, key `clock`, shape `{ breakEvery, fill, lowWater }`,
integers ≥ 1, mirroring how `station.identity` is stored. Pure schema and key in
`apps/web/src/lib/clock.ts` (client-safe), `loadClock()` beside `loadIdentity()` in
`lib/settings.ts` (throws when missing), a third editor on `/settings`. The snapshot carries the
clock so the browser knows `lowWater` without a second read. Seeded once by saving the defaults
(5, 6, 2) from the editor; no default in code.

**Rationale**: FR-027 and `domain.html` §5 ("none is a client knob"; "read per request, throw if
missing"). One row for three numbers because they are one thing (the clock) and the identity
already sets the pattern.

**Alternatives considered**: Three rows (`clock.breakEvery` …) — three reads, three editors, no
gain. `Knobs` in `params.ts` with defaults in code — the very thing the design retires.

## R8. The browser loop

**Decision**: A pure `nextMove(slots, clock, cueSeq, attempted)` in a new `loop.ts` (tested) tells
the session page the one call to make now, or none:

1. If there are no slots, or the count of proposed-but-unwritten slots is `≤ lowWater` and no fill
   has been attempted at this slot count → `fill`.
2. Else let *f* be the first slot not yet voiced. If *f* exists and `f.seq ≤ (cueSeq ?? 0) + 1` and
   *f* has not been attempted → `slot f`.
3. Else nothing.

So before play only slot 1 is written; once slot *k* is in the deck, slot *k+1* is written; the
show never runs more than one voiced slot ahead of the listener and never spends a model call on a
slot nobody will reach. Each attempt is keyed once per page life as today; a reload retries. On a
slot response with a pick and `held = false`, the page fires `POST …/slots/:seq/track` at once, not
awaited, and folds `held` in when it returns. The deck's `warm` goes; its `load` still ensures the
track (a retry of a failed pull) before playing.

**Rationale**: FR-022/023, SC-001/002/005. One-ahead is what `slot-first.md` asks ("asks for the one
after while this one plays").

**Alternatives considered**: Two ahead — more spend for a window the previous record already
covers. Writing every proposed slot as soon as it exists — turns breadth-first back into
depth-first.

## R9. The `track` row's new shape and the rows that exist today

**Decision**: `track` gains the tags (`title`, `artists`, `album`, `image`, `duration_ms`) and loses
`name`. The bucket client gains `head(key)` (a SigV4 `HEAD`, ~15 lines beside `open`). The pull
becomes: row exists → held; else bucket `HEAD` says the bytes exist → insert the row from the picked
hit's tags, no download; else download, `PUT`, insert. The cutover wipes the old `track` rows along
with the sessions (`pnpm db:clear` gains the tracks for this one run); the bytes stay and the rows
come back, with full tags, the first time each record is picked again, with no second download.

**Rationale**: FR-031 ("tracks already held MUST stay and be reused") is about the bytes and the
cost; a declarative schema diff cannot rename `name` to `title` and cannot add `not null` tag
columns over existing rows without a default in code. The `HEAD` check also closes a latent gap:
a crash between `PUT` and `insert` today leaves bytes nobody will ever find.

**Alternatives considered**: Nullable tag columns and a lazy backfill — a null tag on the library
table is the "fallback in code" the standards forbid. A hand-run migration statement — there is
no write path for ad-hoc SQL and the rows are days old.

## R10. The clip key

**Decision**: `sessions/<sessionId>/<seq>.mp3` for the first take, `…/<seq>-<take>.mp3` after, as
`domain.html` §6 says. The segment number leaves the key.

## R11. What the rundown shows for each status

**Decision**: One flat list. A `proposed` slot is a dim row: chip "coming up", the proposer's title
and artist, no duration, not tappable. A `written` slot paints the pick's tags (title, artists,
duration), its kind chip, a "pulling…" or "not held" marker, and is tappable once voiced and
held. Behind the chevron: the words, the lead line, the legal ID, the two timings, the chart (ramp,
sure, post, outro, feel), the treatment and any fallback. The segment header rows go; breaks are
marked by the mic icon as today.

## R12. The documents

**Decision**: `docs/domain.html` is the data model and is retitled to say it is *in the schema*;
`docs/api.html` is deleted (domain.html replaced it by its own words); `docs/sessions.html` is
rewritten for the new dance (create → snapshot → fill → slot → track, the frontier, cold start,
failures); `CLAUDE.md` points at the two that remain and describes the slot-first shape. The
`specs/001–003` and `docs/superpowers` stay as history, as today.

## R13. Constitution source

**Observation**: `.specify/memory/constitution.md` is the unfilled template. The governing
standards are `.claude/rules/coding-standards.md` (WET → SOLID → YAGNI, TDD, fail fast, config as
data, banned patterns) and the philosophy in `CLAUDE.md`. The plan's Constitution Check is
evaluated against those.
