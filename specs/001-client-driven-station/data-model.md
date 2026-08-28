# Data Model: Client-Driven Station Loop

Declarative SQL in `packages/db/schema/*.sql`, applied with `pnpm db:plan` / `db:apply`. Prototype rows are
wiped (`pnpm db:clear`), no migration.

## station

One listener's ongoing show and the DJ's memory.

| column | type | notes |
|---|---|---|
| id | uuid pk | generated; client keeps it in localStorage |
| prompt | text not null | current listener prompt (last one used) |
| messages | jsonb not null default '[]' | Claude conversation, trimmed (see research §2); never exposed to the client |
| segment_count | int not null default 0 | total segments produced; for the history cap and display |
| created_at / updated_at | timestamptz | touch trigger (common.sql) |

Rules: `messages` is only ever written by `/api/station/next` under the row lock. Cap: last 20 segment turns.

## segment (replaces the prototype `segments`)

History log, append-only. No status column — a row exists only once the DJ has finished.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| station_id | uuid fk → station on delete cascade | |
| seq | int not null | 1-based position within the station; unique (station_id, seq) |
| prompt | text not null | prompt in force when planned |
| talk | text not null | spoken bridge/intro |
| tracks | jsonb not null | `SegmentTrack[]` (id, uri, name, artists[], album, durationMs), length 3–4 |
| model | text not null | Claude model used |
| created_at | timestamptz | |

Index `(station_id, seq desc)`.

## spotify_account

Unchanged (single row, user token).

## Client-side (not persisted server-side)

**VoiceSettings** (`localStorage` `radio.voice`): `{ voiceId: string, modelId: "eleven_v3", stability: 0–1,
similarityBoost: 0–1, style: 0–1, speed: 0.7–1.2, speakerBoost: boolean }`. Defaults: modelId eleven_v3,
stability 0.5, similarity 0.75, style 0, speed 1, speakerBoost true; voiceId empty until chosen (UI blocks Run).

**StationState** (reducer, in memory):

```
loop:     "stopped" | "running"
phase:    "idle" | "planning" | "talk" | "tracks"
current:  { segment, talkUrl?: string } | null      // what is on air
trackIndex: number                                    // within current.segment.tracks
next:     { segment, talkUrl?: string } | null       // buffered segment, talk audio prefetched
pending:  boolean                                    // a /next request is in flight
error:    string | null
```

Transitions:

| from | event | to |
|---|---|---|
| stopped/idle, no `next` | RUN | running/planning, `pending` (request next) |
| stopped/idle, `next` set | RUN | running/talk with `current := next` |
| running/planning | SEGMENT_READY | if nothing on air → talk with current := segment; else store as `next` |
| running/talk | TALK_ENDED or SKIP_TALK | tracks, trackIndex 0; on entering talk the next request was already sent |
| running/tracks | NEXT (idx < last) / PREV | tracks, idx±1 (PREV at 0 restarts) |
| running/tracks | TRACK_LIST_ENDED or NEXT at last | `next` ? talk with current := next : planning |
| running/* | STOP | stopped, phase idle, audio stopped; `next`, `current`, `pending` kept |
| any | SEGMENT_FAILED | error set; if running and no `next`: retry once, then STOP with error |
| any | TALK_AUDIO_FAILED | that segment's talk is skipped (go straight to tracks); error shown |

Invariants: at most one `next`; a `/next` request is sent exactly once per segment, when its predecessor's talk
starts (or on RUN from empty); `pending` prevents a duplicate request; song play/pause is Spotify device state,
not part of the reducer.
