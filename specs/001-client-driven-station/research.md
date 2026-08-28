# Research: Client-Driven Station Loop

## 1. Voice model and transport

**Decision**: `eleven_v3` over `POST /v1/text-to-speech/{voice_id}/stream` (HTTP, chunked mp3), proxied by a Next
route handler. Default `output_format=mp3_44100_128`, stability "Natural" (0.5), `use_speaker_boost: true`.

**Rationale**: Talk text is complete when the segment lands, so there is nothing to stream *in*; the only latency
that matters is time-to-first-byte on a fully known script, which the HTTP stream endpoint provides. v3 is the
expressive model and reads bracketed audio tags (`[laughs]`, `[sighs]`, `[whispers]`…), which the DJ prompt can
use sparingly. 5,000-char limit is far above a talk (~400–900 chars). Docs (elevenlabs.io/docs/models, checked
2026-08-28): "Eleven v3 can also be used with the Text to Speech API".

**Alternatives considered**:
- `eleven_v3_conversational` + Text-to-Dialogue websocket: ~280 ms latency, built for live dialogue where text
  arrives incrementally. Adds a socket lifecycle and a second protocol for zero gain here; talk N+1 is fetched
  during segment N so first-byte latency is invisible except on cold start.
- `eleven_flash_v2_5`: 75 ms latency, less expressive, no audio tags. Wrong trade for a DJ voice.
- Store mp3 in the `clips` bucket: only useful for replay/sharing, which is out of scope. The in-memory Blob per
  segment *is* the cache for the session. Bucket and `ELEVENLABS_VOICE_ID` removed from IaC.

## 2. Claude conversation, caching, trimming

**Decision**: One `messages[]` per station, persisted in Postgres (`station.messages jsonb`). Each
`POST /api/station/next` appends a user turn, runs the manual tool loop (`search_spotify` / `finish_segment`),
then persists the trimmed history. `cache_control: {type: "ephemeral", ttl: "1h"}` on the system block and on
the last message of the request; tools + system are frozen strings so the prefix is stable.

**Rationale**: Segments are ~12–18 minutes apart; the default 5-minute cache would miss every time. 1h TTL
(SDK: `cache_control: { type: "ephemeral", ttl: "1h" }`) makes each request pay only for the new turn. Frozen
prefix + append-only history is the textbook cache shape.

**Trimming** (done before persisting, after a segment is accepted): the completed turn is rewritten as
`user: <request>` → `assistant: [finish_segment tool_use]` → `user: [tool_result "Segment accepted."]`; all
intermediate search `tool_use`/`tool_result` blocks and any text blocks are dropped. Net ≈ 300 tokens per
segment. History cap: keep the last 20 segment turns (60 messages) + a one-line "earlier: N segments played"
note is unnecessary — the system prompt already says the show is ongoing. The cap causes one cache miss on the
turn that first drops a segment; acceptable.

**Model**: `claude-opus-5` (env `CLAUDE_MODEL`, default). `max_tokens: 4096`, `maxRetries: 0`, manual loop cap
12 turns, thinking off (search-and-pick is not reasoning-heavy; latency matters more).

**Alternatives**: fresh prompt per segment with a "recently played" list (current code) — loses the DJ's own
voice/continuity and re-sends the system prompt cold; tool runner beta helper — not needed, manual loop exists.

## 3. Continuation prompt shape

**Decision**: Per-segment user turn:

- cold start: `Listener's request: <prompt>\n\nThis is the first segment of the show. Open the show and program
  the first block.`
- warm: `Listener's request: <prompt>\n\nThe previous segment (your talk and its tracks):\n<talk>\n1. A — B\n…\n
  \nProgram the next segment. Your talk is the bridge: close the previous block and open this one. The listener
  may have skipped some of it — write so it reads naturally either way.`
- prompt changed since last segment: append `The listener changed the mood to: <new prompt>. Acknowledge the
  shift on air and follow it.`

Because the previous segment is already in the conversation (the accepted `finish_segment` call), repeating
talk + tracks in the user turn is redundant for the model but cheap (~150 tokens) and makes the instruction
unambiguous; keep it.

**Rejected**: sending played/skipped state — the request for N+1 fires when N's talk starts, before any skip
happens; the state doesn't exist yet. The user explicitly chose "Claude writes a continuation that works either way".

## 4. Station identity and concurrency

**Decision**: `station` row keyed by uuid, id kept in `localStorage` (`radio.stationId`); created lazily by the
first `next` call without an id. Second tab: `next` acquires a Postgres advisory lock / `for update skip locked`
on the station row for the duration of planning; a concurrent call gets 409 `busy` and the UI shows "another
tab is running this station". Cheap, no lease bookkeeping.

**Rejected**: station id in a cookie (Guard already owns cookies; keep it out of the auth path); server-side
"active tab" leases (more state for a single-listener product).

## 5. Client state machine

**Decision**: a single reducer in `apps/web/src/components/station/` with state
`{ loop: "stopped" | "running", phase: "idle" | "planning" | "talk" | "tracks", segment, trackIndex, next, error }`.
Effects (fetch next, fetch talk audio, Spotify play, ducking) live in one `useStationEffects` hook keyed on the
state; audio for `next.talk` is a Blob URL stored beside the segment. Reducer is pure and unit-tested; effects are
verified live. `AutoRefresh`, `RequestForm`'s server action, `queue.ts`, `actions.ts` removed.

**Rejected**: XState (dependency for one machine); keeping server-side status polling (the status is now client
state; the server only logs).

## 6. Spotify "end of list" detection

Keep the existing `player_state_changed` heuristic (paused && position 0 && no next_tracks && current uri ===
last uri) but scope it to the current segment's track list; prev/next inside the block use
`PUT /me/player/play` with `uris` + `offset: {position}` rather than the SDK's next/previous (deterministic,
keeps the list bounded to the segment). Ducking: `player.setVolume(0.15)` during talk, restore to the user's
volume after.

## 7. Infra changes (`../pof4-infra/.railway/railway.ts`)

Remove `radio-worker` service and `clips` bucket from `radio(db)`; move `CLAUDE_KEY` (preserve) + `CLAUDE_MODEL`
onto `radio-web`; add `ELEVENLABS_KEY` (preserve) on `radio-web`. Drop `ELEVENLABS_VOICE_ID`. `railway config
plan` then apply — run by the user. Secrets pushed with `railway variables -s radio-web --set "K=$(op read …)"`.
`.env.op` gains `ELEVENLABS_KEY=op://Developer/<item>/credential` (item name to be confirmed by the user).
