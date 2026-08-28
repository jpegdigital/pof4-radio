# Implementation Plan: Client-Driven Station Loop

**Branch**: `001-client-driven-station` | **Date**: 2026-08-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-client-driven-station/spec.md`

## Summary

Collapse the worker/queue architecture into a browser-driven loop: the player is the state machine
(stopped/running × idle/planning/talk/tracks), the server is two stateless functions — `POST /api/station/next`
continues one persisted Claude conversation per station (1h prompt cache, trimmed tool chatter, ≤20 segments)
and `GET /api/tts` streams ElevenLabs `eleven_v3` audio with client-chosen voice settings. A segment is
`{talk, tracks[3–4]}`; every talk after the first is a bridge from the previous segment. The `radio-worker`
service, pg-boss, the `clips` bucket and `ELEVENLABS_VOICE_ID` are removed.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24 (fnm `.node-version`), pnpm workspaces
**Primary Dependencies**: Next.js 16 (App Router, route handlers), React 19, Tailwind 4, `@anthropic-ai/sdk`
0.120, `pg` 8, zod 4; Spotify Web Playback SDK (browser); ElevenLabs REST (no SDK)
**Storage**: Railway Postgres (`radio` db), declarative schema via pg-delta; `localStorage` for station id and voice settings
**Testing**: Vitest for pure logic (reducer, prompt builders, history trimming, `resolveFinish`); everything
touching Postgres/Spotify/Claude/ElevenLabs verified live (quickstart.md)
**Target Platform**: Railway (`radio-web` only), Chrome desktop tab as the playback device
**Project Type**: web app (Next.js) + shared packages
**Performance Goals**: first talk < 60 s cold; inter-segment gap < 1 s (talk audio prefetched); Stop < 1 s
**Constraints**: private behind Guard; secrets only via `preserve()` + `railway variables`; packages never read
`process.env`; no background processes; per-segment cost flat (cache hits from segment 2 on)
**Scale/Scope**: one listener, one station per browser; ~5 source files removed, ~10 added/rewritten

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template — no gates defined. Applying `CLAUDE.md` as the
de-facto constitution:

- Minimize cost / simplicity: **pass** — removes a service, a queue library, a bucket; adds two route handlers.
- `packages/*` pure, `apps/*` own env: **pass** — `packages/dj` (prompt, tools, loop, trimming) takes a client +
  search fn; `apps/web` wires env.
- Plain `pg` + SQL, declarative schema: **pass**.
- Guard gate unchanged, only `api/health` exempt: **pass** — `/api/tts` and `/api/station/*` sit behind Guard.
- Tests pure-logic only: **pass**.

Post-design re-check: no violations; Complexity Tracking not needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-client-driven-station/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── db/
│   ├── schema/{common,spotify_account,station,segment}.sql   # segments.sql → segment.sql (rewritten)
│   ├── scripts/{schema,sql,clear}.ts
│   └── src/db.ts            # station/segment queries, row lock for planning
├── spotify/                 # unchanged
└── dj/                      # NEW, moved from apps/worker/src/dj.ts
    └── src/{dj.ts, prompt.ts, history.ts, *.test.ts}
        # planSegment(input, deps) → { talk, tracks, turn: MessageParam[] }
        # buildUserTurn(prev | null, prompt, promptChanged)
        # trimTurn(messages) / capHistory(messages, 20)

apps/web/src/
├── app/
│   ├── page.tsx                         # station UI (server: account + history; client: <Station/>)
│   └── api/
│       ├── station/next/route.ts        # POST — DJ
│       ├── station/[id]/route.ts        # GET — rehydrate/history
│       ├── tts/route.ts                 # GET — ElevenLabs stream proxy
│       ├── tts/voices/route.ts          # GET — voice list
│       └── spotify/…, health/           # unchanged
├── components/station/
│   ├── station.tsx                      # Run/Stop, transport, now-playing, history, settings toggle
│   ├── reducer.ts (+ reducer.test.ts)   # pure state machine (data-model.md)
│   ├── use-station.ts                   # effects: next-fetch, talk prefetch (Blob), Spotify play, ducking
│   ├── use-spotify-device.ts            # SDK load/connect, player_state_changed → events
│   ├── voice-settings.tsx               # settings panel, localStorage
│   └── voice-store.ts                   # VoiceSettings defaults/parse
└── lib/{env.ts (+CLAUDE_KEY, CLAUDE_MODEL, ELEVENLABS_KEY), db.ts, spotify.ts, guard.ts, claude.ts}

REMOVED: apps/worker/**, apps/web/src/lib/queue.ts, apps/web/src/app/actions.ts,
         components/{auto-refresh,request-form,player}.tsx, pg-boss dependency, `pnpm enqueue`/`dev:worker`.
INFRA (../pof4-infra/.railway/railway.ts): drop radio-worker + clips; radio-web gains CLAUDE_KEY (preserve),
         CLAUDE_MODEL, ELEVENLABS_KEY (preserve).
```

**Structure Decision**: keep the two-package split (`db`, `spotify`) and add `packages/dj` so the Claude logic
stays pure and unit-testable while `apps/web` owns env, HTTP and the browser. Single Next app, no worker.

## Design notes (from research.md)

- Claude: manual tool loop, `claude-opus-5`, `cache_control {ephemeral, ttl: "1h"}` on system + last message;
  turn trimmed to the accepted `finish_segment` before persisting; cap 20 segments.
- Continuation: user turn carries the whole previous segment and the "may have been skipped — write so it reads
  either way" instruction; a prompt change is announced in the same turn.
- Concurrency: `select … for update skip locked` on the station row for the duration of planning → 409 `busy`.
- TTS: `eleven_v3`, HTTP stream, mp3 44.1k/128; voice settings from the client per request; Blob URL held
  beside the segment; Spotify volume ducked to 0.15 during talk.
- Spotify transport: prev/next via `PUT /me/player/play {uris, offset}` scoped to the segment; end-of-list via
  the existing `player_state_changed` heuristic.
