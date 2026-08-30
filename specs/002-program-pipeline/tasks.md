# Tasks: Program Pipeline

**Input**: Design documents from `/specs/002-program-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/stages.md, quickstart.md

**Tests**: The plan names three pure-logic test files (`shapes.test.ts`, `clock-rules.test.ts`,
`assemble.test.ts`) — the repo's rule is "pure logic gets a test beside it; anything needing a
service is verified live". Those three are included; nothing else is tested by code.

**Organization**: Grouped by user story. Paths are relative to the repo root; `make/` below means
`apps/web/src/app/(program)/program/make/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

## Path Conventions

- App code: `apps/web/src/app/(program)/program/…` (the route group; everything new goes in `make/`)
- Output files: `apps/web/public/program/make/…` (gitignored)
- Shared server libs already present: `apps/web/src/lib/{claude,spotify,voices,env}.ts`

---

## Phase 1: Setup

**Purpose**: The folder, the output directory, the constants everything reads.

- [X] T001 Create `apps/web/src/app/(program)/program/make/` and add `apps/web/public/program/make/` to `.gitignore` (the existing `apps/web/public/program/` rule already covers it — confirm, and update the comment there to name the maker)
- [X] T002 [P] Write `make/clock-rules.ts`: export the house constants from data-model.md (`MIN_RECORDS`, `MIN_TALKUP_INTRO_MS`, `MIN_SONGS_BETWEEN_BREAKS`, `MAX_SONGS_BETWEEN_BREAKS`, `BEAT_MS`, `TALKUP_LATE_MS`, `LEAD_FALLBACK_MS`, `ENRICH_CONCURRENCY`) and a `RULES_TEXT` string that states the clock rules in prose for the log brief (so prompt and validator share one source)
- [X] T003 [P] Write `make/files.ts`: `MAKE_DIR` (resolved from `process.cwd()` → `public/program/make`), `readJson(name, schema)` (throws `MakeError(400, "<file>: <zod path> — <message>")` on invalid, `MakeError(409, "missing: <file>")` when absent), `writeJson(name, value)`, `writeClip(name, bytes)`, `listCards()`, `exists(name)`, `stat(name)`; `MakeError` carries an HTTP status

---

## Phase 2: Foundational

**Purpose**: The shapes, the Claude call, the route handler shell — every stage depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Write `make/shapes.ts`: zod schemas + inferred types for `Request`, `Pick`, `Record`, `Picks` (with `dropped[]`), `Card`, `Log` (+ `LogSlot`, `intro` enum), `Script` (+ `Line`), `Program` (+ `Note`, `Fallback`) exactly as data-model.md; `Program.elements` is typed as `Element[]` imported from `../reducer` (validated structurally with a permissive `z.custom` guard, not re-modelled)
- [X] T005 [P] Write `make/shapes.test.ts`: each schema accepts its data-model.md example and rejects one representative bad value (wrong enum, `energy: 6`, `outroMs > durationMs` is *not* checked here — note that it is the enrich stage's clamp)
- [X] T006 [P] Write `make/ask.ts`: `ask<T>(brief: string, tool: Anthropic.Tool, effort: "low"|"medium"|"high")` → `{ out: T; usage }` using `claude().messages.create` with `model: env().CLAUDE_MODEL`, `max_tokens: 16000`, `thinking: { type: "adaptive" }`, `output_config: { effort }`, `system: SYSTEM` (imported from prompts), `tools: [tool]`, `tool_choice: { type: "tool", name: tool.name }`; throw `MakeError(502, …)` on `stop_reason === "refusal"` or a missing tool_use block; every tool gets `strict: true` and `additionalProperties: false`
- [X] T007 [P] Write `make/prompts.ts`: `SYSTEM` (moved from `api/program/clock/route.ts`, unchanged in spirit) and four brief builders + four tool definitions — `discoverBrief(req)`/`DISCOVER_TOOL` (`finish_picks`: `rationale`, `picks[{artist,title,why}]`; the brief asks for `req.count` records, names the station's format, and explicitly invites creativity: deep cuts welcome, surprises welcome, one line on why the set hangs together), `enrichBrief(record)`/`ENRICH_TOOL` (`finish_card`: all card fields incl. a `thinking` field asked for *first* — "think out loud about how this record starts and ends, then fill the card"), `logBrief(req, records, cards, hourAtSeq)`/`LOG_TOOL` (`finish_log`: `slots[{id,intro,why}]` — order and treatment only, `RULES_TEXT` inlined, `hourAtSeq` stated as a fact, "do not write any words"), `scriptBrief(req, records, cards, log)`/`SCRIPT_TOOL` (`finish_script`: `lines[{seq,legalId?,words,leadLine?}]`, the word-count rules from the old `wordsBrief`, `leadLine` = "the one sentence that leads into the song, returned separately and NOT repeated in words", `legalId` only on the top-of-hour slot)
- [X] T008 Write `make/stages.ts`: `STAGES = ["discover","enrich","log","script","voice"] as const`, `Stage` type, `runStage(stage, ctx: { body?, refresh })` dispatching to the stage modules (T011–T015, T018, T020, T023 — stubs until then), each returning `{ result, usage?, ms }`
- [X] T009 Write `make/[stage]/route.ts`: `POST` — 404 when `process.env.NODE_ENV === "production"`; validate `params.stage ∈ STAGES` (404 otherwise); parse optional JSON body; `refresh = searchParams.get("refresh") === "1"`; call `runStage`; map `MakeError.status` → response; unknown errors → 502 with the message; also export `GET` that answers only for `stage === "status"` with the `{ files }` shape from contracts/stages.md (use `files.ts` `stat`/`listCards`)
- [X] T010 Delete `apps/web/src/app/api/program/clock/route.ts`, `scripts/clock-prep.mjs`, `scripts/program-prep.mjs`; in `apps/web/src/app/(program)/program/manifest.ts` remove `Manifest`, `Clip`, `Clock`, `ClockSlot`, `toElements`, `toClockElements`, `MANIFEST_URL`, `CLOCK_URL`; add `PROGRAM_URL = "/program/make/program.json"`, change `clipUrl` to `(clip) => clip.startsWith("slot-") ? `/program/make/clips/${clip}.mp3` : `/program/${clip}.mp3``(sweepers and the bed keep their old paths); delete `manifest.test.ts` or reduce it to the `clipUrl` cases; update `clock/page.tsx` to stop importing removed types (it becomes a link to `/program/make` or is deleted — delete it)

**Checkpoint**: `pnpm check` passes with the stage stubs; `POST /program/make/status` (GET) returns the files map.

---

## Phase 3: User Story 1 — A prompt becomes a program (Priority: P1) 🎯 MVP

**Goal**: Request in, `program.json` + clips out, `/program` plays it.

**Independent Test**: quickstart.md §1 — press Make, then Run on `/program`.

- [X] T011 [US1] Write `make/discover.ts`: `discover(body)` → validate as `Request` (`count` clamped 10–14, `dj` and `station` filled from `loadVoices()[0].name` and constants when absent), write `request.json`; `ask(discoverBrief, DISCOVER_TOOL, "high")`; resolve each pick with `lib/spotify.ts` `search(`${title} artist:${artist}`, 5)` → first hit → `Record` (`id` = uri tail, `pick` = index); dedupe by `id`; unresolved → `dropped[{pick, reason}]`; `records.length < MIN_RECORDS` → `MakeError(422)`; write and return `picks.json`
- [X] T012 [US1] Write `make/enrich.ts`: `enrich({ refresh })` → read `picks.json`; for each record without a valid card (or all when `refresh`) run `ask(enrichBrief, ENRICH_TOOL, "medium")` under a semaphore of `ENRICH_CONCURRENCY` with `Promise.allSettled`; clamp `outroMs ≤ durationMs`, stamp `enrichedAt`/`model`, validate as `Card`, write `cards/<id>.json`; rejected/invalid → move the record to `picks.json.dropped` with the reason and delete any stale card; return `{ cards, dropped, reused }` (US3 verifies the cache path; the code lands here because US1 needs cards)
- [X] T013 [US1] Write `make/clock-rules.ts` `checkLog(log, cards, records, startMs)` (pure): computes each slot's start time from `startMs` + durations (+ nothing for talk; breaks are counted as 30 s), derives `crossesHour`/`hourAtSeq`, enforces: every record once; `slots[0].intro === "break"`; `talkup` requires `card.sure && introMs ≥ MIN_TALKUP_INTRO_MS` else → `segue` (fallback recorded); two breaks < `MIN_SONGS_BETWEEN_BREAKS` apart → the later becomes `sweeper` (recorded); gap > `MAX_SONGS_BETWEEN_BREAKS` → warning only; `topOfHour` allowed only at `hourAtSeq`, at most once, forced there when `crossesHour` and the slot is a break (else recorded as a warning); returns `{ log, fallbacks, warnings }`; also export `hourAtSeqOf(records, startMs)` used before the log call
- [X] T014 [P] [US1] Write `make/clock-rules.test.ts`: one case per rule in T013, plus "a valid log passes untouched" and "`hourAtSeqOf` returns null when the program ends before the hour"
- [X] T015 [US1] Write `make/log.ts`: `log()` → read `request.json`, `picks.json`, cards (records without a card are skipped and reported); `hourAtSeq = hourAtSeqOf(...)`; `ask(logBrief, LOG_TOOL, "high")`; map ids → `seq`; `checkLog` → write `log.json` (with `fallbacks`, `crossesHour`, `hourAtSeq`); return it
- [X] T016 [US1] Write `make/script.ts`: `script()` → read request, picks, cards, `log.json`; `ask(scriptBrief, SCRIPT_TOOL, "high")`; drop lines for segue slots; strip `legalId` from non-top slots and `leadLine` from non-breaks; validate as `Script`; write `script.json`; return it
- [X] T017 [US1] Write `make/assemble.ts` (pure): `assemble({ request, records, cards, log, script, clips: Map<seq, ClipInfo | { error }>, sweepers: string[] })` → `Program`; per slot: `break` → `{kind:"break", clip:"slot-<seq>", bed: BED, bedInMs, leadMs, label}` + song; `sweeper` → break element with the voiced line or a `/program/sweepers` clip (round-robin) when the line is empty, `leadMs: 0`; `talkup` → song with `talk:{clip, over:"intro", atMs}`; `segue` → song. Timing ladder with `Fallback{from,to,reason}` in the note: talk-up `atMs = introMs − clipMs − BEAT_MS` when `card.sure && atMs ≥ 0`, else `TALKUP_LATE_MS` (`post→late`), else (clip error) plain song (`late→none`); break `leadMs` from clip info when present and `< clipMs`, else `LEAD_FALLBACK_MS` (`lead→end`); `bedInMs` from clip info when present, else 0 (`bedIn→start`); missing words on a break → sweeper if any, else segue (`break→sweeper|segue`); a clip error on a break → same. Every element with a clip gets a `Note`
- [X] T018 [P] [US1] Write `make/assemble.test.ts`: one case per rung of the ladder in T017, "everything fell back is still a valid Program with one song per record", and "notes[i].element points at an element carrying that clip"
- [X] T019 [US1] Write `make/voice.ts`: `voice()` → read everything, `loadVoices()[0]`; for each script line build `text = [legalId, words, leadLine].filter(Boolean).join(" ")`; POST ElevenLabs `/v1/text-to-speech/<id>/with-timestamps?output_format=mp3_44100_128` with `ttsBody(voice, text)` (from `@radio/dj`) and `ELEVENLABS_KEY` from `env()`; write `clips/slot-<seq>.mp3`; compute `ClipInfo{ clipMs, bedInMs?, leadMs? }` from alignment at known offsets (`legalId.length + 1`; `text.length − leadLine.length`), each validated (index in range, monotonic, `leadMs < clipMs`) else omitted; a failed TTS → `{ error }`; list `/program/sweepers/sweep-*.mp3` names if the sweepers manifest exists; call `assemble`; write `program.json`; return it with the per-clip failures
- [X] T020 [US1] Fill `make/stages.ts` dispatch with T011/T012/T015/T016/T019 and delete the stubs
- [X] T021 [US1] Write `make/maker.tsx` (client) + `make/page.tsx` (server: passes the roster's default voice name and the station constants): request textarea (prefilled), station/DJ fields, count, **Make** (POSTs the five stages in sequence, aborting on the first non-200, `fetch` with no timeout under 180 s), per-stage row showing state (idle/running/ok/error), elapsed ms, usage, and a link to the stage file under `/program/make/…`; on mount GET `status` to paint which files exist
- [X] T022 [US1] Update `apps/web/src/app/(program)/program/program.tsx`: fetch `PROGRAM_URL` (typed `Program`), pass `elements` to `Desk`, pass `notes` down; the "no program" message links to `/program/make`; in the rundown (`timeline.tsx` rows or the list in `program.tsx`) show per element its treatment, words (collapsible), and a small fallback badge with the reason when a note has one
- [X] T023 [US1] Add a `/program/make` link to `apps/web/src/app/(program)/layout.tsx` header, next to "← the station"

**Checkpoint**: quickstart.md §1 passes; `pnpm check` and `pnpm --filter web build` pass.

---

## Phase 4: User Story 2 — Inspect and re-run from any stage (Priority: P2)

**Goal**: Any stage re-runs alone from its files; malformed input is named.

**Independent Test**: quickstart.md §2 and §5.

- [X] T024 [US2] In `make/maker.tsx` add a **Run** button per stage row (enabled when `status` says its input file exists), and a "re-run from here" action that runs that stage and every later one
- [X] T025 [US2] In `make/files.ts` ensure `readJson` errors carry the file name and the first zod issue path in the message (`log.json: slots[0].intro — Invalid enum value…`) and that `route.ts` returns them as `400`; add the `409 missing:` case to the maker's row error display
- [X] T026 [US2] In each stage module, confirm writes are limited to that stage's own outputs (enrich may also rewrite `picks.json.dropped`); add a one-line comment at the top of each stage naming its reads and writes, matching contracts/stages.md

**Checkpoint**: editing `log.json` by hand and re-running `script`+`voice` reflects the edit without upstream calls.

---

## Phase 5: User Story 3 — Records are enriched once and remembered (Priority: P2)

**Goal**: The card cache is honoured, refreshable, and failures drop records cleanly.

**Independent Test**: quickstart.md §3.

- [X] T027 [US3] In `make/enrich.ts` return `reused[]` (ids with a valid existing card) and skip them unless `refresh`; an existing card that fails `Card` validation is treated as missing (re-enriched)
- [X] T028 [US3] In `make/maker.tsx` add a **refresh cards** checkbox on the enrich row that sends `?refresh=1`, and show `reused` / `dropped` counts in the row result
- [X] T029 [US3] In `make/log.ts` and `make/script.ts`, treat a record with no card as dropped for this run (reported in the response as `skipped[]`), never as a crash

**Checkpoint**: a second run over an overlapping set enriches only the new records.

---

## Phase 6: User Story 4 — Timing is best-effort and never breaks playback (Priority: P3)

**Goal**: Every fallback rung is exercised live and visible.

**Independent Test**: quickstart.md §4.

- [X] T030 [US4] In `make/voice.ts` make a TTS failure per clip non-fatal: catch, record `{ error }`, continue; the response lists `failed[{seq, error}]`; `program.json` is written regardless
- [X] T031 [US4] In `make/assemble.ts` add the `reason` strings for each fallback exactly as quickstart.md §4 expects (`"<clipMs> ms clip over a <introMs> ms intro"`, `"no lead line"`, `"no legal ID"`, `"no words"`, `"clip failed: <error>"`) and cover them in `make/assemble.test.ts`
- [X] T032 [US4] In `program.tsx`'s rundown, the fallback badge shows `from → to` and the reason on hover/tap; a program in which every element fell back still renders and Runs

**Checkpoint**: each scenario in quickstart.md §4 produces the documented note and plays.

---

## Phase 7: Polish & Cross-Cutting

- [X] T033 [P] Update `CLAUDE.md`'s program section (it currently describes `scripts/*-prep.mjs` and `/api/program/clock`) to describe the maker: the five stages, the files under `public/program/make/`, and that `/program/make/*` is dev-only
- [X] T034 [P] Update `docs/handoff.md` where it references the prep scripts or the clock route
- [X] T035 Run `pnpm check` and `pnpm --filter web build`; fix lint/format (Biome, LF) and type errors
- [X] T036 Walk quickstart.md §1–§6 end to end and record any deviation in `specs/002-program-pipeline/quickstart.md`

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → Phase 3 (US1)** are strictly sequential; US1 is the MVP and carries most of the code.
- **US2, US3, US4** each depend on US1 and are otherwise independent of one another; they mostly refine files US1 created (`maker.tsx`, `enrich.ts`, `voice.ts`, `assemble.ts`), so run them one at a time if the same file is touched.
- Within US1: T011, T012 (need T004–T009) → T013/T014 → T015 → T016 → T017/T018 → T019 → T020 → T021–T023.

### Parallel opportunities

- Phase 1: T002 ∥ T003.
- Phase 2: T005 ∥ T006 ∥ T007 after T004.
- US1: T014 ∥ T013's follow-ups; T018 ∥ T019; T021 ∥ T022 ∥ T023 (different files).
- Polish: T033 ∥ T034.

## Parallel Example: Phase 2

```text
After T004 (shapes):
  Task: "Write make/shapes.test.ts"        (T005)
  Task: "Write make/ask.ts"                (T006)
  Task: "Write make/prompts.ts"            (T007)
```

## Implementation Strategy

1. Phases 1–2, then US1 in full → quickstart §1 → this is the MVP (a prompt becomes a program).
2. US2 (per-stage Run buttons and named errors) is small and makes iteration cheap — do it next.
3. US3 and US4 harden enrichment and timing; both are mostly verification plus small edits.
4. Polish: docs, `pnpm check`, build, the quickstart walk.
