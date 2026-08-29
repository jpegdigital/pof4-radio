# The show as a timeline — design

**Date:** 2026-08-29 · **Scope:** `apps/web/src/components/station/*` only. No server or schema changes.

## Goal

A segment is a *metatrack*: its talk, then its 3–4 tracks. The show is the ordered list of
metatracks. One cursor walks it; one transport (prev · play/pause · next) moves the cursor; any
segment in the list can be tapped to rewind to its talk. The player mounts when the first
segment lands and never unmounts. "Skip talk" disappears — the talk is a track, and *next* skips it.

Segment **text** (from the DJ or a resumed station) and talk **audio** (ElevenLabs) are separate
pipelines: audio is fetched by *position* (the segment under the cursor and the one after it),
never by arrival. A cold-start resume can therefore tap any past segment and hear it.

## State (`reducer.ts`)

```ts
interface Cursor { seg: number; item: number }   // item 0 = the talk, 1..n = tracks[item-1]

interface StationState {
  loop: "stopped" | "running";
  phase: "idle" | "planning" | "playing";       // planning = cursor is past the tail, DJ asked
  segments: SegmentView[];                      // the whole show, oldest first, capped at 20
  cursor: Cursor | null;                        // null until something is in the list
  pending: boolean; requestSeq: number; retried: boolean;
  playSeq: number;                              // bumps whenever the item under the cursor must (re)start
  error: string | null;
}
```

Gone: `current`, `next`, `trackIndex`, `resume`, `Loaded.talkUrl/talkFailed`. The buffered
segment is simply `segments[cursor.seg + 1]`. Talk audio state lives in the hook (below), not
in the reducer — the reducer decides *what* plays; whether its audio is ready is an effect concern,
except for one event: `TALK_FAILED` (audio could not be fetched or played) advances the cursor to
item 1 when it is on that talk, so a broken voice never stalls the show.

Derived, exported as helpers (tested): `atTail(s)`, `isTalk(cursor)`, `itemCount(seg)`.

### Events

| Event | Effect |
|---|---|
| `LOAD_SHOW { segments }` | Resumed station: replace the list, cursor → `null`, phase `idle`. Only while stopped. |
| `CLEAR_SHOW` | "Start fresh": empty list, cursor null. Only while stopped. |
| `RUN` | `loop: running`. Cursor null → planning + request. Cursor set → `playing`, `playSeq++` (resume in place, mid-item). |
| `STOP` | `loop: stopped`; cursor stays. Phase `planning` stays planning-in-name only: a landing segment is appended, not started. |
| `HALT { error }` | Like STOP with an error. |
| `SEGMENT_READY { segment }` | Append (trim head to 20, shifting the cursor). If running and `planning` → cursor to its talk, `playing`, `playSeq++`. |
| `SEGMENT_FAILED { error }` | As today: one retry, then halt. |
| `TALK_FAILED { segmentId }` | If cursor is on that talk → item 1, `playSeq++`. |
| `ENDED` | The item under the cursor finished (audio `ended` or Spotify's end-of-list). → `NEXT`. |
| `TRACK_CHANGED { uri }` | Spotify moved within the block on its own → cursor item follows, no `playSeq`. |
| `NEXT` | Next item; past the last item of a segment → next segment's talk; past the tail → `planning` + request. |
| `PREV` | Previous item; on item 0 → previous segment's last track; on the first talk → no-op. (The "restart if >3 s in" rule lives in the hook, which only dispatches PREV when not restarting.) |
| `JUMP { seg, item }` | Cursor there, `playSeq++`. If stopped, also `RUN` (tapping a segment starts the show). |
| `CLEAR_ERROR` | |

Planning is requested in exactly one place: whenever the cursor moves onto a **talk** and that
segment is the **tail** (`requestNext` if not `pending`). Rewinding never plans.

## Effects (`use-station.ts`)

Talk audio: `talk: Map<segmentId, { url } | { failed: string }>` in a ref, mirrored to a small
`useState` version counter so the page can render "loading voice…". A segment's entry is dropped
when it's trimmed from the list, and every *unplayed* entry is dropped when the DJ (voice) changes.

1. **Plan** — unchanged (keyed on `pending/requestSeq`).
2. **Voice** — for `segments[cursor.seg]` and `segments[cursor.seg + 1]` (or the whole list's first
   two when the cursor is null and the loop is running), fetch TTS if no entry and not in flight.
3. **Talk on air** — when the cursor is on a talk and its entry is a url: duck, `audio.src = url`,
   play; `ended` → `ENDED`; error → `TALK_FAILED`. Cleanup pauses and un-ducks but **does not
   revoke**. Entry `failed` → dispatch `TALK_FAILED`.
4. **Tracks on air** — on `playSeq` while the cursor is on a track: `device.play(uris, item - 1)`.
5. **Stop** — pause both. On `RUN` with the cursor mid-item, `playSeq++` restarts the item
   (talk from the start; a track via `device.play` at index). Good enough; true mid-track resume
   via `device.resume()` is a follow-up.
6. **Toggle** — exposed as `toggle()`: talk item → `audio.pause()/play()`; track → `device.pause()/resume()`.
   Paused state for the UI: talk → `audio.paused`; track → `device.playback.paused`.
7. **Position** — for a talk, `audio.currentTime/duration` sampled every 500 ms while playing,
   exposed alongside Spotify's `Playback` as one `{ position, duration, paused }`.

`unlock()` unchanged.

## Page (`station.tsx`, `player.tsx` replacing `now-playing.tsx`)

- The on-air card and the request card stay. `history` useState, "Now playing", "Next up",
  "Earlier tonight" cards go; `ResumePicker` dispatches `LOAD_SHOW`, "Start fresh" dispatches
  `CLEAR_SHOW`.
- **Player** (mounted once `segments.length > 0 || phase === "planning"`): art slot, title,
  subtitle, progress, three buttons. Track: album art, name, artists, Spotify progress. Talk: the
  DJ mark in the art slot, "{dj} · block {seq}", the talk's first sentence, audio progress
  ("loading voice…" with an indeterminate bar until ready). Planning: the lamp pulses in the art
  slot, "The DJ is planning…", play button disabled. Stopped: whatever's under the cursor, paused.
- **The show**: every segment as a metatrack — a talk row (the DJ mark, the talk text, clamped)
  then track rows; the row under the cursor lit; tapping a talk row → `JUMP {seg, 0}`; tapping a
  track row → `JUMP {seg, i+1}`; the tail with no audio yet shows a quiet "up next". Visual design
  is a separate pass (frontend-design skill) after the model lands.
- "Skip talk" is removed.

## Testing

`reducer.test.ts` rewritten: next/prev across a boundary; prev on the first talk is a no-op;
jump back then play to the tail issues exactly one request; `SEGMENT_READY` while planning starts
it, while playing appends; stop then run resumes at the same cursor; trim shifts the cursor;
`LOAD_SHOW` then `JUMP` starts the loop; `TALK_FAILED` under the cursor advances to item 1;
`TRACK_CHANGED` follows without a `playSeq` bump. Live check on `dev.radio.pof4.com`: cold-start
resume → tap block 3 → talk plays, block 4 voiced, block 5 planned only after 4's talk starts.

## Out of scope

Mid-track resume after Stop, provenance of prompts, keyboard shortcuts, server changes.
