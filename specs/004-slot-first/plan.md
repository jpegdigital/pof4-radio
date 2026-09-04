# Implementation Plan: Slot-First Show

**Branch**: `004-slot-first` | **Date**: 2026-09-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-slot-first/spec.md`; the design in
`docs/slot-first.md` and `docs/domain.html`.

## Summary

Turn production from depth-first (a whole segment: playlist → cards → program → clips) into
breadth-first, one slot at a time. The show becomes one table, `session_slot`, filled a few
proposals at a time by a **fill** rung (one proposer call + Qobuz search) and written one slot at a
time by a **slot** rung (one writer call that picks the version, charts the track, writes the copy
and sets the timing, then voices it in the same request). The track is pulled by the browser the
moment the pick is known. The browser runs the loop one slot ahead of the listener and refills at a
low-water mark; the server decides what each slot is from the clock settings. Segments, cards, the
compose step, the split rungs and the first build's tables are removed. First sound after two model
calls instead of four; the show runs as long as the listener listens.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node ≥ 24 (fnm, `.node-version`); React 19.2; Next 16.3
route handlers and Server Components; pnpm 10 workspace with one app (`apps/web`).

**Primary Dependencies**: `@anthropic-ai/sdk` (structured outputs via `messages.parse` +
`zodOutputFormat`), `zod` 4, `pg` (plain SQL at the call site), `jose` (Guard). No additions.
Qobuz, ElevenLabs, NWS and Google News are plain `fetch`; the bucket is hand-rolled SigV4.

**Storage**: One Railway Postgres (database `radio`), declarative schema in `db/schema/*.sql`
diffed by `@supabase/pg-delta` (`pnpm db:plan` / `db:apply`, no migration files). One bucket
(`radio-clips`) for clips (`sessions/<id>/<seq>.mp3`) and tracks (`tracks/<qobuz id>.mp3`).

**Testing**: Vitest, pure logic only (`*.test.ts` beside the code, table-driven `it.each`). Live
paths proven by `apps/web/scripts/bucket-smoke.mts` and `qobuz-smoke.mts` under `op run`.

**Target Platform**: Railway (`radio-web` in project `pof4`), behind Guard; dev at
`https://dev.radio.pof4.com:3000` against the same database and bucket.

**Project Type**: Web app — one Next app holding the browser (state machine), the API (stateless
functions) and the control room.

**Performance Goals**: First sound after exactly two model calls (fill, slot 1) with the pull
under the second; every later slot written, voiced and pulled inside the previous record's
playing time; a reload costs zero model calls.

**Constraints**: No worker, no queue, no polling — the response is the product. One session
producer at a time (`for update nowait`, 409). Nothing judged by Claude on `track`. No defaults
for the clock in code. No new packages. LF line endings, Biome format, `pnpm check` green.

**Scale/Scope**: One listener at a time per session; a handful of sessions a day. ~25 source
files touched or replaced; 4 tables dropped, 2 rewritten, 1 settings row added.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template (R13); the binding standards are
`.claude/rules/coding-standards.md` and `CLAUDE.md`.

| Principle | Check | Status |
|---|---|---|
| I. Progressive complexity (WET → SOLID → YAGNI) | The refactor *removes* abstractions (compose, cards, two rungs, the `Knobs` layer). New pure helpers each have a concrete consumer: `isBreak`/`legalIdDue`/`checkSlot` (the slot rung), `nextMove` (the page), `loadClock` (two rungs + snapshot + settings). `bucket.head` has one consumer (the pull) and closes a real gap (R9); accepted as one method beside `open`, not a layer. No helper is promoted to `lib/` unless three consumers exist: `qobuz.ts` stays in `api/sessions/` with two. | PASS |
| II. TDD, table-driven | Every new pure function lands red-first with `it.each` give/want tables (quickstart §1). Live paths (Postgres, Qobuz, Claude, ElevenLabs, bucket) are verified by the smoke scripts and the quickstart, never in CI. | PASS |
| III. Fail fast & loud | Missing `settings.clock` throws naming the key; a pick outside the hits is rejected; every route logs URL-level context and returns a structured `{ error }`; no bare `catch` (the two `catch {}` on `JSON.parse` of a request body remain the existing, bounded pattern that returns 400). | PASS |
| IV. Configuration as data | The clock is a settings row edited on `/settings`; house limits stay named constants in `rules.ts` / `plan.ts`; the prompts stay inline at the call site (CLAUDE.md's stated choice). | PASS |
| V. Code style | Route handlers stay straight-line; SQL at the call site; strongest types (`SlotRow`, `SlotDoc`, `Written`); the domain's words only (FR-030). | PASS |
| VI. Banned patterns | No TODOs, no god module (`doc.ts` stays the wire shape only; `rules.ts` the law only; `fill.ts` / `write.ts` one call each), no magic numbers in logic (the clock and the house constants are named). | PASS |
| CLAUDE.md: minimize dependencies | Zero new packages; `HEAD` is one more SigV4 request shape. | PASS |
| CLAUDE.md: browser decides when, server decides what | `nextMove` lives in the browser and sends only `seq` + `clockMs`; the kind is the server's. | PASS |

**Post-design re-check (after Phase 1)**: unchanged — the data model has one table for the show,
the contract has five routes, and every new function in the structure below names its consumer.
No entries for Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/004-slot-first/
├── plan.md              # this file
├── spec.md
├── research.md          # R1–R13: the implementation choices and their alternatives
├── data-model.md        # session_slot, track, settings.clock; status derivation; transitions
├── quickstart.md        # how to prove it: tests, gate, cutover, smoke, live scenarios
├── contracts/
│   └── sessions-api.md  # the five routes, the documents, the browser's loop
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
db/
├── schema/
│   ├── common.sql                 # unchanged
│   ├── session.sql                # comment updated (slots, not segments)
│   ├── session_slot.sql           # REWRITTEN per data-model.md
│   ├── settings.sql               # header comment rewritten; lists `clock`
│   ├── track.sql                  # REWRITTEN: tags columns, `name` → `title`
│   ├── card.sql                   # DELETED
│   ├── session_segment.sql        # DELETED
│   ├── station.sql                # DELETED
│   └── segment.sql                # DELETED
├── clear.mts                      # also clears `track` (the cutover; kept as `--tracks` flag or one-time note)
├── schema.mts, sql.mts            # unchanged

apps/web/src/lib/
├── clock.ts                       # NEW, pure: CLOCK_KEY, Clock zod schema (client-safe)
├── clock.test.ts                  # NEW
├── settings.ts                    # + loadClock()
├── bucket.ts                      # + head(key): { contentLength } | null
├── sigv4.ts / sigv4.test.ts       # HEAD covered (no change if the signer is method-agnostic; test added)
└── identity.ts, voices.ts, …      # unchanged

apps/web/src/app/api/sessions/
├── route.ts                       # POST create: no segment insert
├── [id]/route.ts                  # GET snapshot: clock + slots
├── [id]/fill/route.ts             # NEW: the fill rung
├── [id]/slots/[seq]/route.ts      # NEW: the slot rung (write + voice)
├── [id]/slots/[seq]/clip/route.ts # NEW: GET the clip (from …/segments/…/slots/[seq]/audio GET)
├── [id]/slots/[seq]/track/route.ts# NEW: POST pull / GET stream (from …/tracks/[seq]/audio)
├── [id]/segments/**               # DELETED (four routes)
├── fill.ts                        # NEW: the proposer call + search + dedupe (from playlist.ts + select.ts)
├── fill.test.ts                   # NEW: searchQuery, dedupe (from select.test.ts)
├── write.ts                       # NEW: the writer call and its brief (from program.ts + cards.ts prompt)
├── rules.ts / rules.test.ts       # REWRITTEN: isBreak, legalIdDue, checkSlot, RULES_TEXT
├── shapes.ts / shapes.test.ts     # Proposal, Written, SLOT_KINDS, numbered; Choice/CardFacts/Slot gone
├── doc.ts / doc.test.ts           # SlotRow, SlotDoc, statusOf, slotDoc(row, held); segment shapes gone
├── params.ts / params.test.ts     # SessionParams + SlotBody; Knobs gone
├── qobuz.ts, weather.ts, headlines.ts (+ tests)  # unchanged
├── playlist.ts, select.ts, select.test.ts, cards.ts, program.ts, program.test.ts  # DELETED

apps/web/src/app/(app)/
├── page.tsx                       # session log query: count of slots, not segments
├── home-desk.tsx                  # "N slots" instead of "N segments" (label only)
├── sessions/[id]/
│   ├── types.ts                   # SlotDoc/SessionDoc/Clock/Cue per contract; Segment gone
│   ├── loop.ts / loop.test.ts     # NEW, pure: nextMove(slots, clock, cueSeq, attempted)
│   ├── session-view.tsx           # the loop; fires the pull; flat cues
│   ├── use-deck.ts                # load = clip + track (no slot POST, no `voicing` phase, no `warm`)
│   ├── plan.ts / plan.test.ts     # introMs → rampMs
│   ├── rundown.tsx                # flat list; "coming up" rows; chart in Detail
│   ├── player.tsx, transport.ts   # unchanged (Cue loses `num`)
│   └── page.tsx                   # unchanged
└── lib/voice-cache.ts             # unchanged

apps/web/src/app/(settings)/settings/
├── page.tsx                       # + Clock in the rail and editor
├── actions.ts                     # + saveClock
└── clock-editor.tsx               # NEW (three integer fields, like identity-editor)

apps/web/scripts/
└── bucket-smoke.mts               # + HEAD present/absent

docs/
├── domain.html                    # retitled "in the schema"; nav loses api.html
├── sessions.html                  # REWRITTEN from contracts/sessions-api.md
├── api.html                       # DELETED
└── slot-first.md                  # unchanged (the decision record)

CLAUDE.md                          # "How it works" and "Where things live" rewritten for slots
```

**Structure Decision**: The existing three-place layout holds (`lib/` for process concerns,
`api/sessions/` for the server with its files beside the routes, `(app)/` for the browser). The
only structural change is inside `api/sessions/`: four segment routes become four slot routes,
and five producer files (`playlist`, `select`, `cards`, `program`, and the segment half of `doc`)
become two (`fill`, `write`) plus a smaller `rules` and `doc`.

## Phase 0 — Research (done)

`research.md` records R1–R13. No `NEEDS CLARIFICATION` remained after reading the code: every
open point had either a decision in `slot-first.md` or a single sensible implementation.

## Phase 1 — Design (done)

- `data-model.md`: the two rewritten tables, the settings row, the status derivation, the
  validation rules, the transitions, what is dropped.
- `contracts/sessions-api.md`: the five routes, precedence inside the slot rung, the documents,
  the browser's loop.
- `quickstart.md`: red-first test tables, the gate, the cutover, the smoke scripts, the live
  scenarios for each user story, the failure paths, the retired-words grep.

## Phase 2 — Implementation order (for `/speckit-tasks`)

The order keeps the app buildable at every commit except the cutover commit, which is the one
that swaps the routes and the schema together.

1. **Pure foundations, red first** — `lib/clock.ts`, `rules.ts` (isBreak, legalIdDue, checkSlot),
   `shapes.ts` (Proposal, Written), `doc.ts` (slot status + doc), `loop.ts` (nextMove), `plan.ts`
   rename, `bucket.head` + sigv4 test. Each with its `it.each` table.
2. **Schema** — the four `.sql` files; `pnpm lint` (`pgdelta schema lint`) green; `db:plan`
   reviewed but not applied yet.
3. **Server** — `fill.ts`, `write.ts`, the five routes, `loadClock`; delete the segment routes and
   the five old producer files; `pnpm --filter web typecheck`.
4. **Browser** — `types.ts`, `session-view.tsx` (the loop, the pull), `use-deck.ts`,
   `rundown.tsx`, `page.tsx`/`home-desk.tsx`.
5. **Control room** — clock editor and action.
6. **Cutover** — `db:clear` (sessions + tracks), `db:apply`, seed the clock on `/settings`, smoke
   scripts, quickstart §5–§8 live.
7. **Docs and memory** — `sessions.html` rewritten, `api.html` deleted, `domain.html` retitled,
   `CLAUDE.md` updated; `pnpm check && pnpm --filter web build`.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The writer's `Written` shape is large (pick + 8 chart fields + 6 copy fields + 2 timings) and the grammar-constrained call could get slow or refuse more | Same `effort: "medium"` and adaptive thinking as today's program call, which already returns N slots × 6 fields; one slot × 17 fields is smaller. One retry, then the no-chart segue (R3). |
| Prior charts from other sessions make the brief long | Capped at three, newest first, one line each. |
| The one-ahead loop leaves a gap if slot *k+1*'s write takes longer than record *k* | Records run 3–5 min; a write + voicing runs 20–60 s today. The deck shows "loading…" rather than silence if it happens; a two-ahead knob is a one-line change in `nextMove` if evidence appears. |
| `pgdelta` orders the drop of `session_segment` after the recreate of `session_slot` (FK) | `db:plan` output is reviewed in step 2; the old `session_slot` FK to `session_segment` is dropped with the table. |
| Old clip keys (`sessions/<id>/<num>/<seq>.mp3`) orphaned in the bucket | Sessions are wiped; the bytes are small and "kept forever" is the policy anyway. |
