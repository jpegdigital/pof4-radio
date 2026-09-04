# Contract: the sessions API (slot-first)

**Feature**: `004-slot-first` | **Date**: 2026-09-04 | **Becomes**: `docs/sessions.html` when built

All routes are JSON unless they stream bytes. All are behind Guard (`proxy.ts`); none is exempt.
Every producing route is idempotent: asking again for something already made returns it. The
session row is the production lock for the fill and the slot rungs (`for update nowait`; a second
producer gets `409 { error: "session is already producing" }`). The track pull is lock-free.

## Documents

```ts
interface Tags {                      // what Qobuz says; given, never judged
  id: string; title: string; artists: string[]; album: string; image: string | null; durationMs: number;
}

interface Clock { breakEvery: number; fill: number; lowWater: number }

type SlotStatus = "proposed" | "written" | "voiced";

interface SlotDoc {
  seq: number;
  status: SlotStatus;
  // the proposal — always present
  title: string; artist: string; why: string;
  // written and after — absent while proposed
  pick?: Tags;                        // the picked hit's tags, from hits, never from `track`
  held?: boolean;                     // the bucket holds the pick's bytes (a `track` row exists)
  chart?: { rampMs: number; sure: boolean; post: string; outro: "cold" | "fade"; outroMs: number;
            energy: number; tempo: "down" | "mid" | "up"; mood: string };   // absent on a no-chart segue
  kind?: "break" | "talkup" | "sweeper" | "segue";
  words?: string; leadLine?: string; legalId?: string; treatment?: string;
  fallback?: { from: string; to: string; reason: string };
  recordUnderMs?: number; voiceInMs?: number;
  // voiced
  voiced: boolean;
  clipKey?: string;                   // absent on a segue
}

interface SessionDoc {
  sessionId: string; prompt: string; voiceId: string; createdAt: string;
  clock: Clock;
  slots: SlotDoc[];                   // in seq order, no gaps
}
```

Never on the wire: `hits` (once picked; before the pick they are not needed by the browser either),
`thinking`, `clock_ms`, audio.

## `POST /api/sessions` — create

Unchanged. Body `{ prompt, voiceId }` → `200 { sessionId }`. Instant: one row, no slot, no model
call. `400` on a bad body, `502` on a database failure.

## `GET /api/sessions/:id` — the snapshot

`200 SessionDoc`, `Cache-Control: no-store`. `404` unknown session. Reads `settings.clock`
(`500` if missing, naming the key). Never produces anything.

## `POST /api/sessions/:id/fill` — the fill rung

Body: none (an empty body or `{}`). Under the lock.

1. Reads every slot's title and artist: written ones as *played*, unwritten as *pending*.
2. One Claude call (the proposer): the ask, the identity, played, pending → `fill + 2` proposals
   in play order (`numbered("song", n, Proposal)`), never repeating a played or pending title.
3. Drops any proposal whose title+artist matches one already in the show (case-insensitive).
4. Qobuz search per proposal in parallel (`searchQuery`, limit 3, streamable only).
5. Appends one `session_slot` per proposal with ≥ 1 hit, in the proposer's order, `seq` continuing
   from the last, until `fill` slots are added. One transaction.

Response `200 { added: SlotDoc[], dropped: string[] }` — the new rows and one line per proposal
that did not become a slot (no hit, search failed, duplicate). `502 { error, dropped }` when
nothing was added. `409` when another producer holds the session. `404` unknown session.

## `POST /api/sessions/:id/slots/:seq` — the slot rung

Body `{ clockMs: number, again?: boolean }` — `clockMs` is ms since the browser's local midnight
(`0 … 86_400_000`), required. Under the lock.

Precedence:

- Slot `seq` does not exist → `404 { error: "slot :seq is not proposed yet — fill first" }`.
- Slot is voiced and `again` is not set → `200 SlotDoc` unchanged.
- Slot is voiced, `again: true`, and it has words → re-voice only: new clip under a new key, row
  moved to it, `voiced_at` bumped → `200 SlotDoc`.
- Slot is written, not voiced → voice only (a previous voicing failed).
- Slot is proposed → **write, then voice**:
  1. Read `settings.clock` and `station.identity`; `isBreak(seq, breakEvery)`; the last break's
     `clock_ms` → `legalIdDue`.
  2. Gather the brief (R5): the last three written slots' copy, everything played, prior charts of
     any of this slot's hits from other sessions; for a break only, the weather and the headlines
     (a failed feed is logged and left out).
  3. One Claude call (the writer, `Written` shape): pick id, chart, copy, timing. A refusal or a
     pick outside the hits → one retry. Both failing → the no-chart segue on the first hit (R3).
  4. `checkSlot` (the house rules) → the kind, the fallback, the clamped timing, the legal ID.
  5. One `update session_slot set …` with every written column and `clock_ms`.
  6. Voice: `legal_id + words + lead_line` through ElevenLabs in the session's voice → `PUT`
     `sessions/<id>/<seq>.mp3` → `update … clip_key, voiced_at`. A segue is stamped voiced with no
     clip and no TTS call.
  7. Commit.

  If step 6 fails, the write from step 5 is **committed** and the response is
  `502 { error, slot: SlotDoc }` with `status: "written"`. The next request voices only.

Response `200 SlotDoc` (`status: "voiced"`, `held` as of now). `400` bad body. `409` lock.
`502 { error }` when the fill of the brief or the writer failed outright.

Logs one line per write: `[session xxxxxxxx] slot N written: <kind>, <artist> — <title> (<pick id>)`
and one per voicing, as today.

## `GET /api/sessions/:id/slots/:seq/clip` — the clip's bytes

`audio/mpeg`, `Cache-Control: public, max-age=31536000, immutable`. The browser appends
`?take=<clipKey>` so another take is another URL. `404` when the slot has no clip.

## `POST /api/sessions/:id/slots/:seq/track` — pull the slot's pick

Not under the lock. Body: none.

- Slot unknown → `404`; slot proposed (no pick) → `409 { error: "slot :seq is not written yet" }`.
- `track` row exists → `200 { held: true, ...Tags }`, no Qobuz call.
- Bucket `HEAD tracks/<id>.mp3` finds the bytes → insert the row from the pick's tags → `200`.
- Else Qobuz `download` (MP3 320) → `PUT` → insert the row (`on conflict do nothing`) → `200`.
- `502 { error }` on a Qobuz or bucket failure (the slot stays voiced; the browser retries on its
  next pass or on load).

Two pulls of the same record at once cost one duplicate download and land the same bytes under the
same key.

## `GET /api/sessions/:id/slots/:seq/track` — the record's bytes

`audio/mpeg`, immutable, streamed from the bucket. `404` when the pick is not held. Qobuz is
never touched at play time.

## Retired

`POST …/segments/:num/playlist`, `POST …/segments/:num/program`,
`POST`/`GET …/segments/:num/slots/:seq/audio`, `POST`/`GET …/segments/:num/tracks/:seq/audio`,
and the `segments[]` array of the snapshot. Any client still calling them gets Next's 404.

## The browser's loop (the client half of the contract)

```
load snapshot
repeat:
  move = nextMove(slots, clock, cueSeq, attempted)     // loop.ts, pure
  fill      → POST /fill, fold `added` in
  slot f    → POST /slots/f { clockMs }; fold in; if pick && !held → POST /slots/f/track (not awaited), fold `held` in
  none      → wait for the deck (a cue change re-runs the loop)
```

`nextMove`: fill when there are no slots or `proposed count ≤ lowWater` (once per slot count);
else the first unvoiced slot *f* when `f.seq ≤ (cueSeq ?? 0) + 1` (once per page life); else none.
