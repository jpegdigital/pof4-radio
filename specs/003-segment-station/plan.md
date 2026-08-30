# Implementation Plan: Segment Station

**Branch**: `003-segment-station` | **Date**: 2026-08-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-segment-station/spec.md`

## Summary

The home page becomes the produced show, made live one **segment** at a time (a break + 3–5
songs) and kept forever. Three server calls replace the sandbox's five stage routes:
`POST /api/station/open` (request → station, the hour's skeleton, segment 1 written),
`POST /api/station/:id/next` (the next segment, written), `POST /api/segment/:id/voice`
(clips to the bucket, timings from alignment, `Element[]` assembled and kept). The sandbox's
pure logic — shapes, clock rules, `timingsOf`, `assemble` — is lifted into `packages/dj` and
simplified to the segment; the sandbox's three-lane reducer, effects hook and timeline are copied
into `components/station/` and extended to accept segments as they land. Cards move to a `card`
table shared by every station; the station's memory becomes its kept rows, not a conversation.
Clips are signed into the Railway bucket by hand (SigV4 over `fetch`) and served by the app.
`(program)` is not touched and nothing on the home path imports it.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24 (fnm), Next 16.3 app router, React 19

**Primary Dependencies**: `@anthropic-ai/sdk`, `zod` 4, `pg` — all present. **No new packages**
(the bucket client is Web Crypto + `fetch`, R4).

**Storage**: Postgres (`radio` database, shared dev/prod): `station` (changed), `segment`
(changed), `card` (new), `settings` (new rows). Railway bucket `clips` for mp3s (keys per
station/segment/seq). Static: `public/bed.mp3`, optional `public/sweepers/`.

**Testing**: Vitest, pure logic only: shapes, per-segment clock rules, timings from alignment,
the assembly ladder, SigV4 against the AWS test vector, the reducer. Everything touching
Postgres / Spotify / Claude / ElevenLabs / the bucket is verified live per `quickstart.md`.

**Target Platform**: `radio-web` on Railway (production) and the dev server; the routes are
production routes (unlike the sandbox's).

**Project Type**: Web app (Next), one service; `packages/*` pure, `apps/web` owns env.

**Performance Goals**: opening heard ≤ 60 s from Run cold, ≤ 30 s warm (SC-001); next segment
voiced before the current one ends (SC-002); replay makes zero production calls (SC-003).

**Constraints**: browser is the device and the state machine; server stateless; one producer per
station (row lock → 409); kept segments immutable; timings computed server-side, never measured
in the browser; no dependency from the home path on `(program)`.

**Scale/Scope**: a handful of listeners, one station each; 3–5 records per segment, 10–14 per
skeleton; the `card` table grows with the catalogue.

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template; the effective constitution is
`CLAUDE.md`. Gates derived from it:

| Gate | Status | Note |
|------|--------|------|
| No new dependencies | PASS | SigV4 by hand (R4); everything else already in the tree |
| Server = stateless functions, nothing runs when nobody listens | PASS | three route handlers, each one request → one kept row; no worker |
| `packages/*` never read env | PASS | producer logic in `packages/dj/src/program/`; env/db/bucket/Claude in `apps/web/src/lib/` |
| Prompts are settings, rules in code | PASS | four slots + identity row (R9); `RULES_TEXT`, tools, `checkLog` in code |
| One database, declarative schema, no migrations | PASS | `schema/*.sql` diffed by `db:plan` |
| Guard is the one gate | PASS | new routes are not exempt; `/api/clip` included |
| Sandbox deletable | PASS | copies, not imports (R7); grep check in quickstart §6 |

Post-design re-check: unchanged. Complexity table not needed.

## Project Structure

### Documentation (this feature)

```text
specs/003-segment-station/
├── plan.md              # this file
├── research.md          # R1–R10
├── data-model.md        # station / segment / card / settings / bucket keys
├── quickstart.md        # live verification
├── contracts/api.md     # open / next / voice / clip / station
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/db/
├── schema/station.sql           # changed: dj, voice_id, identity, skeleton; messages dropped
├── schema/segment.sql           # changed: records, lines, log, dropped, elements, notes, usage, written_at, voiced_at
├── schema/card.sql              # new
└── src/db.ts                    # types + queries: createStation, getStationWhole, lockStation(+commitSegment),
                                 #   listSegments, getSegment, voiceSegment, getCards, putCard, listStations

packages/dj/src/program/         # pure, lifted from the sandbox and cut to the segment
├── shapes.ts                    # Record, Card, Line, LogSlot, Note, Skeleton, SegmentView (zod)
├── clock-rules.ts               # constants, RULES_TEXT, checkSegmentLog(), hourTurnedSince()
├── timings.ts                   # textOf, timingsOf (alignment → clipMs/bedInMs/leadMs)
├── assemble.ts                  # lines + cards + clip infos → Element[] + Note[] (the ladder)
├── prompt.ts                    # PROMPT_SLOTS (system/discover/card/write), fillVars, tool schemas
└── *.test.ts

apps/web/src/lib/
├── bucket.ts                    # SigV4 put/get over fetch; bucket() from env (null if unset)
├── sigv4.ts (+ test)            # the signer, pure
├── env.ts                       # + BUCKET_* (optional as a group)
├── prompts.ts                   # loads the four slots + station.identity
└── producer/                    # apps-side orchestration (env, db, Claude, Spotify, ElevenLabs)
    ├── ask.ts                   # forced-tool call, adaptive thinking, effort (from the sandbox)
    ├── discover.ts              # hour skeleton: one call + search, shortest hit, played excluded
    ├── cards.ts                 # table first, enrich missing (≤5 parallel), refusal retried once
    ├── write.ts                 # one call: treatments + words for a segment; checkSegmentLog after
    ├── voice.ts                 # ElevenLabs with-timestamps (pool 3, break first) → bucket → assemble
    └── pool.ts

apps/web/src/app/api/
├── station/open/route.ts        # POST
├── station/[id]/route.ts        # GET (whole station)  — changed
├── station/[id]/next/route.ts   # POST
├── segment/[id]/voice/route.ts  # POST
└── clip/[segmentId]/[seq]/route.ts  # GET (streams from the bucket, immutable)
   (station/next/route.ts removed)

apps/web/src/components/station/  # the home page
├── reducer.ts (+ test)          # the three-lane reducer, + LOAD_SHOW / APPEND_SEGMENT / SEGMENT_PENDING
├── use-program.ts               # the seven effects + "produce ahead": open → voice, next → voice on first song
├── voice-cache.ts               # clip URL → decoded buffer (from the sandbox's cache), prefetch per segment
├── rundown.tsx                  # the blended control view: segments → rows → treatment, words, timings, card, badge
├── player.tsx, station.tsx, home.tsx, resume-picker.tsx, dj-picker.tsx  # adapted
└── (removed) use-station.ts, show.tsx, the old reducer

apps/web/src/app/(app)/page.tsx  # + station identity, dj on summaries
apps/web/src/app/(settings)/     # prompt slots list changed; identity editor
apps/web/public/bed.mp3          # hand-copied (was public/program/bed.mp3)
```

**Structure Decision**: producer *logic* in `packages/dj/src/program/` (testable, no env);
producer *orchestration* in `apps/web/src/lib/producer/` (reads env, db, bucket, calls
services); routes are thin. The player is `components/station/` as today, with the sandbox's
machine in place of the old one. `(program)` is left exactly as is.

## Design notes (what the tasks will follow)

1. **Segment-shaped clock rules.** `checkSegmentLog(slots, cards, {first, hourTurned})`: slot 0 is
   the break (forced); `legalId` required when `first || hourTurned`; a `talkup` needs
   `card.introMs ≥ 7000` else → `segue` with a fallback; no spacing rule (structural). `hourTurned`
   = the wall clock crossed an hour boundary between the previous break's air time (estimated
   from kept durations + `startedAt`, or "now" when producing) and this one — computed in the route
   from `Date.now()` and the previous segment's `written_at`, simple and good enough: the ID lands
   on the first break after the turn (spec edge case).
2. **Discover** takes `{request, dj, identity, played: Record[], clock}` and returns 10–14 picks
   resolved via `search`, preferring the shortest hit whose name matches; ≥ 6 resolved or 502.
   Skeleton `breaks` are laid every 4 (3 when the tail would leave < 3). Lower effort than the
   sandbox (`medium`) is the first dial if `open` runs long.
3. **Write** is one call with a tool that returns `[{seq, treatment, legalId?, words, leadLine?}]`
   for the segment's records given their cards, the previous break's words and the rules; it is
   validated by `checkSegmentLog` and its fallbacks kept on `segment.log`.
4. **Voice** is the sandbox's `voice.ts` minus files: `speak` → `timingsOf` → `bucket.put` →
   `assemble`; the break is voiced first; clip names in `Element` are play URLs. `assemble`'s
   ladder is unchanged (post → late → segue; lead → end; break → sweeper → segue; dry bed).
5. **Bucket.** `sigv4.ts` signs `PUT`/`GET` (`UNSIGNED-PAYLOAD` not used — bodies hashed;
   `x-amz-content-sha256`), region from env, virtual-host or path style by a flag (default path
   style off). `bucket()` returns null when any of the five vars is unset → `voice`/`clip` answer
   503 with the variable named.
6. **Player.** Elements carry `segmentId` in a parallel index (`segments: {id, seq, from, to,
   voiced}[]`) so the rundown groups rows and the "produce ahead" effect knows when the cursor
   enters a segment's first song. `SEGMENT_PENDING` paints unvoiced rows (records + words);
   `APPEND_SEGMENT` swaps them for elements once voiced; when the music lane reaches the end of
   voiced elements and a pending segment exists, the effect plays a clean segue into its first
   record and keeps retrying `voice` (R8).
7. **Rundown** rows expose: treatment chip, words (collapsible), timings (`atMs`, `bedInMs`,
   `leadMs`, `clipMs`), the card's `introMs`/`sure`/`post`, and the fallback badge with reason —
   read-only.
8. **Settings.** `PROMPT_SLOTS` in `packages/dj` lists the four slots with their placeholders;
   `/settings` → Prompts renders from it; a small identity form writes `station.identity`.
9. **Removal.** `api/station/next`, `use-station.ts`, `show.tsx`, the old reducer and its test, the
   `messages`/`talk`/`tracks` columns, and the three retired prompt slots. `CLAUDE.md`'s "How it
   works" is rewritten for the segment show; `docs/the-program.html` gets a pointer to it.

## Assumptions carried from the spec

- Replace, not coexist; old station rows are cleared, not migrated (data-model.md).
- The bed is one static asset; sweepers optional.
- Prompt text for the four slots is written by hand on `/settings` (seeded from the sandbox's
  `prompts.ts` as a starting point in the quickstart, not in code).
