# Implementation Plan: Program Pipeline

**Branch**: `002-program-pipeline` | **Date**: 2026-08-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-program-pipeline/spec.md`

## Summary

A request becomes a pre-generated, playable hour on `/program` through five stages — discovery,
enrichment, log, script, voicing/assembly — each a stateless function that reads the previous
stage's JSON file and writes its own under `apps/web/public/program/make/`. Discovery, log and
script are one Opus call each (log and script in serial, the log frozen before words are written);
enrichment is one Opus call per record, fanned out, cached on disk by Spotify id. Assembly is a
pure function: it turns the script plus the measured clips into the `Element[]` the existing
reducer already plays, deriving every timing from clip lengths, the cards, and house constants,
with a named fallback recorded on every element that couldn't have the good version. The whole
thing lives inside the `(program)` route group: stage functions and prompts in `program/make/`,
one route handler per stage, and a `/program/make` page to run and re-run stages from the browser.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24 (fnm), Next 16.3 app router, React 19

**Primary Dependencies**: `@anthropic-ai/sdk` (already in `apps/web`), `zod` 4, existing
`lib/claude.ts`, `lib/spotify.ts` (`appAccessToken` + `search`), `lib/voices.ts` (`loadVoices`),
`@radio/dj`'s `ttsBody`. No new packages.

**Storage**: JSON + mp3 files under `apps/web/public/program/make/` (gitignored, dev machine
only). The card cache is a directory of one file per record. No database rows.

**Testing**: Vitest, pure logic only (`*.test.ts` beside the code): the stage schemas, the clock-rule
validation of a log, the assembly timing/fallback ladder. Claude / Spotify / ElevenLabs paths are
verified live via `quickstart.md`.

**Target Platform**: The dev server (`https://dev.radio.pof4.com:3000`). The `make` routes write to
the app's own `public/` directory and refuse to run in production (`NODE_ENV === "production"` →
404), so nothing here can ever run on Railway.

**Project Type**: Web app (Next), a sandbox feature inside one route group.

**Performance Goals**: request → playable program in < 5 min for ten records; a re-run from the
script stage < 1 min (SC-001, SC-003).

**Constraints**: Spotify plays one track at a time (no crossfade); the reducer's `Element`
shape is the contract and is not changed except by optional, additive fields; all timings derived,
none searched (FR-017); every stage idempotent and re-runnable from its input file (FR-004).

**Scale/Scope**: One operator, one program at a time, ~10–14 records per program, one card cache
that grows with the catalogue.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template, so the effective constitution is
`CLAUDE.md`'s philosophy. Gates derived from it:

| Gate | Status | Note |
|------|--------|------|
| No new dependencies | PASS | SDK, zod, fetch, `node:fs` only |
| Server = stateless functions, no worker/queue | PASS | each stage is one route handler that reads a file and writes a file; the browser sequences them |
| `packages/*` stay pure; `apps/*` own env | PASS | everything is in `apps/web`; nothing added to `packages/*` |
| Fewest moving parts | PASS | no DB table for cards (files), no job system, no streaming |
| Private behind Guard | PASS | `/program/make/*` sits under the same proxy as `/program`; additionally dev-only |
| Tests: pure logic only | PASS | schemas, clock rules, assembly |
| Containment in `/program` (spec FR-001) | PASS | see Project Structure; `/api/program/clock` is retired into `program/make/` |

No violations; Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-program-pipeline/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and alternatives
├── data-model.md        # Phase 1: the stage files and the card
├── quickstart.md        # Phase 1: how to run and verify live
├── contracts/
│   └── stages.md        # Phase 1: the /program/make/* route contracts and file contracts
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/web/src/app/(program)/program/
├── make/
│   ├── page.tsx               # the maker: request box, one button per stage, status + files (client)
│   ├── maker.tsx              # client component behind page.tsx
│   ├── [stage]/route.ts       # POST /program/make/{discover|enrich|log|script|voice}: run one stage
│   ├── stages.ts              # STAGES: order, input/output file per stage, runner dispatch
│   ├── files.ts               # the make/ directory: read/write/exists of stage JSON, clip files
│   ├── shapes.ts              # zod schemas for every stage file (+ types)
│   ├── shapes.test.ts
│   ├── ask.ts                 # one forced-tool Opus call (model, adaptive thinking, effort) → parsed input
│   ├── prompts.ts             # SYSTEM + the four briefs (discover, enrich, log, script); tool schemas
│   ├── discover.ts            # request → picks → resolved records (Spotify), dropped picks reported
│   ├── enrich.ts              # records → cards (parallel, cached by id, failures dropped)
│   ├── log.ts                 # cards → the log; validates it against the clock rules
│   ├── clock-rules.ts         # the house constants and the pure `checkLog()` validator
│   ├── clock-rules.test.ts
│   ├── script.ts              # log → script (one call, words per non-segue slot)
│   ├── voice.ts               # script → clips (ElevenLabs with-timestamps), then assemble
│   ├── assemble.ts            # pure: script + clips + cards → Program (Element[] + notes)
│   └── assemble.test.ts
├── manifest.ts                # PROGRAM_URL added; Clock/manifest types retired once program.tsx reads program.json
├── program.tsx                # loads /program/make/program.json; rundown shows treatment, words, fallbacks
├── reducer.ts                 # unchanged (Element is the contract)
└── use-program.ts             # unchanged

apps/web/public/program/make/  # gitignored output (see data-model.md)
├── request.json
├── picks.json
├── cards/<spotify-id>.json
├── log.json
├── script.json
├── program.json
└── clips/<slot>.mp3

apps/web/src/app/api/program/clock/route.ts   # deleted (folded into make/)
scripts/clock-prep.mjs                         # deleted (replaced by the maker)
scripts/program-prep.mjs                       # deleted (its bed/sweeper reuse noted in quickstart)
```

**Structure Decision**: Everything new is under `app/(program)/program/make/`. Route handlers are
allowed inside a route group, so the stage endpoints are `/program/make/<stage>`, next to the page
that drives them — the sandbox is one folder. The existing `/api/program/clock` and the two
`scripts/*-prep.mjs` files are superseded and removed; `scripts/sweepers-prep.mjs` stays (the
sweeper bench is separate). The player (`reducer.ts`, `use-program.ts`, `timeline.tsx`) is not
modified; `program.tsx` only changes where it loads the program from and what the rundown shows.

## Key design points (detail in research.md)

1. **Stages as route handlers, sequenced by the page** — not a script. Keeps "browser is the state
   machine, server is stateless functions", keeps every line inside the route group, and gives the
   operator a re-run button per stage. A stage is idempotent: it reads its input file, writes its
   output file, returns the output. The page runs all five in order for "Make", or one for a re-run.
2. **Two serial planning calls** (log, then script), each `tool_choice` forced to its finish tool,
   `claude-opus-5` via `CLAUDE_MODEL`, adaptive thinking on, `output_config.effort` per stage
   (discover `high`, enrich `medium`, log `high`, script `high`). Discovery is asked to reason in
   a `rationale` field and to be creative; the log is asked to follow `clock-rules.ts` and is
   validated by `checkLog()` after the call (violations → fallback treatments, recorded).
3. **Cards cached as files** keyed by Spotify id; `enrich` skips records with a card unless
   `?refresh=1`. Per-record calls run with `Promise.allSettled` at concurrency 5; rejected → dropped.
4. **Timing without searching**: the script returns `legalId`, `words`, `leadLine` as separate
   fields. Voicing concatenates them in a known order and asks ElevenLabs for alignment; `bedInMs`
   and `leadMs` are read at *known character offsets* (`legalId.length`, `text.length −
   leadLine.length`), never by searching. If alignment is missing or the offsets don't add up, the
   fallback applies (bed in at 0; song when the clip ends). Talk-ups use only the clip length and
   the card's `introMs`. The browser still measures every clip on load as it does today.
5. **Fallback ladder** in `assemble.ts`, pure and tested: talk-up → post-landed, else
   `TALKUP_LATE_MS` into the song, else plain song; break → lead under the last line, else hand-off
   at clip end; bed → at the legal ID's end, else at 0. Each fallback writes
   `{ fallback: { from, to, reason } }` on the program's notes for that element.
6. **`program.json` carries `Element[]` directly** plus a parallel `notes[]` (treatment, words,
   fallback) — the player needs no adapter, and the rundown reads the notes.

## Complexity Tracking

None — the Constitution Check passed without exceptions.
