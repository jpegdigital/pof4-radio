# Contracts: the station API

All routes are Next route handlers under `apps/web/src/app/api/`, JSON in / JSON out unless
noted, behind Guard like everything else. Errors: `{ error: string }` with the status shown.
Types referenced are `packages/dj/src/program/shapes.ts` (`Record`, `Card`, `Line`, `LogSlot`,
`Note`) and the player's `Element`.

**Amended 2026-08-30 (the slot producer).** A segment is opened cheaply and then produced one
slot at a time; the first note waits for one card, one short write and one clip — not for the
whole segment. `POST /api/segment/:id/voice` is gone.

## `POST /api/station/open` — a request becomes a station and its opening segment

Request
```json
{ "prompt": "Saturday night 80s, Dallas, hits-forward, keep it warm", "dj": "David Wolfe", "voiceId": "…", "clockMs": 74580000 }
```
`clockMs` (optional): the listener's clock, ms since local midnight — `{clock}` in the briefs
and the top of the hour are theirs, not the server's.

Does, in order: create the station (identity from settings) → **discover** the hour (one call
+ Spotify search; a hit counts only when its name is the title *and* its artist is the pick's,
the shortest such hit preferred; a pick with no such hit is dropped with why; ≥ 6 resolved or
502) → take the first 3–5 records as segment 1 → keep it **open**: records known, no card, no
words, no clip. No other model call.

Response `200`
```json
{
  "stationId": "uuid",
  "skeleton": { "records": [Record], "breaks": [0, 4, 8, 12], "consumed": 4, "dropped": [{ "pick": 3, "reason": "no hit for …" }] },
  "segment": SegmentView,
  "timing": { "discoverMs": 0, "ms": 0 }
}
```

`SegmentView` (also what `GET /api/station/:id` returns per segment). It grows: `log.slots`,
`lines`, `elements` and `notes` cover the slots produced so far; `records` past
`log.slots.length` are still to come; `complete` once every record has its slot.
```json
{
  "id": "uuid", "seq": 1, "prompt": "…", "complete": false,
  "records": [Record], "lines": [Line], "log": { "slots": [LogSlot], "fallbacks": [], "topOfHour": true },
  "cards": { "<trackId>": { "introMs": 0, "sure": false, "post": "the title line", "outro": "fade", "energy": 3, "notes": ["…"] } },
  "dropped": [{ "pick": 3, "reason": "no hit for …" }],
  "elements": [Element], "notes": [Note]
}
```

Errors: `400` invalid body · `502` `{ error: "discover: …" }` when the planner refuses or fewer
than 6 records resolve · `503` when `ELEVENLABS_KEY`/bucket are unset (the show cannot be kept).

## `POST /api/station/:id/next` — the segment after the last kept one

Request `{ "prompt": "…", "clockMs": 74580000 }` (the request in force; may differ from the
station's — then the skeleton is re-discovered from the change point, played records excluded).

Does: lock the station row (`409 busy` if held; `409` too while the last segment is still
producing) → if the skeleton has < 3 unconsumed records or the prompt changed → **discover**
again (played records passed in, never repeated) → next 3–5 records → keep **open**. The break
carries the legal ID when the hour turned since the previous segment was opened.

Response `200` `{ "segment": SegmentView, "skeleton": {…}, "timing": {…} }` · `404` unknown
station · `409` busy.

## `POST /api/segment/:id/slot/:seq` — one slot, end to end

Request `{ "clockMs": 74580000 }` (optional). Slots go in order from 0; `seq` past the slots
produced so far is `409`; a slot already produced answers with the segment as kept (idempotent).

Does, under the station lock: the record's **card** (table first; made now if missing, at medium
effort, never quoting a lyric; a refusal or the API's output filter retried once, then *no card* —
the slot becomes a segue, the record is never dropped) → **write** the slot (one call at medium
effort: the treatment and every word; the brief carries the segment's records with this one
marked, the card in full, everything said on the station so far, and the legal ID for slot 0 at
the top of the hour) → `checkSlot` (slot 0 is the break; a break elsewhere is a sweeper; a talk-up
needs a card with a ≥ 7 s intro) → the **clip** through ElevenLabs `/with-timestamps`, `timingsOf`
at known character offsets, `PUT` to the bucket at `stations/<station>/<segment>/<seq>.mp3` →
`assembleSlot` (the ladder: post → late → none; lead → end; break → sweeper → segue; voiced →
produced sweeper → segue; dry bed) → the segment row grown (`lines`, `log.slots`, `elements`,
`notes`, `usage.slots[]`); the last slot sets `voiced_at` and the row is immutable after.

Response `200` `{ "segment": SegmentView, "seq": 2, "timing": { "cardMs": 0, "writeMs": 0, "voiceMs": 0, "ms": 0 } }`.
A failed clip is a fallback in the assembly, not an error. `404` unknown segment · `409` busy or
out of order · `503` key/bucket missing.

## `GET /api/clip/:segmentId/:seq` — one clip

Streams the object from the bucket: `Content-Type: audio/mpeg`, `Cache-Control: public,
max-age=31536000, immutable`, `Accept-Ranges: bytes` (a full body; range requests are not
honoured — clips are decoded whole by the graph). `404` when the key is absent.

## `GET /api/station/:id` — a kept station, whole

Response `{ "station": { "id", "prompt", "dj", "voiceId", "identity", "segmentCount", "updatedAt" }, "skeleton": {…}, "segments": [SegmentView] }` — every segment, complete or not, in `seq` order. `404` unknown.

## `GET /` (page data)

The page arrives with: the roster (names/ids), the past stations (`listStations`: id, prompt,
dj, segmentCount, updatedAt), the identity cookie, the station identity row.

## Removed

`POST /api/segment/:id/voice` (2026-08-30: the slot route voices as it goes). Earlier:
`POST /api/station/next` (the bridge planner) and the browser's per-talk `GET /api/tts` use
for the show. `GET /api/tts` and `POST /api/tts/preview` stay for `/settings` → Voices.

## `/settings` → Prompts

The slots are `prompt.system`, `prompt.discover`, `prompt.card`, `prompt.write` (a per-slot
brief: `{slot}`, `{records}` with the slot's record marked, `{cards}` = that record's card,
`{previous_words}` = everything said so far, `{legal_id}`), and a `station.identity` editor
(three fields). Placeholder legend per slot from `PROMPT_SLOTS`.
