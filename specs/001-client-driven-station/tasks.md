# Tasks: Client-Driven Station Loop

**Input**: Design documents from `/specs/001-client-driven-station/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Pure-logic unit tests only (CLAUDE.md rule): reducer, prompt builders, history trimming,
`resolveFinish`. Included where the logic is pure; everything else is verified via quickstart.md.

**Organization**: Grouped by user story. US1 (run the loop) is the MVP; US2 (stop/resume) and US3 (transport)
are mostly reducer transitions layered on US1; US4 (voice settings) is independent UI + one route.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4 from spec.md

## Path Conventions

Monorepo: `apps/web/src/…` (Next.js), `packages/{db,spotify,dj}/…` (pure packages). Infra lives in
`../pof4-infra/.railway/railway.ts`.

---

## Phase 1: Setup (remove the worker, add the dj package)

**Purpose**: Tear out the queue architecture and create the homes for the new code.

- [X] T001 Delete `apps/worker/` entirely (src, scripts, package.json, tsconfig) and remove `dev:worker` /
      `enqueue` scripts from root `package.json`; keep `dev` as `op run … pnpm --filter web dev`
- [X] T002 Delete `apps/web/src/lib/queue.ts`, `apps/web/src/app/actions.ts`,
      `apps/web/src/components/{auto-refresh,request-form,player}.tsx`; remove `pg-boss` from
      `apps/web/package.json` and from `serverExternalPackages` in `apps/web/next.config.ts`
- [X] T003 Create `packages/dj/` (package.json `@radio/dj`, `type: module`, exports `./src/index.ts`, deps
      `@anthropic-ai/sdk`, `@radio/db`, `@radio/spotify`; tsconfig mirroring `packages/spotify/tsconfig.json`);
      move `apps/worker/src/dj.ts` + `dj.test.ts` to `packages/dj/src/`; add `@radio/dj` to
      `apps/web/package.json` deps and `transpilePackages` in `next.config.ts`
- [X] T004 [P] Extend `apps/web/src/lib/env.ts` with `CLAUDE_KEY` (min 1), `CLAUDE_MODEL` (default
      `claude-opus-5`), `ELEVENLABS_KEY` (min 1); add `apps/web/src/lib/claude.ts` exporting a lazily-created
      `Anthropic({ apiKey: env().CLAUDE_KEY, maxRetries: 0 })`
- [X] T005 [P] Update `.env.op`: uncomment/add `ELEVENLABS_KEY=op://Developer/<item>/credential` (item name
      confirmed by the user), fix the CLAUDE comment ("web", not "worker")
- [X] T006 [P] Infra: in `../pof4-infra/.railway/railway.ts` `radio(db)` remove the `clips` bucket and
      `radio-worker`; on `radio-web` add `CLAUDE_KEY: preserve()`, `CLAUDE_MODEL: "claude-opus-5"`,
      `ELEVENLABS_KEY: preserve()`; drop `ELEVENLABS_VOICE_ID`; update the README service list; run
      `pnpm typecheck && pnpm plan` there (apply is the user's)
- [X] T007 Run `pnpm install` at the root; `pnpm typecheck` must pass with the worker gone (fix imports)

---

## Phase 2: Foundational (schema, db queries, DJ core)

**Purpose**: Persistence and the DJ conversation engine every story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Replace `packages/db/schema/segments.sql` with `packages/db/schema/station.sql` (table `station`
      per data-model.md, touch trigger) and `packages/db/schema/segment.sql` (table `segment`, fk, unique
      `(station_id, seq)`, index `(station_id, seq desc)`)
- [X] T009 Rewrite `packages/db/src/db.ts`: types `Station`, `Segment`, `SegmentTrack`; queries
      `createStation(prompt)`, `getStation(id)`, `listSegments(stationId, limit=20)`,
      `withStationLock(id, fn)` (`select … for update skip locked` in a transaction; returns `null` when
      locked), `commitSegment(stationId, { prompt, messages, talk, tracks, model })` (insert segment with
      `seq = segment_count + 1`, update station prompt/messages/segment_count in one transaction);
      drop all old segment status functions; keep `SpotifyAccount` functions
- [X] T010 Update `packages/db/scripts/clear.ts` to `delete from segment; delete from station` (no pgboss)
      and `pnpm db:plan` → `pnpm db:apply` (prototype rows are wiped first with `pnpm db:clear`)
- [X] T011 [P] `packages/dj/src/prompt.ts`: `SYSTEM` (rewrite: one talk per segment, first talk = intro,
      later talks = bridge closing the previous block and opening this one, "listener may have skipped —
      write so it reads either way", spoken style, optional sparse v3 audio tags like `[sighs]`, call
      `finish_segment` once), `TOOLS` (`search_spotify`, `finish_segment {talk, track_ids}` strict, no
      bounds keywords), `buildUserTurn({ prompt, previous: {talk, tracks} | null, promptChanged })` per
      research.md §3
- [X] T012 [P] `packages/dj/src/history.ts`: `trimTurn(turnMessages)` → `[user, assistant(finish tool_use
      only), user(tool_result "Segment accepted.")]`; `capHistory(messages, maxSegments=20)` keeps whole
      turns (multiples of 3 from the end); `withCache(messages)` sets `cache_control {ephemeral, ttl:"1h"}`
      on the last block of the last message only (strip any earlier cache markers)
- [X] T013 `packages/dj/src/dj.ts`: `planSegment({ history, userTurn }, deps)` — manual loop as today
      (cap 12 turns, refusal/max_tokens errors, `resolveFinish` 3–4 unique seen ids, non-empty talk),
      system block with `cache_control {ephemeral, ttl:"1h"}`, request messages = `withCache([...history,
      ...turn])`; returns `{ talk, tracks, turn: MessageParam[], usage }`; `packages/dj/src/index.ts` exports
- [X] T014 [P] Tests: `packages/dj/src/history.test.ts` (trim keeps only finish call; cap drops oldest whole
      turns; cache marker only on last block), `packages/dj/src/prompt.test.ts` (cold vs warm turn text,
      prompt-changed line), update `packages/dj/src/dj.test.ts` for the `{talk, track_ids}` shape
- [X] T015 `apps/web/src/app/api/station/next/route.ts` per contracts/api.md: zod body, create station if
      `stationId` null, `withStationLock` → 409 busy, `buildUserTurn` (previous = last segment row,
      promptChanged = prompt !== station.prompt), `planSegment`, `trimTurn` + `capHistory`, `commitSegment`,
      log `usage.cache_read_input_tokens`; 502 on DJ errors with message
- [X] T016 [P] `apps/web/src/app/api/station/[id]/route.ts` (GET → station + last 20 segments) and
      `apps/web/src/lib/db.ts` re-export updates
- [X] T017 Run `pnpm check`; smoke `POST /api/station/next` twice with curl through the dev server (needs Guard
      cookie — use the browser console `fetch`) and confirm `station.messages` length 3 then 6 and
      `cache_read_input_tokens > 0` on the second call

**Checkpoint**: DJ conversation works server-side; segments persist; history trimmed and cached.

---

## Phase 3: User Story 1 — Run the station (Priority: P1) 🎯 MVP

**Goal**: Prompt + Run → planning → spoken intro (streamed TTS) → 3–4 songs → bridge talk → … forever, one
segment ahead.

**Independent Test**: quickstart.md scenarios 1–2.

- [X] T018 [P] [US1] `apps/web/src/app/api/tts/route.ts`: GET per contracts/api.md; validate query with zod;
      `fetch` ElevenLabs `POST /v1/text-to-speech/{voiceId}/stream?output_format=mp3_44100_128` with
      `{ text, model_id, voice_settings }` and `xi-api-key`; return `new Response(upstream.body, { headers:
      { "Content-Type": "audio/mpeg" } })`; 502 with upstream message on non-2xx
- [X] T019 [P] [US1] `apps/web/src/components/station/voice-store.ts`: `VoiceSettings` type, defaults
      (data-model.md), `loadVoice()` / `saveVoice()` with try/catch around localStorage, `ttsUrl(text, v)`
      builder; `loadStationId()` / `saveStationId()` (`radio.stationId`)
- [X] T020 [P] [US1] `apps/web/src/components/station/reducer.ts` + `reducer.test.ts`: `StationState`,
      events `RUN, STOP, SEGMENT_REQUESTED, SEGMENT_READY, SEGMENT_FAILED, TALK_READY, TALK_AUDIO_FAILED,
      TALK_ENDED, SKIP_TALK, TRACK_LIST_ENDED, NEXT, PREV, SPOTIFY_STATE` and the transition table from
      data-model.md; tests for: RUN from empty → planning+pending; SEGMENT_READY while idle → talk;
      SEGMENT_READY while on air → stored as next; TALK_ENDED → tracks idx 0; TRACK_LIST_ENDED with next →
      talk (next cleared); without next → planning; at most one pending request
- [X] T021 [P] [US1] `apps/web/src/components/station/use-spotify-device.ts`: load SDK, connect device
      "Radio", expose `{ deviceId, status, play(uris, offset), pause(), resume(), setVolume(v) }` and an
      `onTrackListEnded(lastUri)` callback using the existing end-of-list heuristic (from old player.tsx)
- [X] T022 [US1] `apps/web/src/components/station/use-station.ts`: effects on state — when `pending` flips
      true → `POST /api/station/next` (120 s abort) → dispatch SEGMENT_READY/FAILED; on SEGMENT_READY →
      fetch `ttsUrl(segment.talk)` → Blob → `URL.createObjectURL` → TALK_READY (revoke on unmount / when
      segment leaves); on phase `talk` → duck Spotify to 0.15, play `<audio>` (hidden element ref), on
      `ended` → TALK_ENDED, restore volume; on entering `talk` dispatch SEGMENT_REQUESTED when no `next` and
      not pending; on phase `tracks` with changed trackIndex → `play(uris, trackIndex)`; on
      `onTrackListEnded` → TRACK_LIST_ENDED; retry-once on SEGMENT_FAILED then STOP with error
- [X] T023 [US1] `apps/web/src/components/station/station.tsx`: prompt input, **Run** / **Stop** buttons,
      state line (planning… / DJ talking / Playing 2 of 4), current segment card (talk text, track list with
      the active one highlighted), error banner, history list (from `GET /api/station/:id` on mount, appended
      on each SEGMENT_READY), disabled states when no Spotify device / no voice chosen
- [X] T024 [US1] Rewrite `apps/web/src/app/page.tsx`: server component keeps the Spotify account section,
      renders `<Station enabled={premium} />`; remove `AutoRefresh`, `RequestForm`, `Player` usage and the
      old `listSegments` call
- [ ] T025 [US1] Live check quickstart scenarios 1–2 on `pnpm dev`; fix ducking/volume restore and the
      end-of-list detection if the Spotify state events differ from the heuristic

**Checkpoint**: The station runs hands-off across multiple segments with a streamed voice.

---

## Phase 4: User Story 2 — Stop and resume (Priority: P2)

**Goal**: Absolute Stop; Run resumes with the buffered segment and the DJ's memory intact; reload-safe.

**Independent Test**: quickstart.md scenario 3.

- [X] T026 [US2] Reducer (`reducer.ts` + tests): `STOP` → `loop: stopped, phase: idle`, keep `current`,
      `next`, `pending`; `RUN` with `next` → talk immediately; `RUN` while `pending` → planning (no second
      request); a `SEGMENT_READY` arriving while stopped is stored as `next` and does not start playback
- [X] T027 [US2] `use-station.ts`: on STOP pause the `<audio>` element and Spotify, abort nothing (an in-flight
      `/next` is allowed to finish and land as `next`); on RUN resume from the state the reducer picks
- [X] T028 [US2] Rehydrate on load in `station.tsx`: read `radio.stationId`, `GET /api/station/:id` → history
      + last prompt prefilled; a stale/404 id clears localStorage; the reducer starts `stopped/idle` with no
      buffered segment (audio is not persisted)
- [ ] T029 [US2] Live check scenario 3 (Stop < 1 s, resume < 1 s with buffered segment, reload keeps memory —
      verify via `pnpm db:sql "select segment_count, jsonb_array_length(messages) from station"`)

**Checkpoint**: Stop/Run are absolute and memory-preserving.

---

## Phase 5: User Story 3 — Transport controls (Priority: P3)

**Goal**: Pause/play the song, skip the talk, prev/next within the block, next past the last song.

**Independent Test**: quickstart.md scenario 4.

- [X] T030 [US3] Reducer + tests: `SKIP_TALK` (talk → tracks idx 0), `NEXT`/`PREV` bounds (PREV at 0
      restarts = same idx, effect re-plays), `NEXT` at last → same as TRACK_LIST_ENDED; ignore transport
      events when stopped
- [X] T031 [US3] `use-station.ts` + `use-spotify-device.ts`: SKIP_TALK stops the `<audio>` (and restores
      volume); NEXT/PREV call `play(uris, idx)` (`PUT /me/player/play` with `offset: { position }`);
      pause/resume buttons call the device directly (not the reducer); guard the end-of-list heuristic so a
      user-initiated `play()` call doesn't fire TRACK_LIST_ENDED spuriously
- [X] T032 [US3] `station.tsx`: transport row — ⏮ ⏯ ⏭ plus "skip talk" during the talk phase; show
      "planning…" when NEXT outruns the DJ
- [ ] T033 [US3] Live check scenario 4 including heavy skipping → next talk still reads naturally

**Checkpoint**: Full transport without ever breaking the loop.

---

## Phase 6: User Story 4 — Choose the DJ's voice (Priority: P4)

**Goal**: Voice + model + settings chosen in the page, remembered per browser, used by the next talk.

**Independent Test**: quickstart.md scenario 5.

- [X] T034 [P] [US4] `apps/web/src/app/api/tts/voices/route.ts`: GET → ElevenLabs `GET /v1/voices` → `[{
      voiceId, name, category }]`
- [X] T035 [P] [US4] `apps/web/src/components/station/voice-settings.tsx`: panel (toggle in `station.tsx`)
      with voice select (from `/api/tts/voices`), model (`eleven_v3` default; `eleven_multilingual_v2`,
      `eleven_flash_v2_5` as fallbacks), sliders stability / similarity / style / speed, speaker boost
      checkbox, "preview" button that plays a short line via `/api/tts`; saves through `voice-store.ts`
- [X] T036 [US4] Wire: `use-station.ts` reads the current settings at fetch time (not at mount) so a change
      applies to the next talk; Run disabled with hint until a voice is chosen
- [ ] T037 [US4] Live check scenario 5 (+ scenario 6 bogus voice → talk skipped, songs play)

**Checkpoint**: All four stories work.

---

## Phase 7: Polish & Cross-Cutting

- [X] T038 Two-tab guard UX: 409 `busy` → banner "another tab is running this station" and auto-STOP
      (`use-station.ts`, `station.tsx`); live check scenario 7
- [X] T039 [P] Update `CLAUDE.md` ("How it works" → client-driven loop, no worker; `/api/station/next`,
      `/api/tts`; voice settings client-side) and `README.md` (secrets recipe: `radio-web` gets `CLAUDE_KEY`
      + `ELEVENLABS_KEY`, no worker service)
- [X] T040 [P] Update `.github/workflows/ci.yml` if it references the worker package
- [ ] T041 `pnpm format && pnpm check && pnpm --filter web build`; commit and push; user runs `railway config
      apply` in `pof4-infra` and pushes `ELEVENLABS_KEY` with `railway variables -s radio-web --set
      "ELEVENLABS_KEY=$(op read op://Developer/<item>/credential)"`; verify prod via quickstart scenarios 1–3
- [X] T042 [P] Update memory note `radio-prototype-status.md` (architecture is now client-driven; what's
      verified in prod)

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → Phase 3 (US1)** strictly sequential; T006 (infra) can happen any time before T041.
- **US2, US3** build on the US1 reducer/effects (same files) — do sequentially after US1, in that order.
- **US4** touches only `tts/voices/route.ts`, `voice-settings.tsx` and one wiring point; it can run in parallel
  with US2/US3 once US1's `voice-store.ts` (T019) exists.
- **Polish** after all stories.

### Parallel opportunities

- Phase 1: T004, T005, T006 together after T001–T003.
- Phase 2: T011, T012, T014, T016 in parallel; T013 after T011/T012; T015 after T009/T013.
- US1: T018, T019, T020, T021 in parallel; T022 after all four; T023 after T022; T024 after T023.
- US4: T034, T035 in parallel.

## Parallel Example: User Story 1

```text
Task: "GET /api/tts stream proxy in apps/web/src/app/api/tts/route.ts"
Task: "voice-store.ts localStorage helpers"
Task: "reducer.ts + reducer.test.ts state machine"
Task: "use-spotify-device.ts SDK hook"
```

## Implementation Strategy

1. Phases 1–2: delete the worker, land schema + `packages/dj` + `/api/station/next`; verify with T017
   (conversation persists, second call hits the cache).
2. US1 = MVP: the loop with streamed voice. Ship it (T041 partial) and listen to a few segments.
3. US2 then US3 as reducer increments with live checks; US4 alongside.
4. Polish, docs, prod apply.
