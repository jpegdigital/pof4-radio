# Tasks: Segment Station

**Input**: Design documents from `/specs/003-segment-station/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: The repo's rule — pure logic gets a Vitest file beside it; anything needing a service is
verified live. The plan names the pure files: `shapes`, `clock-rules`, `timings`, `assemble`,
`sigv4`, `reducer`. Those are included as tasks; nothing else is tested by code.

**Organization**: Grouped by user story. Paths are relative to the repo root. `program/` below means
`packages/dj/src/program/`; `producer/` means `apps/web/src/lib/producer/`; `station/` means
`apps/web/src/components/station/`; `sandbox/` means `apps/web/src/app/(program)/program/`
(read from, **never written to or imported from**).

**Context from the user**: clearing the old bridge-style stations is fine — we're still in
sandbox mode. No data migration anywhere in this list.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

**Purpose**: Env, assets, and clearing the old data so the schema can change freely.

- [ ] T001 Add the five `BUCKET_*` vars to `apps/web/src/lib/env.ts` as optional strings (`BUCKET_ENDPOINT` url, `BUCKET_NAME`, `BUCKET_REGION`, `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY`) with a comment naming the 1Password item `pof4-radio-clips-bucket` and the Railway refs; `.env.op` already references them
- [ ] T002 [P] Move the bed: copy `apps/web/public/program/bed.mp3` to `apps/web/public/bed.mp3` and, if `apps/web/public/program/sweepers/` has clips, copy them to `apps/web/public/sweepers/`; add `apps/web/public/bed.mp3` and `apps/web/public/sweepers/` to `.gitignore` with a comment (hand-supplied audio, like the sandbox's)
- [ ] T003 [P] Clear the old stations: run `pnpm --filter @radio/db sql "delete from station"` (cascades to `segment`) and note the count deleted in the task's commit message; read `packages/db/scripts/clear.ts` first and use it instead if it already does this

---

## Phase 2: Foundational

**Purpose**: Schema, queries, the pure producer logic, the bucket signer, and the prompt slots —
every story depends on these.

### Schema and queries

- [ ] T004 Rewrite `packages/db/schema/station.sql` per data-model.md: drop `messages`; add `dj text not null`, `voice_id text not null`, `identity jsonb not null`, `skeleton jsonb not null default '{}'`; keep `prompt`, `segment_count`, timestamps and the touch trigger; update the header comment (the memory is the kept rows, not a conversation)
- [ ] T005 [P] Rewrite `packages/db/schema/segment.sql` per data-model.md: drop `talk`, `tracks`; add `records jsonb`, `lines jsonb`, `log jsonb`, `dropped jsonb default '[]'`, `elements jsonb null`, `notes jsonb null`, `usage jsonb default '{}'`, `written_at timestamptz not null default now()`, `voiced_at timestamptz null`; keep `prompt`, `model`, `unique (station_id, seq)`, the index; comment the two states (written → voiced, immutable after)
- [ ] T006 [P] Add `packages/db/schema/card.sql`: `card(id text pk, name text, artists jsonb, intro_ms int, sure bool, post text, outro text, outro_ms int, energy int, tempo text, mood text, notes jsonb, thinking text, model text, created_at, updated_at)` with the touch trigger; header: keyed by the Spotify track id played, shared by every station, corrected in place, never re-read by a kept segment
- [ ] T007 Run `pnpm db:plan` from the repo root, read the diff (expect: station/segment column drops + adds, card create), then `pnpm db:apply`; confirm a second `db:plan` is empty
- [ ] T008 Rewrite the types and queries in `packages/db/src/db.ts`: types `Station` (id, prompt, dj, voiceId, identity, skeleton, segmentCount, createdAt, updatedAt), `StationSummary` (+dj), `Segment` (all columns, `elements`/`notes` nullable), `Card`; queries `createStation({prompt, dj, voiceId, identity})`, `getStation(id)`, `listStations(limit)`, `listSegments(stationId)`, `getSegment(id)`, `lockStation(id)` → `{status: "missing"|"busy"} | {status:"ok", station, writeSegment(input): Promise<Segment>, setSkeleton(skeleton), release(ok)}` (row lock as today; `writeSegment` inserts a `written` row and bumps `segment_count`), `voiceSegment(id, {elements, notes, usage})` (sets `voiced_at`; no-op returning the row if already voiced), `getCards(ids): Map<string, Card>`, `putCard(card)` (upsert); remove `CommitInput`, `commit`, `lastSegment`, `Segment.talk/tracks`; keep the settings queries

### Pure producer logic (`packages/dj/src/program/`)

- [ ] T009 [P] Write `program/shapes.ts` lifted from `sandbox/make/shapes.ts`: keep `Record`, `Card` (add `id` already there), `Intro`/`Treatment`, `Fallback`, `Note`; add `Line` with `treatment` (`{seq, treatment, legalId?, words, leadLine?}`), `LogSlot` without `topOfHour` (per-segment: `{seq, id, intro, why}`), `SegmentLog` (`{slots, fallbacks, topOfHour}`), `Skeleton` (`{rationale, records, breaks, consumed, plannedAt}`), `Identity` (`{calls, city, onAir}`), `SegmentView` (contracts/api.md), and the `Element`/`Talk`/`Track` types copied from `sandbox/reducer.ts` (the player's contract lives in the package now); drop `Request`, `Picks`, `Log`, `Script`, `Program`, `STAGES`
- [ ] T010 [P] Write `program/shapes.test.ts`: a valid `Line` for each treatment, a `SegmentView` round-trip, and one refusal per narrowed enum/range (bad `treatment`, negative `introMs`, `records` not unique by id)
- [ ] T011 [P] Write `program/clock-rules.ts` lifted from `sandbox/make/clock-rules.ts`: keep the constants (`MIN_TALKUP_INTRO_MS 7000`, `BEAT_MS 400`, `TALKUP_LATE_MS 1500`, `LEAD_FALLBACK_MS 0`, `BREAK_MS 30_000`, add `SEGMENT_MIN 3`, `SEGMENT_MAX 5`, `SKELETON_MIN 6`, `SKELETON_MAX 14`, `CARDS_CONCURRENCY 5`, `VOICE_CONCURRENCY 3`) and `RULES_TEXT` rewritten for a segment; export `checkSegmentLog(slots, cards, {first, hourTurned}): {slots, fallbacks, topOfHour}` (slot 0 forced to `break`; `talkup` needs `card.introMs ≥ MIN_TALKUP_INTRO_MS` else `segue` + fallback; `topOfHour = first || hourTurned`), `hourTurnedBetween(fromMs, toMs): boolean` (wall-clock hour boundary crossed), `layBreaks(count): number[]` (every 4, a tail < 3 folded into the previous run so no segment is under 3 or over 5)
- [ ] T012 [P] Write `program/clock-rules.test.ts`: slot 0 promoted to break with a fallback; a talk-up under 7 s → segue with reason; `hourTurnedBetween` across 10:59→11:00 true, 10:10→10:50 false, across midnight true; `layBreaks` for 6, 7, 10, 11, 13, 14 records (every segment 3–5)
- [ ] T013 [P] Write `program/timings.ts` lifted from `sandbox/make/voice.ts`: `textOf(line)` (`[legalId, words, leadLine]` joined by one space) and `timingsOf(line, alignment): ClipInfo` (unchanged logic: `bedInMs` at `legalId.length + 1`, `leadMs = clipMs − start(text.length − leadLine.length)`, monotonic-start guard); export `Alignment` and `ClipInfo` types
- [ ] T014 [P] Write `program/timings.test.ts`: a synthetic alignment (one char per 100 ms) for `{legalId: "WFAI", words: "hello there", leadLine: "here's Prince"}` yields `clipMs`, `bedInMs = 500`, `leadMs = 13 chars × 100`; no `leadLine` → no `leadMs`; empty alignment → `{error}`
- [ ] T015 [P] Write `program/assemble.ts` lifted from `sandbox/make/assemble.ts` with the file/`Program` parts removed: `assemble({records, lines, log, cards, clips: Map<seq, ClipInfo>, clipUrl: (seq) => string, sweepers: string[], bed: string | null}): {elements: Element[], notes: Note[]}`; the ladder unchanged (talkup: post → late when `!card.sure` or the margin fails → segue; break: lead → end when no `leadMs`; break without words/clip → sweeper → segue; bed null → dry); `Note.clip` is the seq's key, `Element` clip fields hold `clipUrl(seq)`
- [ ] T016 [P] Write `program/assemble.test.ts` lifted from the sandbox's test, one case per rung plus: a segment with only a break and three segues (no clips) produces four elements and one note; a failed break clip with no sweepers produces a song-first segment with `fallback {from:"break", to:"segue"}`
- [ ] T017 Write `program/prompt.ts`: replace the slot list in `packages/dj/src/prompt.ts` — `PROMPT_SLOTS` becomes `prompt.system` (vars none), `prompt.discover` (`request`, `dj`, `played`, `clock`, `identity`), `prompt.card` (`record`), `prompt.write` (`request`, `dj`, `records`, `cards`, `previous_words`, `clock`, `legal_id`); update `PromptVar`, `PROMPT_VAR_HELP`, `fillVars`, `templateFrom`; delete the `opening`/`bridge`/`shift` slots and `buildUserTurn`/`capHistory`/`trimTurn` if nothing else uses them (grep first); move the three tool schemas (`DISCOVER_TOOL`, `CARD_TOOL`, `WRITE_TOOL`) and `clockOf` here from `sandbox/make/prompts.ts`, with `WRITE_TOOL` returning `lines: Line[]` (treatment per record + words) instead of separate log/script tools; update `packages/dj/src/prompt.test.ts` for the new slots
- [ ] T018 Update `packages/dj/src/index.ts` to export `program/*` (shapes, clock-rules, timings, assemble) alongside `prompt.ts`; delete `packages/dj/src/history.ts` + `history.test.ts` and anything in `dj.ts` that only served the bridge planner (`planSegment`, `finish_segment` tool) — grep `apps/web` for each export before deleting; `pnpm --filter @radio/dj typecheck` passes

### Bucket client (`apps/web/src/lib/`)

- [ ] T019 [P] Write `apps/web/src/lib/sigv4.ts`: pure AWS Signature V4 for one request — `sign({method, url, headers, body, region, service: "s3", accessKeyId, secretAccessKey, now}): Headers` using Web Crypto (`SHA-256` payload hash into `x-amz-content-sha256`, `x-amz-date`, canonical request, string to sign, HMAC chain, `Authorization` header); no Node-only APIs
- [ ] T020 [P] Write `apps/web/src/lib/sigv4.test.ts` against the AWS `get-vanilla` test-vector (fixed date `20150830T123600Z`, key `AKIDEXAMPLE`, secret `wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY`, region `us-east-1`, service `service`, expected `Authorization` from the suite) and one PUT with a body hash
- [ ] T021 Write `apps/web/src/lib/bucket.ts`: `bucket(): Bucket | null` from `env()` (null when any of the five is unset), `put(key, bytes, contentType)` and `open(key): Promise<{body, contentType, contentLength} | null>` over `fetch` with `sign()` (path-style URL `${endpoint}/${name}/${key}`; 404 → null; other non-2xx → throw with status and the first 200 chars); `clipKey(stationId, segmentId, seq)` → `stations/<s>/<seg>/<seq>.mp3`; module-level cache like `db()`

### Prompts and Claude

- [ ] T022 [P] Update `apps/web/src/lib/prompts.ts`: `loadPromptTemplate()` for the four slots (via the new `templateFrom`) and `loadIdentity(): Promise<Identity>` reading `station.identity` (throws with the key named if missing)
- [ ] T023 [P] Write `producer/ask.ts` and `producer/pool.ts` copied from `sandbox/make/ask.ts` / `pool.ts`: forced strict tool, `thinking: {type: "adaptive"}`, `output_config.effort`, `max_tokens 16000`, refusal → `ProducerError(502)`; `ProducerError` (status + message) defined in `producer/errors.ts`

**Checkpoint**: `pnpm check` green with the new tests; `db:plan` empty; old bridge code deleted from `packages/dj`; nothing in `apps/web` compiles yet against the old station (expected until US1).

---

## Phase 3: User Story 1 — A request goes on air as a produced show (Priority: P1) 🎯 MVP

**Goal**: Type a request, press Run, hear the opening within 60 s, the segment plays with its
treatments, the next segment is produced under the music and plays without a gap.

**Independent Test**: quickstart §1 end to end on a fresh station.

### Producer (`apps/web/src/lib/producer/`)

- [ ] T024 [US1] Write `producer/discover.ts` from `sandbox/make/discover.ts`: `discover({request, dj, identity, played: Record[], count}): {skeleton: Skeleton, usage}` — one `ask` with `DISCOVER_TOOL` (effort `medium`), the brief from `prompt.discover` with `{played}` as a numbered list; resolve each pick with `search(\`${title} artist:${artist}\`, 5)` preferring the **shortest** hit whose name matches the title case-insensitively; drop picks that don't resolve or whose id is in `played`; fewer than `SKELETON_MIN` → `ProducerError(502, "discover: only N records resolved")`; `breaks = layBreaks(records.length)`, `consumed = 0`
- [ ] T025 [P] [US1] Write `producer/cards.ts` from `sandbox/make/enrich.ts`: `cards(records): {cards: Map<id, Card>, dropped: Dropped[], usage}` — `db().getCards(ids)` first; the missing ones through `pool(…, CARDS_CONCURRENCY, makeCard)` with `CARD_TOOL` (effort `high`), a refusal retried once then dropped with the reason; each new card `putCard`ed
- [ ] T026 [P] [US1] Write `producer/write.ts`: `write({request, dj, identity, records, cards, previousWords, first, hourTurned, clock}): {lines: Line[], log: SegmentLog, usage}` — one `ask` with `WRITE_TOOL` (effort `high`), the brief from `prompt.write` with `RULES_TEXT`, `{legal_id}` = the identity's legal ID text when `first || hourTurned` (else "none"); run `checkSegmentLog` on the returned treatments; drop lines whose slot fell to `segue`; require `lines[0].legalId` when `topOfHour` (else fill it from the identity and record a fallback)
- [ ] T027 [US1] Write `producer/segment.ts`: `produceSegment(lock, {request, dj, previous: Segment | null, first})` — takes the next `SEGMENT_MIN…SEGMENT_MAX` records from `station.skeleton` at `consumed` (per `breaks`); if fewer than `SEGMENT_MIN` remain or `request !== station.prompt`, call `discover` with `played` = every record in kept segments and replace the skeleton via `lock.setSkeleton`; `cards` → if drops leave fewer than `SEGMENT_MIN`, pull the next skeleton record(s); `hourTurned = previous ? hourTurnedBetween(previous.writtenAt, Date.now()) : false`; `write`; `lock.writeSegment({...})` with `usage` and `timing`; return the `SegmentView` (cards trimmed to `introMs/sure/post/outro/energy/notes`)
- [ ] T028 [US1] Write `producer/voice.ts` from `sandbox/make/voice.ts`: `voiceSegment(segment, voice: Voice): {elements, notes, failed, usage}` — for each `Line` (break first, then `pool(VOICE_CONCURRENCY)`) call ElevenLabs `/with-timestamps` with `ttsBody(voice, textOf(line))`, decode `audio_base64`, `timingsOf`, `bucket().put(clipKey(...), bytes, "audio/mpeg")`; a failed clip → `{error}` in the map; `assemble({... clipUrl: seq => \`/api/clip/${segment.id}/${seq}\`, sweepers: static list from public/sweepers or [], bed: "/bed.mp3"})`; `db().voiceSegment(...)`; idempotent when `voicedAt` is set

### Routes (`apps/web/src/app/api/`)

- [ ] T029 [US1] Write `apps/web/src/app/api/station/open/route.ts` (`POST`, contracts/api.md): body `{prompt, dj, voiceId}` (zod; `voiceId` must be in `loadVoices()`); `503` naming the missing var if `!env().ELEVENLABS_KEY || !bucket()`; `createStation({prompt, dj, voiceId, identity: await loadIdentity()})` → `lockStation` → `produceSegment(lock, {first: true})` → respond `{stationId, skeleton, segment, timing}`; `ProducerError` → its status; always `release`
- [ ] T030 [P] [US1] Write `apps/web/src/app/api/station/[id]/next/route.ts` (`POST`): `lockStation` (`404`/`409`), `previous = last of listSegments`, `produceSegment(lock, {first: false, request})`, respond `{segment, skeleton, timing}`
- [ ] T031 [P] [US1] Write `apps/web/src/app/api/segment/[id]/voice/route.ts` (`POST`): `getSegment` (`404`), `getStation` for `voiceId`, `loadVoices()` to find the `Voice`, `voiceSegment`, respond `{segmentId, elements, notes, failed, timing}`; `503` when key/bucket missing
- [ ] T032 [P] [US1] Write `apps/web/src/app/api/clip/[segmentId]/[seq]/route.ts` (`GET`): validate `seq` is an integer, `getSegment` for the station id (`404`), `bucket().open(clipKey(...))` (`404` if null), stream with `Content-Type: audio/mpeg`, `Cache-Control: public, max-age=31536000, immutable`
- [ ] T033 [US1] Delete `apps/web/src/app/api/station/next/route.ts` and rewrite `apps/web/src/app/api/station/[id]/route.ts` (`GET`) to return `{station, skeleton, segments: SegmentView[]}` for every kept segment in seq order (`404` unknown)

### Player (`apps/web/src/components/station/`)

- [ ] T034 [US1] Replace `station/reducer.ts` with the three-lane reducer copied from `sandbox/reducer.ts`, importing `Element`/`Track`/`Talk` from `@radio/dj`; add state `segments: {id, seq, from, to, voiced: boolean, view: SegmentView}[]` (element index ranges) and `pending: SegmentView | null`; events `LOAD_SHOW {segments: SegmentView[]}` (voiced ones → elements appended in order, unvoiced → `pending`), `SEGMENT_PENDING {view}`, `APPEND_SEGMENT {view, elements, notes}` (appends, clears `pending` if it matches), `SEGMENT_FAILED {error}`; `moveTo` past the end with a `pending` segment keeps `loop: "running"` and sets `music` to the pending segment's first record at `full` (R8 clean segue) rather than stopping; `RUN` on an empty show with nothing pending is a no-op
- [ ] T035 [US1] Replace `station/reducer.test.ts` with the sandbox's cases adapted plus: `LOAD_SHOW` with two voiced and one written segment yields the right `segments[].from/to` and `pending`; `APPEND_SEGMENT` while running past the end resumes at the new segment's break; `SEGMENT_PENDING` never touches the lanes
- [ ] T036 [P] [US1] Write `station/voice-cache.ts` from the sandbox's clip cache in `sandbox/use-program.ts`: `getClip(url): Promise<AudioBuffer>` decoded once per URL in the shared `AudioContext`, `prefetch(urls)`, `drop(urls)`; the bed decoded once from `/bed.mp3`
- [ ] T037 [US1] Replace `station/use-station.ts` with `station/use-program.ts`: the sandbox's seven effects (device connect, music lane, mic lane in the graph, bed lane with gain scheduled on the audio clock, talk-due/lead-due timers, ended handlers, stop) copied and re-pointed at `voice-cache.ts` and the reducer; add the **produce-ahead** effect: on `RUN` with no station → `POST /api/station/open` (dispatch `SEGMENT_PENDING` on response, then `POST …/voice`, then `prefetch` its clip URLs, then `APPEND_SEGMENT`); when the cursor enters a segment's first song element and no later segment exists or is pending → `POST /api/station/:id/next` → `SEGMENT_PENDING` → `voice` → `prefetch` → `APPEND_SEGMENT`; `409` → keep the pending row and retry after the next element; `voice` failure → retry once per element change while `pending` remains; station id in `localStorage` as today
- [ ] T038 [US1] Adapt `station/player.tsx`, `station/station.tsx`, `station/home.tsx`, `station/dj-picker.tsx` to the new state (`onAir` element, lanes, `segments`): the transport (Run/Stop/Prev/Next) unchanged in look; the "now" face shows the element (break label / track + talk chip); the request field and DJ picker feed `open`/`next` bodies; delete `station/show.tsx` (replaced in US4 by `rundown.tsx` — for US1 render a minimal list of elements so the page compiles); remove every reference to `/api/tts` and `/api/station/next` from `components/station`
- [ ] T039 [US1] Update `apps/web/src/app/(app)/page.tsx`: pass `identity` (from `loadIdentity()`, tolerant: null if the row is missing so the page still paints) and `dj` on each station summary; `apps/web/src/components/station/use-media-session.ts` re-pointed at the new state (title = track or break label)
- [ ] T040 [US1] Settings: update `apps/web/src/app/(settings)/settings/prompt-editor.tsx` and `actions.ts` to render the four slots from the new `PROMPT_SLOTS` with their var legends, and add a small identity form (calls, city, onAir) that saves `station.identity`; seed the four prompt rows by hand on `/settings` from `sandbox/make/prompts.ts`'s text (record in the commit that the text lives in the table)
- [ ] T041 [US1] Run `pnpm check` and `pnpm --filter web build`; fix lint/types; then quickstart §1 live: record the open/voice timings and the time-to-opening in `quickstart.md`'s "First walk" section

**Checkpoint**: A request plays as a produced show, one segment ahead, from `/`.

---

## Phase 4: User Story 2 — A past station replays without being re-made (Priority: P2)

**Goal**: Pick a kept station; everything loads; Run plays it with no production calls; playing
past the end produces the next segment.

**Independent Test**: quickstart §2.

- [ ] T042 [US2] In `station/use-program.ts`, on picking a station from the resume list: `GET /api/station/:id` → `LOAD_SHOW`; `prefetch` the clip URLs of the first two voiced segments; set the station id; if the last segment is `written` but not voiced, call `voice` on it and `APPEND_SEGMENT`; the produce-ahead effect must not fire for segments already kept (guard on `segments` + `pending`)
- [ ] T043 [P] [US2] Update `station/resume-picker.tsx` to show `dj` and the segment count; the list arrives from `page.tsx` (`listStations(20)` with `dj`)
- [ ] T044 [US2] In the reducer, `JUMP {index}` onto any kept element restarts its lanes from the kept `atMs`/`bedInMs`/`leadMs` (already the sandbox's behaviour — verify with a test that a jump onto a break re-asserts `mic` and `bed` and bumps both seqs)
- [ ] T045 [US2] Continue past the end: when the cursor passes the last kept element and nothing is pending, the produce-ahead effect calls `next` (the previous segment's words go in the brief server-side — verify `produceSegment` reads `previous.lines` for `previous_words` and every kept record for `played`); quickstart §2.4 live

**Checkpoint**: Resume is free; continuation follows from the kept show.

---

## Phase 5: User Story 3 — What is learned about a record is reused (Priority: P2)

**Goal**: Cards are shared across stations; a record without a card is dropped, not fatal;
corrected cards don't touch kept segments.

**Independent Test**: quickstart §3.

- [ ] T046 [US3] In `producer/cards.ts`, return `reused: string[]` and `made: string[]` and put both in the segment's `usage.cards`; `open`/`next` responses include `timing.cardsMs` so the warm/cold difference is visible (SC-004)
- [ ] T047 [P] [US3] In `producer/segment.ts`, when `cards()` drops a record: append `{pick, reason}` to the segment's `dropped`, pull the next unconsumed skeleton record in its place (up to `SEGMENT_MAX` attempts), and if the segment still has fewer than `SEGMENT_MIN` records, proceed with what it has (never fewer than 1) and record a `fallback` on the log
- [ ] T048 [P] [US3] In `producer/discover.ts`, when a pick's shortest matching hit differs from the first hit, keep the pick's `why` and note `resolved: "shortest of N"` on the `Record` (additive field in `shapes.ts`); the rundown can show it later
- [ ] T049 [US3] Verify immutability by code: `db().voiceSegment` refuses to overwrite `elements`/`notes` once `voiced_at` is set (returns the row), and `produceSegment` never reads a card for a kept segment; quickstart §3 live (corrupt a card, resume the old station, start a new one)

**Checkpoint**: Second station with overlapping records is measurably faster; drops are recorded.

---

## Phase 6: User Story 4 — The home page is the control room and the player in one (Priority: P3)

**Goal**: Below the player, the whole show as produced: segments → rows with treatment, words,
timings, card facts, fallback badge; pending rows while producing; read-only.

**Independent Test**: quickstart §1 steps 2–3 (rows before audio) and the row detail on a kept station.

- [ ] T050 [US4] Write `station/rundown.tsx` from `sandbox/timeline.tsx` + `station/show.tsx`'s tap-to-jump: group elements by `segments[]`, a header per segment (seq, break label, `topOfHour` chip, "producing…" when pending/unvoiced), one row per element: treatment chip, title/artists, the on-air marker, tap → `JUMP`; a `pending` segment renders its `records` and `lines` as rows with no timings and the "producing…" state
- [ ] T051 [US4] Add the row detail (expand on tap of a chevron, not the row): words (from `notes`/`lines`), timings (`atMs`, `bedInMs`, `leadMs`, `clipMs` formatted as seconds), the card's `introMs`/`sure`/`post`/`outro`, the fallback badge (`from → to: reason`) in the sandbox's amber, `dropped` listed under the segment header; nothing editable
- [ ] T052 [US4] Wire `rundown.tsx` into `station/station.tsx` below the player (phone-wide; the detail collapses by default); remove the minimal element list from T038

**Checkpoint**: The page shows the show being made and everything about it, read-only.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T053 [P] Rewrite the "How it works" and "The program is a sandbox" sections of `CLAUDE.md` for the segment show (three calls, the bucket, cards, the kept segment, the produce-ahead loop, the four prompt slots + identity, `/program` as a deletable sandbox); update the top summary sentence
- [ ] T054 [P] Add a short banner section at the top of `docs/the-program.html` pointing to `specs/003-segment-station/` as the live shape, and note which parts (maker desk, files) are sandbox-only now
- [ ] T055 [P] Sandbox-independence check (FR-015/SC-006): `grep -rn "(program)" apps/web/src --include=*.ts --include=*.tsx | grep -v "app/(program)/"` returns nothing; record the command and result in `quickstart.md` §6
- [ ] T056 Run quickstart §4 (bad key → every clip falls back; bad bucket → 503 and the clean-segue path) and §5 (two tabs → 409) live; record deviations in `quickstart.md`
- [ ] T057 `pnpm check` and `pnpm --filter web build` green; update the memory note `program-maker.md` (or add one) with what was tuned live and what's open

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T023)**: schema (T004–T007) before queries (T008); the pure `program/*` files (T009–T016) are independent of each other and of the schema; T017 before T018; T019–T020 before T021; T022–T023 need T017.
- **US1 (T024–T041)** needs all of Foundational. Order inside: producer (T024 → T025/T026 → T027 → T028) → routes (T029–T033) → player (T034 → T035/T036 → T037 → T038 → T039) → settings (T040) → gate (T041). T040 can run any time after T017.
- **US2 (T042–T045)** needs US1 (the player and `GET /api/station/:id`).
- **US3 (T046–T049)** needs T025/T027 (cards and segment production); independent of US2.
- **US4 (T050–T052)** needs T034/T038; independent of US2/US3.
- **Polish** last.

## Parallel Example: Foundational

```text
T005, T006 (schema files)     T009, T011, T013, T015 (pure modules)   T019 (sigv4)   T022, T023
T010, T012, T014, T016 (their tests) once each module exists
```

## Parallel Example: US1

```text
after T024: T025 ∥ T026 → T027 → T028
after T029: T030 ∥ T031 ∥ T032
after T034: T035 ∥ T036 → T037
```

## Implementation Strategy

**MVP = Setup + Foundational + US1** — a request plays as a produced show from `/`. Stop there,
walk quickstart §1, and tune the cold start (discovery effort, the break-first voice order) before
US2–US4. US2 (resume) and US4 (rundown detail) are where the page becomes the app the spec
describes; US3 is mostly verification of what Foundational already built.

## Notes

- Everything lifted from `sandbox/` is **copied**, never imported; the sandbox is not edited.
- No data migration: old stations are deleted in T003 (sandbox mode, per the user).
- No new packages. The bucket client is `sigv4.ts` + `fetch`.
- Prompt text lives only in the `settings` table; T040 seeds it by hand, not in code.
