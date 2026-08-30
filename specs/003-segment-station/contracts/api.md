# Contracts: the station API

All routes are Next route handlers under `apps/web/src/app/api/`, JSON in / JSON out unless
noted, behind Guard like everything else. Errors: `{ error: string }` with the status shown.
Types referenced are `packages/dj/src/program/shapes.ts` (`Record`, `Card`, `Line`, `LogSlot`,
`Note`) and the player's `Element`.

## `POST /api/station/open` — a request becomes a station and its opening segment

Request
```json
{ "prompt": "Saturday night 80s, Dallas, hits-forward, keep it warm", "dj": "David Wolfe", "voiceId": "…" }
```

Does, in order: create the station (identity from settings) → **discover** the hour (one call
+ Spotify search; records resolved, shortest matching hit preferred; ≥ 6 or 502) → take the
first 3–5 records as segment 1 → **cards** for those (table first; missing ones enriched in
parallel, ≤ 5; a record with no card is dropped and, if fewer than 3 remain, the next skeleton
record is pulled in) → **write** segment 1 (one call: treatments + every word; break at slot 0
with the legal ID) → `checkLog` → keep the segment (`written`).

Response `200`
```json
{
  "stationId": "uuid",
  "skeleton": { "records": [Record], "breaks": [0, 4, 8, 12], "consumed": 4 },
  "segment": SegmentView,
  "timing": { "discoverMs": 0, "cardsMs": 0, "writeMs": 0, "ms": 0 }
}
```

`SegmentView` (also what `GET /api/station/:id` returns per segment):
```json
{
  "id": "uuid", "seq": 1, "prompt": "…", "voiced": false,
  "records": [Record], "lines": [Line], "log": { "slots": [LogSlot], "fallbacks": [], "topOfHour": true },
  "cards": { "<trackId>": { "introMs": 0, "sure": false, "post": "…", "outro": "fade", "energy": 3, "notes": ["…"] } },
  "dropped": [{ "pick": 3, "reason": "refusal" }],
  "elements": null, "notes": null
}
```

Errors: `400` invalid body · `502` `{ error: "discover: …" }` when the planner refuses or fewer
than 6 records resolve · `503` when `ELEVENLABS_KEY`/bucket are unset (the show cannot be kept).

## `POST /api/station/:id/next` — the segment after the last kept one

Request `{ "prompt": "…" }` (the request in force; may differ from the station's — then the
skeleton is re-discovered from the change point, played records excluded).

Does: lock the station row (`409 busy` if held) → if the skeleton has < 3 unconsumed records or
the prompt changed → **discover** again (played records passed in, never repeated) → next 3–5
records → **cards** → **write** (previous segment's words in the brief; `legalId` on the break
when the hour turned since the last break, by the clock at production time) → keep.

Response `200` `{ "segment": SegmentView, "skeleton": {…}, "timing": {…} }` · `404` unknown
station · `409` busy.

## `POST /api/segment/:id/voice` — voice, time, assemble, keep

No body. Idempotent: a voiced segment returns its kept `elements`/`notes` at once.

Does: read the segment and its cards → for every `Line`, ElevenLabs `/with-timestamps` in a pool
of 3 (the break first) → `timingsOf` at known character offsets → `PUT` each clip to the bucket
→ `assemble` (the sandbox's ladder, unchanged: post → late → segue, lead → end, break → sweeper →
segue, dry bed) → write `elements`, `notes`, `voiced_at`.

Response `200`
```json
{ "segmentId": "uuid", "elements": [Element], "notes": [Note], "failed": [{ "seq": 2, "error": "elevenlabs 429: …" }], "timing": { "ms": 0 } }
```
A failed clip is a fallback, not an error: the response is still `200` and the segment is
`voiced`. `503` only when the key or bucket is missing. Clip names inside `Element` are the
play URL `/api/clip/<segmentId>/<seq>`.

## `GET /api/clip/:segmentId/:seq` — one clip

Streams the object from the bucket: `Content-Type: audio/mpeg`, `Cache-Control: public,
max-age=31536000, immutable`, `Accept-Ranges: bytes` (a full body; range requests are not
honoured — clips are decoded whole by the graph). `404` when the key is absent.

## `GET /api/station/:id` — a kept station, whole (changed)

Response `{ "station": { "id", "prompt", "dj", "voiceId", "identity", "segmentCount", "updatedAt" }, "skeleton": {…}, "segments": [SegmentView] }` — every segment, voiced or not, in `seq` order. `404` unknown.

## `GET /` (page data, changed)

The page arrives with: the roster (names/ids), the past stations (`listStations`: id, prompt,
dj, segmentCount, updatedAt), the identity cookie, the station identity row. Unchanged in shape
from today except `dj` on each summary.

## Removed

`POST /api/station/next` (the bridge planner) and the browser's per-talk `GET /api/tts` use
for the show. `GET /api/tts` and `POST /api/tts/preview` stay for `/settings` → Voices.

## `/settings` → Prompts (changed)

The slot list becomes `prompt.system`, `prompt.discover`, `prompt.card`, `prompt.write`, and a
`station.identity` editor (three fields). Placeholder legend per slot from `PROMPT_SLOTS`.
