# Tasks: Slot-First Show

**Input**: Design documents from `/specs/004-slot-first/`
**Prerequisites**: plan.md, spec.md, research.md (R1–R13), data-model.md, contracts/sessions-api.md, quickstart.md

**Tests**: Included. `.claude/rules/coding-standards.md` makes TDD non-negotiable for pure logic and
SC-007 asks for red-first tests; every pure function below gets its `it.each` give/want table
written and seen failing before the implementation. Nothing that needs Postgres, Qobuz, Claude,
ElevenLabs or the bucket is unit-tested; those are proven live by the quickstart.

**Organization**: By user story. This is a cutover refactor, so User Story 1 carries the new
server and the schema apply (nothing plays without them); later stories add behaviour on top.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md
- Paths are repo-relative. `web/` = `apps/web/src/`; `api/` = `apps/web/src/app/api/sessions/`;
  `page/` = `apps/web/src/app/(app)/sessions/[id]/`

## Path Conventions

One Next app (`apps/web`); the schema at `db/schema/`; docs at `docs/`. Tests sit beside the code
as `*.test.ts`. Run tests with `pnpm test`, the gate with `pnpm check`, the build with
`pnpm --filter web build`.

---

## Phase 1: Setup

**Purpose**: A known-green baseline and a branch.

- [X] T001 Run `pnpm check` on `main` and confirm green; note the test count (baseline for SC-006/SC-007)
- [X] T002 Create branch `004-slot-first` from `main` (`git switch -c 004-slot-first`); commit the `specs/004-slot-first/` folder and `docs/slot-first.md`, `docs/domain.html`

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The pure parts, red first, plus the schema files and the loaders every rung reads.
No route can be written until these exist.

**⚠️ CRITICAL**: T003–T024 must be complete before Phase 3.

### The clock (settings row) — R7

- [X] T003 [P] Write `web/lib/clock.test.ts`: `Clock.parse` accepts `{breakEvery:5,fill:6,lowWater:2}`; rejects a missing field, a `0`, a non-integer; `CLOCK_KEY === "clock"`. Run `pnpm test` and see it fail.
- [X] T004 Create `web/lib/clock.ts`: `CLOCK_KEY = "clock"`, `Clock = z.object({ breakEvery, fill, lowWater })` all `z.number().int().min(1)`, `type Clock`. Pure, client-safe (no pool import). Test green.
- [X] T005 Add `loadClock(): Promise<Clock>` to `web/lib/settings.ts` beside `loadIdentity`: reads `settings` where `key = CLOCK_KEY`, throws `settings row clock is missing — fill it on /settings` when absent, throws naming the key when malformed.
- [X] T006 [P] Create `web/app/(settings)/settings/clock-editor.tsx` (client component, modelled on `identity-editor.tsx`): three integer inputs (break every, fill, low water), a save button, the saved-at line; imports only `@/lib/clock`.
- [X] T007 Add `saveClock(_prev, formData)` to `web/app/(settings)/settings/actions.ts`: parse the three fields with `Clock.safeParse`, `saveSetting(CLOCK_KEY, JSON.stringify(...))`, `revalidatePath("/settings")`; error text names the field.
- [X] T008 Wire the clock into `web/app/(settings)/settings/page.tsx`: read `CLOCK_KEY` in the same `settings` query as identity/voices; add a "Clock" rail item under Station with a lamp (missing → `Fault`), opened by `?clock=1`; render `ClockEditor` for it. Update the rail's footer sentence ("A change reaches the next slot produced").

### The bucket HEAD — R9

- [X] T009 [P] Add a HEAD case to `web/lib/sigv4.test.ts`: signing a `HEAD` request yields the same canonical request as `GET` with method swapped (use the existing AWS vector with method `HEAD`). See it fail if the signer special-cases methods; pass if it is method-agnostic (then the test documents it).
- [X] T010 Add `head(key): Promise<{ contentLength: number | null } | null>` to the `Bucket` interface and implementation in `web/lib/bucket.ts`: a signed `HEAD`, `404` → `null`, other non-2xx → `failure("head", res)`.
- [X] T011 Extend `apps/web/scripts/bucket-smoke.mts`: after the PUT, `head` returns the size; `head` of a random key returns `null`. (Plain `node`, no `@/` alias.)

### The house rules — R4, R6

- [X] T012 [P] Rewrite `api/rules.test.ts` as tables: `isBreak(seq, breakEvery)` — (1,5)→true, (2,5)→false, (6,5)→true, (11,5)→true, (1,1)→true, (3,1)→true; `legalIdDue(seq, clockMs, lastBreakClockMs)` — seq 1 → true; same hour → false; hour changed → true; `lastBreakClockMs` null and seq>1 → true; `checkSlot(seq, clockSaysBreak, written, hit)` — clock says break & writer wrote talkup → break with fallback `talkup→break`; clock says no break & writer wrote break → sweeper with fallback; talkup with `rampMs 12000, sure true` → talkup; talkup with `sure false` → segue "unsure of the ramp"; talkup with `rampMs 5000` → segue "ramp too short"; sweeper with empty words → segue "no words"; break `recordUnderSec 30` → `recordUnderMs 10000`; talkup `voiceInSec 2` → `voiceInMs 2000`; `rampMs`/`outroMs` clamped to `hit.durationMs`; `legalId` only on a break when due. See them fail.
- [X] T013 Rewrite `api/rules.ts`: keep `MIN_TALKUP_INTRO_MS`, `MAX_RECORD_UNDER_MS`, `MAX_VOICE_IN_MS`, `clampMs`; export `isBreak`, `legalIdDue` (hour = `Math.floor(ms / 3_600_000)`), `SlotFallback`, `WrittenSlot` (every written column of the row, camelCase, ready for the one `update`), `checkSlot(seq, clockSaysBreak, written: Written, hit: { durationMs }, legalId: string | null): WrittenSlot`; rewrite `RULES_TEXT` for one slot ("This slot is the break" / "This slot is not a break: talkup, sweeper or segue"; a talkup only when you are sure of a ramp ≥ 7 s; lengths as today; never the legal ID). Tests green.

### The shapes — the proposer and the writer

- [X] T014 [P] Rewrite `api/shapes.test.ts`: `Proposal` requires artist/title/why; `Written` requires `pick` (string), the chart (`rampSec` number, `sure` boolean, `post` string, `outro` enum, `outroSec` number, `energy` int 1..5, `tempo` enum, `mood`), the copy (`kind` enum, `words`, `leadLine`, `treatment`), the timing (`recordUnderSec`, `voiceInSec`); rejects `energy 6`, `kind "jingle"`; `numbered` cases kept. See it fail.
- [X] T015 Rewrite `api/shapes.ts`: `Proposal` (from `Pick`), `SLOT_KINDS`, `Written` with `.describe()` text per field (pick: "the id of the version you chose, verbatim from the hits"; chart fields from today's `CardFacts` descriptions; copy/timing from today's `Slot`), `numbered` unchanged. Delete `Pick`, `Choice`, `CardFacts`, `Slot`. Tests green.

### The document on the wire

- [X] T016 [P] Rewrite `api/doc.test.ts`: `statusOf(row)` — no pick → proposed; pick, no voiced_at → written; voiced_at → voiced; `slotDoc(row, held)` — proposed row → `{seq, status, title, artist, why, voiced:false}` and nothing else; written row → `pick` equals the hit whose id is `qobuz_id`, `held` from the set, chart present, `hits`/`thinking`/`clock_ms` absent; null chart columns → no `chart` key; segue voiced with no clip → `voiced:true`, no `clipKey`. See it fail.
- [X] T017 Rewrite `api/doc.ts`: `SlotRow` (every column of data-model.md's `session_slot`), `Hit`, `Tags`, `SlotStatus`, `SlotDoc` per contracts/sessions-api.md, `SLOT_COLUMNS` (no join), `statusOf`, `slotDoc(row, held: Set<string>)`. Delete `SegmentStatus`, `TrackDoc`, `trackDocs`, `SLOT_FROM`. Tests green.
- [X] T018 [P] Rewrite `api/params.ts` + `api/params.test.ts`: keep `SessionParams`; add `SlotBody = z.object({ clockMs: z.number().int().min(0).max(86_400_000), again: z.boolean().optional() })`; delete `Knobs`, `DEFAULTS`. Table: missing `clockMs` fails, `again` optional.

### The browser's pure parts — R8

- [X] T019 [P] Write `page/loop.test.ts` for `nextMove(slots, clock, cueSeq, attempted)`: no slots → `{kind:"fill", key:"fill:0"}`; 6 proposed, cue null → `{kind:"slot", seq:1}`; slot 1 voiced, cue null → none; slot 1 voiced, cue 1 → slot 2; slots 1–2 voiced, cue 1 → none (one ahead only); 4 written + 2 proposed (`≤ lowWater 2`) → fill with key `fill:6`; same but `attempted` has `fill:6` → falls through to the slot rule; slot 1 written-not-voiced (voicing failed) → slot 1 again unless attempted; fill takes precedence over slot when both apply. See it fail.
- [X] T020 Create `page/loop.ts`: `export type Move = { kind: "fill"; key: string } | { kind: "slot"; seq: number; key: string } | null`; `nextMove` per contract; keys `fill:<slot count>` and `slot:<seq>`. Tests green.
- [X] T021 [P] Rename `introMs` → `rampMs` in `page/plan.ts` (`PlanInput.rampMs`, comments say "the chart's ramp") and `page/plan.test.ts`; behaviour unchanged, tests green.

### The schema — data-model.md

- [X] T022 [P] Rewrite `db/schema/session_slot.sql` exactly per data-model.md (header comment: the three phases; columns; `session_slot_touch` trigger; the partial index on `qobuz_id`).
- [X] T023 [P] Rewrite `db/schema/track.sql` per data-model.md (`title`, `artists`, `album`, `image`, `duration_ms`, `audio_key`, `bytes`; header: "a row exists only after the bytes are known to be in the bucket").
- [X] T024 [P] Delete `db/schema/card.sql`, `db/schema/session_segment.sql`, `db/schema/station.sql`, `db/schema/segment.sql`; rewrite the header comment of `db/schema/settings.sql` to list `station.identity`, `voices`, `clock` only; update `db/schema/session.sql`'s comment ("everything produced lands on session_slot rows").
- [X] T025 Run `pnpm lint` (pgdelta schema lint) green and `pnpm db:plan`; read the plan: drops four tables, recreates `session_slot`, alters `track`. Do **not** apply yet.

**Checkpoint**: `pnpm test` green for every new table; `pnpm --filter web typecheck` will be red (old routes import deleted shapes) until Phase 3.

---

## Phase 3: User Story 1 — The first song starts sooner (Priority: P1) 🎯 MVP

**Goal**: Create → fill → slot 1 written and voiced → track pulled alongside → play. Two model
calls before first sound. The old routes and producers are removed so the app compiles.

**Independent Test**: quickstart §5 — a fresh session, the terminal shows `fill`, `slot 1 written`,
`slot 1 voiced`, `slot 1 track held`; press play; the break plays over the bed and the record
comes in under the lead line. A reload lands in the same place.

### The producers (pure of the database)

- [X] T026 [P] [US1] Write `api/fill.test.ts`: `searchQuery` cases moved from `select.test.ts`; `dedupe(proposals, taken: {title, artist}[])` drops a proposal whose lowercased title+artist is in `taken`, keeps order, returns `{ kept, dropped: string[] }`. See it fail.
- [X] T027 [US1] Create `api/fill.ts` from `playlist.ts`: `FEAT_TAG`, `searchQuery`, `dedupe`; `FillError` (from `PlaylistError`); `produceFill(q, { prompt, identity, dj, played, pending, count }): Promise<{ proposals: Proposal[]; slots: NewSlot[]; dropped: string[] }>` — one proposer call (`numbered("song", count + 2, Proposal)`, the system text from `playlist.ts`, the brief now carrying "Already played: …" and "Coming up: … — never name any of these again"), `dedupe` against played+pending, `Promise.allSettled` search per proposal (`q.search(searchQuery(...), 3)`, streamable only, mapped to `Hit`), one `NewSlot {title, artist, why, hits}` per proposal with ≥1 hit, in order, cut at `count`. Throws `FillError` with `dropped` when none. Tests green. Delete `api/playlist.ts`, `api/select.ts`, `api/select.test.ts`.
- [X] T028 [P] [US1] Create `api/write.ts` from `program.ts` + the card prompt in `cards.ts`: `system(dj, identity)` (today's), `clockOf`, `legalIdOf`, `WriteInput { prompt, dj, identity, clock, seq, clockSaysBreak, proposal: {title, artist, why}, hits: Hit[], recent: {seq, kind, words, leadLine, title, artist}[], played: {title, artist}[], priorCharts: PriorChart[], legalId, weather, headlines }`, `writeBrief(input)` (the ask, the clock, this slot's proposal and its hits as a numbered menu with durations, the last three slots' copy, everything played as a list, prior charts as "Another DJ's read of <hit>: ramp …, sure/unsure, post …, ends …, feel …; they said: …", the break paragraph with weather/headlines blocks only when `clockSaysBreak`, the legal ID sentence, `RULES_TEXT`), `produceWrite(input): Promise<{ written: Written; thinking: string } | null>` — one `messages.parse` with `zodOutputFormat(Written)`, retry once on refusal or when `written.pick ∉ hits`, `null` when both fail (R3). Keep `weatherBlock`/`headlinesBlock`. Delete `api/program.ts`, `api/program.test.ts`, `api/cards.ts`.
- [X] T029 [US1] Move any pure test worth keeping from the old `program.test.ts` (brief contains the legal ID sentence; weather block only for breaks) into `api/write.test.ts` as `writeBrief` tables; run green.

### The routes — contracts/sessions-api.md

- [X] T030 [P] [US1] Edit `api/route.ts` (POST create): drop the `session_segment` insert and the transaction; one `insert into session … returning id`; log line and errors as today; doc comment updated ("production starts with /fill once the client lands").
- [X] T031 [P] [US1] Rewrite `api/[id]/route.ts` (GET snapshot): `select` the session; `loadClock()`; `select ${SLOT_COLUMNS} from session_slot where session_id = $1 order by seq`; `held` = `select id from track where id = any($1)` over the picked ids; respond `{ sessionId, prompt, voiceId, createdAt, clock, slots: rows.map(r => slotDoc(r, held)) }`, `no-store`. A missing clock row → 500 with the loader's message.
- [X] T032 [US1] Create `api/[id]/fill/route.ts` (POST): validate id; `begin`; `select prompt, voice_id … for update nowait` (409 on `55P03`); `loadClock`, `loadIdentity`, `loadVoices` (dj name); `select seq, title, artist, qobuz_id from session_slot where session_id=$1 order by seq` → `played` (picked) / `pending` (unpicked); `produceFill(q, …, count: clock.fill)`; `insert into session_slot (session_id, seq, title, artist, why, hits)` per new slot with `seq = last + i`; `commit`; respond `{ added: SlotDoc[], dropped }`; `FillError` → 502 `{ error, dropped }`; log `[session x] fill: N slots added (seq a–b), M dropped`.
- [X] T033 [US1] Create `api/[id]/slots/[seq]/route.ts` (POST, the slot rung) per the contract's precedence: parse `SlotBody`; bucket + ELEVENLABS_KEY presence (503); `begin`; lock (409); `select ${SLOT_COLUMNS}, hits, id from session_slot where session_id=$1 and seq=$2` (404 "slot N is not proposed yet — fill first"); **voiced & !again → 200**; **proposed → write**: `loadClock`/`loadIdentity`/`loadVoices`; `clockSaysBreak = isBreak(seq, clock.breakEvery)`; last break's `clock_ms` (`select clock_ms from session_slot where session_id=$1 and kind='break' and seq<$2 order by seq desc limit 1`) → `legalIdDue`; brief inputs (`recent`: last three written before seq; `played`: all written before seq; `priorCharts`: `select … from session_slot where qobuz_id = any($1) and session_id <> $2 and ramp_ms is not null order by created_at desc limit 3`; weather/headlines via `forBrief` only when `clockSaysBreak`); `produceWrite`; `null` → the no-chart segue on `hits[0]` (R3, `treatment` = the reason); else `checkSlot`; one `update session_slot set qobuz_id=…, clock_ms=…, <chart>, <copy>, fallback, <timing>, thinking where id=$1`; **written (or just written) → voice**: segue → `update … voiced_at = now()`; else TTS as today's audio route (`said = [legal_id, words, lead_line]`), `store.put("sessions/<id>/<seq>[-take].mp3")`, `update … clip_key, voiced_at`; `commit`; respond `slotDoc(row, held)` with `held` from one `select 1 from track where id=$1`. **Voicing failure after a write in this request → commit, 502 `{ error, slot }`** (R2). Log `slot N written: <kind>, <artist> — <title> (<pick>)` and `slot N voiced…`.
- [X] T034 [P] [US1] Create `api/[id]/slots/[seq]/clip/route.ts` (GET) from the old audio GET: `select clip_key from session_slot where session_id=$1 and seq=$2`; stream from the bucket, immutable headers; 404 otherwise.
- [X] T035 [P] [US1] Create `api/[id]/slots/[seq]/track/route.ts` from the old tracks route: `pickOf(id, seq)` reads `qobuz_id, hits` (404 unknown slot; 409 "slot N is not written yet" when no pick) and returns the picked hit's tags; **POST**: `track` row exists → `{ held: true, …tags }`; else `store.head("tracks/<id>.mp3")` → insert the row (tags from the hit, `bytes` from `contentLength`) → 200; else `q.download` → `put` → insert `on conflict do nothing` → 200; 502 on failure with `QobuzError` body. **GET**: stream `audio_key` from the `track` row, immutable; 404 when not held. Log `slot N track held: <artist> — <title>, <bytes> bytes`.
- [X] T036 [US1] Delete `api/[id]/segments/` (all four routes and their folders). Run `pnpm --filter web typecheck`; fix any remaining import of a deleted symbol in `api/`.

### The browser

- [X] T037 [P] [US1] Rewrite `page/types.ts`: `Tags`, `Clock`, `SlotStatus`, `Slot` (= `SlotDoc`), `SessionDoc { …, clock, slots }`, `Cue = Slot` (a written or voiced slot; `cueKey = c => String(c.seq)`), `KIND_LABEL`, `clock`, `secs`. Delete `Track`, `Segment`, `Status`.
- [X] T038 [US1] Rewrite `page/use-deck.ts`: `useDeck({ sessionId, onSlot, onEnded })`; URLs `/api/sessions/<id>/slots/<seq>/clip?take=<clipKey>` and `/api/sessions/<id>/slots/<seq>/track`; `load(cue)` no longer POSTs the slot (phase `voicing` removed; `DeckPhase = idle | loading | playing | paused | error`); `trackOf(cue)` POSTs the track route when `!cue.held` (folding the response into `onSlot` as `held: true`), then `getClip(url)`; `planSlot({ kind, clipMs, recordUnderMs, voiceInMs, rampMs: cue.chart?.rampMs, legalIdChars })`; `clockOf(rec, cue.pick.durationMs)`; delete `warm`. Comments updated.
- [X] T039 [US1] Rewrite `page/session-view.tsx`: state holds `SessionDoc`; the loop effect computes `nextMove(session.slots, session.clock, deck.cue?.seq ?? null, attempted)` and runs it once per key: **fill** → `POST …/fill`, append `added`; **slot** → `POST …/slots/<seq>` with `{ clockMs }`, fold the slot in (on 502 with `slot`, fold that in too and show the error); after folding, if `slot.pick && !slot.held` → `fetch(POST …/slots/<seq>/track)` not awaited, fold `held: true` on success, `console.warn` on failure; the effect depends on `deck.cue?.seq` so a cue change re-runs it. `cues = slots.filter(s => s.status !== "proposed")`; `onSlot(slot)` replaces by seq; `revoice` posts `{ clockMs, again: true }` to the slot route; `status` line reads `slot N of M`. Delete `onTrack`, `warm`, `nextRung`, `Segment` uses. Keep the desk, the player and the error boxes.
- [X] T040 [P] [US1] Minimal `page/rundown.tsx` so it compiles: `Rundown({ slots, producing, cursor, retaking, onPick, onRetake })` renders a flat `<ol>`; a proposed slot as a `ToCome`-style row with chip "coming up" and the proposal's title/artist; a written/voiced slot as today's `Row` reading `slot.pick` for tags and `slot.chart?.rampMs` in `Detail`. (The full rundown is US3.)
- [X] T041 [P] [US1] Update `page/player.tsx` for `Cue = Slot` (`cue.pick.title`, `cue.pick.artists`, `cue.pick.image`, `cue.pick.durationMs`); `page/transport.ts` unchanged.
- [X] T042 [P] [US1] Update `web/app/(app)/page.tsx`: the log query counts slots (`count(l.id) as slots from session s left join session_slot l on l.session_id = s.id`); `SessionSummary.segments` → `slots` in `web/app/(app)/home-desk.tsx` and its label ("N slots").
- [X] T043 [US1] `pnpm check` green (lint, format, typecheck, tests) and `pnpm --filter web build` green. Commit: "The show is a list of slots: fill and slot rungs, the track pulled by the slot".

### The cutover — quickstart §3–§5

- [X] T044 [US1] Update `db/clear.mts` to also `delete from track` when run with `--tracks` (print both counts; doc comment: the bytes stay in the bucket, a row comes back on the next pick without a download). Run `pnpm db:clear --tracks`.
- [X] T045 [US1] Run `pnpm db:apply`; then `pnpm db:sql "select table_name from information_schema.tables where table_schema='public' order by 1"` → `session, session_slot, settings, track`.
- [X] T046 [US1] Run the smoke scripts under `op run`: `apps/web/scripts/bucket-smoke.mts` (HEAD present/absent) and `apps/web/scripts/qobuz-smoke.mts`.
- [X] T047 [US1] `pnpm dev`; on `/settings` save the clock (5, 6, 2); confirm the identity and a voice exist.
- [X] T048 [US1] Quickstart §5 live: a named-record ask; exactly two Claude calls before first sound; the pull line lands alongside the voicing; play; reload mid-slot lands in place with no new production lines. Fix what fails; commit.

**Checkpoint**: A listener hears the first song after two model calls. Slots 2–6 sit as "coming up".

---

## Phase 4: User Story 2 — The show never waits again (Priority: P1)

**Goal**: One slot ahead while playing; refill at the low-water mark; breaks placed by the clock;
no repeats; the legal ID when the hour turns; another take; concurrency refused.

**Independent Test**: quickstart §6–§7 — play through more than one fill; every transition
gapless; breaks at 1, 6, 11; no title twice; a concurrent fill gets 409.

- [X] T049 [US2] In `page/session-view.tsx`, make ⏭ and the record-ended advance target the next **voiced** slot only (`cues[index + 1]` with `status === "voiced"`); when it is written-not-voiced or proposed, `canNext` is false and the deck shows "Loading the next slot…" rather than silence; confirm the loop asks for slot k+1 the moment slot k becomes the cue.
- [X] T050 [US2] In `api/[id]/slots/[seq]/route.ts`, confirm the non-break path: weather/headlines are not pulled, the brief says "not a break", `checkSlot` steps a writer's `break` to `sweeper`; and the `again: true` path re-voices only (new key `sessions/<id>/<seq>-<take>.mp3`, words untouched). Add a log line for a fallback (`slot N: <from> → <to>: <reason>`).
- [X] T051 [US2] In `api/[id]/fill/route.ts`, confirm `played`/`pending` reach the proposer brief and `dedupe` runs before search; log the dropped duplicates.
- [X] T052 [US2] Quickstart §6 live: listen past slot 6; expect `fill: 6 slots added (seq 7–12)` after slot 4 is written; slot 6 is a break without a legal ID (same hour) and slot 1's had one; no repeated title; a `Voice again` on a played slot yields a new take and the old bytes stay.
- [X] T053 [US2] Quickstart §7 live: two concurrent `POST …/fill` → one 200, one 409; two concurrent `POST …/slots/<seq>` → same.
- [X] T054 [US2] Quickstart §8, the failure paths: bad `ELEVENLABS_KEY` → 502 with `slot.status = "written"`, then a fix voices without rewriting; `POST …/slots/99` → 404; `POST …/slots/<proposed>/track` → 409. Commit.

**Checkpoint**: A session runs as long as the listener listens.

---

## Phase 5: User Story 3 — The rundown shows what is coming (Priority: P2)

**Goal**: The flat list reads correctly at every status; a tap on a voiced-and-held row plays it.

**Independent Test**: open a session mid-show: rows in order with the right status; a proposed row
says "coming up" with title and artist; a written row shows the pick's tags; tapping a held row plays.

- [X] T055 [P] [US3] Finish `page/rundown.tsx`: remove the segment headers; row tones (played / on / ahead) over the flat list; a proposed row (`ToCome`: chip "coming up", title · artist, no duration, not a button); a written row with a small marker "pulling…" while `!held` and "not held" after a failed pull; the mic icon for a break; the row is tappable only when `voiced && held`; `Detail` shows the legal ID, the words, the lead line, the two timings, the chart (`ramp 12.0 s (sure)`, `post: …`, `ends: fade at 3:41`, `energy 4/5 · up · <mood>`), `treatment`, the fallback and its reason, the take state.
- [X] T056 [P] [US3] In `page/session-view.tsx`, pass `producing` as `{ seq, label }` ("filling…" / "writing slot N…") so the rundown can mark the row being produced; the status line under "Now playing" reads `<Kind> · slot N of M`.
- [X] T057 [US3] Quickstart §5–§6 visual pass on a phone-width window: nothing overflows; "coming up" rows dim; the on-air row lit. Commit.

**Checkpoint**: The show reads as one list.

---

## Phase 6: User Story 4 — The station owner sets the clock (Priority: P3)

**Goal**: The three settings shape every show and are read per request; absent means fail loudly.

**Independent Test**: change break-every on `/settings` and see breaks move; change fill and see a
fill's count change; remove the row and see a request fail naming it.

- [X] T058 [US4] On `/settings`, set `breakEvery 3, fill 4, lowWater 1`; start a session; expect breaks at 1, 4, 7, fills of 4, the next fill when one unwritten slot remains. Restore 5/6/2.
- [X] T059 [US4] Prove the missing-row fault: with the `clock` row absent (rename its key by hand in the database once, or start a fresh database), `GET /api/sessions/:id` and `POST …/fill` respond 500/502 with `settings row clock is missing — fill it on /settings`; restore. Update the rail's lamp/`Fault` copy in `web/app/(settings)/settings/page.tsx` if the state is not obvious.
- [X] T060 [US4] Commit: "The clock is a setting: break every, fill, low water".

---

## Phase 7: User Story 5 — The old world goes away cleanly (Priority: P3)

**Goal**: No segment, card, compose, program or audio-rung code or docs remain as current; the
words are the domain's; the gate is green; the source is smaller.

**Independent Test**: quickstart §9 — the retired-words grep finds only prose; the schema lists
four tables; the pre-push gate and the build pass.

- [X] T061 [P] [US5] Rewrite `docs/sessions.html` from `specs/004-slot-first/contracts/sessions-api.md`: in one breath, the rules of the dance, create, the snapshot and the frontier (`nextMove`), the fill rung, the slot rung (precedence, the brief, the voicing failure), the clip, the track (HEAD → row, pull), cold start end to end, when a rung fails. Tags "built".
- [X] T062 [P] [US5] Delete `docs/api.html`; in `docs/domain.html` change the subtitle to "In the schema since 2026-09-0X" and drop the `api.html` link from the nav; keep the "What goes away" table as history.
- [X] T063 [P] [US5] Rewrite `CLAUDE.md`: "Where things live" (`api/sessions/`: `fill`, `write`, `rules`, `shapes`, `doc`, `params`, `qobuz`, `weather`, `headlines`; `(app)/sessions/[id]/`: `loop`, `plan`, `transport`, `use-deck`, …; `lib/clock`), "How it works" (the show is slots; the fill; the slot rung; the track; the loop one ahead; the clock), "Working here" (`db:clear --tracks`; the four tables; the docs are `sessions.html` and `domain.html`), the retired-words rule, the memory line about old sessions.
- [X] T064 [US5] Retired-words sweep: `rg -n -i "record|song|card|candidate|playlist|segment|program" apps/web/src db --glob '!*.test.ts'`; rename any identifier that survives (`recordUrl` → `trackUrl`, `RECORD_FULL` → `TRACK_FULL`, `recordUnderMs` stays — it is the writer's word for the timing and in the schema; decide and record in CLAUDE.md), leave prose that says what a thing *was*. `rg -n "segments/|session_segment|\bcard\b" docs/sessions.html docs/domain.html CLAUDE.md` → only history tables.
- [X] T065 [US5] Dead-code pass: `voice-cache.ts` exports still used (`prefetch`, `drop` — delete if no consumer), `identity.ts` comment ("read per slot"), `web/proxy.ts` exempt list unchanged, `apps/web/package.json` description ("the deck: the clips and the tracks mixed in the browser").
- [X] T066 [US5] `pnpm check && pnpm --filter web build` green; compare `apps/web/src` line count with T001's baseline (SC-006). Commit: "Segments, cards, the compose step and the split rungs go; the docs say slots".

---

## Phase 8: Polish & cross-cutting

- [X] T067 [P] Update `docs/slot-first.md` "Open" section with what was chosen (three slots' copy + everything played; "coming up" rows) and a line pointing at `specs/004-slot-first/research.md`.
- [X] T068 [P] Update the auto-memory file `slot-first-refactor.md` (in the Claude profile's memory dir): implemented on <date>, cutover applied, what is left (Railway deploy, flip `GUARD_OPEN`).
- [X] T069 Push the branch; open a PR titled "Slot-first: the show is a list of slots, produced one ahead of the listener" with the spec's summary and the quickstart's evidence lines; note the one-time `db:clear --tracks` in the PR body.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 → Phase 2**: baseline then foundations.
- **Phase 2 → Phase 3**: every route imports `rules`, `shapes`, `doc`, `params`, `clock`; the
  schema files must exist before `db:plan`; the clock editor must exist before the cutover can
  seed the row.
- **Phase 3 (US1) → Phases 4–7**: nothing plays without US1; US2–US5 are layered on it.
- **US2, US3, US4** are independent of each other after US1 and can proceed in any order or in
  parallel by different people (different files: `session-view.tsx` is touched by US2 and US3 —
  do T049 before T056 or merge carefully).
- **US5** last: it deletes and documents what the others left.
- **Phase 8** after everything.

### Within Phase 2

- T003→T004→T005; T006/T007→T008 (the editor before the page); T009→T010→T011;
  T012→T013; T014→T015→(T016→T017 uses `Hit`); T018; T019→T020; T021; T022/T023/T024→T025.
- All `[P]` test-writing tasks (T003, T009, T012, T014, T016, T018, T019) can be written together
  first; then their implementations.

### Within Phase 3

- T026→T027 and T028→T029 in parallel (different files); both before T032/T033.
- T030, T031, T034, T035 in parallel once T017 exists; T033 after T013/T015/T017/T027/T028.
- T036 after every new route exists. T037→T038→T039; T040/T041/T042 in parallel with T038.
- T043 gate → T044→T045→T046→T047→T048 strictly in order (the cutover).

## Parallel example: Phase 2 tests first

```text
Write together: T003 lib/clock.test.ts · T009 sigv4 HEAD case · T012 rules.test.ts ·
                T014 shapes.test.ts · T016 doc.test.ts · T018 params.test.ts · T019 loop.test.ts
Run: pnpm test   → all red
Then implement:  T004 · T010 · T013 · T015 · T017 · T018 · T020 · T021
Run: pnpm test   → all green
Meanwhile:       T022 · T023 · T024 (schema files) → T025 db:plan review
```

## Parallel example: Phase 3 routes

```text
After T027/T028: T030 create · T031 snapshot · T034 clip · T035 track   (four files, no shared state)
Then:            T032 fill · T033 slot                                   (each reads fill.ts / write.ts)
Browser at the same time: T037 types → T038 deck ‖ T040 rundown ‖ T041 player ‖ T042 home
```

## Implementation strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** That is the whole cutover: the new schema applied,
the four routes, the loop writing slot 1, and the first song after two model calls. Stop there and
validate with quickstart §5.

**Then increment**: US2 (one ahead, refill, breaks by the clock) is mostly verification plus the
⏭ guard; US3 is the rundown; US4 is the clock proven; US5 is the sweep and the docs. Each ends in
a commit and is demonstrable on its own.

## Notes

- Every `[P]` task touches different files from its siblings.
- Tests are written first and seen red (`pnpm test`) before the implementation task begins.
- Commit after each checkpoint at least; the cutover (T044–T048) is one commit on its own.
- The one irreversible step is T044/T045 (`db:clear --tracks`, `db:apply`); everything before it
  leaves the running database untouched.
- Prompts stay inline in `fill.ts` and `write.ts` (CLAUDE.md's choice); no settings row for them.
