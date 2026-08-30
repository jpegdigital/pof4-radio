# Research: Segment Station

Decisions taken before design, each with what was weighed. Nothing here needed outside
research; every question is answered by the code already in the tree, the design conversation,
or `CLAUDE.md`'s rules.

## R1. The unit of production is the segment, not the stage

**Decision**: A segment = one break (the opening on segment 1) + 3–5 songs. The server produces
one segment per request; the browser asks for the next one the moment the current segment's
first song starts, so it is always one ahead. The hour's *skeleton* (records in order, breaks at
segment boundaries) is planned once per hour by discovery and consumed segment by segment.

**Rationale**: The five sandbox stages are horizontal (all records through each stage); a
listener needs the *first* playable thing fast. Cutting vertically makes the cold start the cost
of one segment (~50–60 s) instead of the hour (~2.4 min), and every later segment is produced
under cover of music. Breaks at segment boundaries make the "3–4 songs between breaks" rule
structural rather than something the model has to be checked on.

**Alternatives**: (a) one blocking call for the whole hour — killed by proxy/route timeouts and a
dead two-minute spinner; (b) streaming the five stages over one connection — same cold start,
just narrated; (c) produce the first element only, then the rest — best on-air but the player
would need to accept elements one at a time mid-segment; deferred, the segment shape allows it
later.

## R2. Two production calls plus a voice call, not five stage routes

**Decision**: `POST /api/station/open` (request → station + skeleton + segment 1, unvoiced),
`POST /api/station/:id/next` (→ segment N+1, unvoiced), `POST /api/segment/:id/voice` (→ the
segment's clips in the bucket, timings computed, `Element[]` assembled and kept). The
discover/enrich/log/script/voice functions survive as *functions* inside those calls.

**Rationale**: The JSON/voice split lets the page paint the rundown and the DJ's words ~15 s
before audio exists (progressive enhancement), makes a voice retry cheap (no Opus re-run), and
keeps each request well under a minute. Log and script collapse into one "write" call per
segment: with 3–5 treatments to decide, a separate log call buys nothing but ~10 s; `checkLog`
still validates the result after the fact, so the rules remain enforced in code, not in the prompt.

**Alternatives**: keeping log and script serial (rejected: the cold-start budget); voicing
inside `open` (rejected: no progressive paint, one long request); voicing per element from the
browser like the station does today (rejected: timings must be computed server-side from
alignment and kept with the segment — FR-006/FR-008).

## R3. Clips live in the Railway bucket, served by the app

**Decision**: Every clip is `PUT` to the `radio-clips` bucket at `stations/<stationId>/<segmentId>/<seq>.mp3`
at voice time and streamed back by `GET /api/clip/<segmentId>/<seq>` with immutable caching.
Railway buckets are private, so the app serves them — the same pattern dreamweaver uses
(`/media/<key>`).

**Rationale**: FR-016 (outside the app's file tree), immutability (a key is written once), and
free egress. Postgres `bytea` was the fallback if the bucket was refused; it isn't.

**Alternatives**: `bytea` in the one database (viable at this scale, rejected once the bucket
existed); presigned URLs (Railway buckets don't expose public reads and the app already gates
everything behind Guard).

## R4. The bucket client is SigV4 by hand, no SDK

**Decision**: `apps/web/src/lib/bucket.ts` implements AWS Signature V4 for `PUT` and `GET`
object with Web Crypto (`crypto.subtle` HMAC-SHA256 / SHA-256) and `fetch` — ~80 lines, tested
against the published SigV4 test vector. Config from `BUCKET_*` env (five values Railway sets
from the bucket's refs; mirrored in 1Password `pof4-radio-clips-bucket`).

**Rationale**: `CLAUDE.md`: "Before adding a package, ask whether fetch, Web Crypto, the
platform, or thirty lines of our own would do." Two verbs on one bucket do not justify
`@aws-sdk/client-s3` (~2 MB, its own HTTP stack). Dreamweaver's `packages/storage` was read and
its shape (`put`/`open`) kept; only the transport differs.

**Alternatives**: `@aws-sdk/client-s3` as dreamweaver does — rejected on the dependency rule;
noted as the escape hatch if the endpoint proves incompatible with hand-signing (Railway's
buckets are Tigris-backed, standard SigV4, path-style not required).

## R5. Cards move to Postgres, keyed by Spotify track id

**Decision**: `card` table, one row per track id, the sandbox's `Card` shape as columns +
`facts jsonb`. Enrichment checks the table first; a refusal is retried once, then the record is
dropped from the *segment* with the reason kept on the segment row. Cards may be corrected in
place (UPDATE); kept segments never re-read them.

**Rationale**: FR-011/FR-012 and User Story 3. A file cache under `public/` cannot survive a
deploy; the one database already exists.

## R6. Station memory is the kept data, not a Claude conversation

**Decision**: `station.messages` (the conversation-shaped memory of the current show) goes away.
Each production brief is built from kept rows: the skeleton, what has been played, the previous
segment's words. Discovery for the *next hour* receives the played records so nothing repeats.

**Rationale**: Segments are the memory; a second copy in a conversation is a second thing to
trim and cap (today: 20 segments, row-locked). Briefs built from rows are also what makes
"continue a kept station" trivial (FR-010, FR-018).

**Alternatives**: keep the conversation and append segment turns — rejected: every prompt-cache
miss is paid on the system prompt anyway (per-request tools and briefs differ), and the
conversation would duplicate what the tables hold.

## R7. The player is the sandbox's reducer, lifted and extended

**Decision**: `components/station/` gets the program reducer (three lanes, `Element[]`,
`playSeq`/`micSeq`), `use-program.ts` (seven effects) and the timeline, copied — not imported —
from `(program)` and renamed for the home. Additive events: `LOAD_SHOW` (a kept station's
elements + per-segment metadata), `APPEND_SEGMENT` (a voiced segment landing while running),
`SEGMENT_PENDING` (rows painted from the unvoiced segment). The current station reducer,
`use-station.ts`, `show.tsx` and the bridge-style prompts are removed.

**Rationale**: FR-015 (no dependency on `/program` — copying keeps the sandbox deletable);
"replace, this is the app now". The program reducer already plays exactly the elements the
producer assembles.

**Alternatives**: importing from `(program)` — rejected by FR-015; adapting the station reducer
— rejected: it has no lanes, no bed, no timed talk-ups.

## R8. The next segment is asked for at the first song, voiced at once, clips pre-decoded

**Decision**: When the cursor lands on a segment's first song, the browser calls `next`, then
`voice` on what comes back, then fetches and decodes the new clips into the Web Audio graph
(the sandbox's voice cache, keyed by clip URL). Budget: 3–5 songs ≈ 12–20 min of cover for
~40 s of production.

**Rationale**: FR-004 and SC-002. The station today prefetches talk by position; this is the same
idea one level up.

**Edge**: if the next segment is not voiced when the current one ends, the player plays a clean
segue into the next *resolved* song (the skeleton's record is known even before its card) and
retries `voice`; only when nothing is resolved does it wait, with the row marked "producing…".

## R9. Prompts move to settings; rules stay in code

**Decision**: Four slots — `prompt.system`, `prompt.discover`, `prompt.card`, `prompt.write` —
in the `settings` table, edited on `/settings`, with the sandbox's `RULES_TEXT`, the clock
(`clockOf`), and the tool schemas remaining in code. The old `prompt.opening` / `prompt.bridge` /
`prompt.shift` rows are retired. The station's identity (calls, city, on-air name) becomes a
`station.identity` settings row.

**Rationale**: `CLAUDE.md`: "the prompts are settings"; the sandbox's prompts-in-code was a
sandbox convenience.

## R10. Cold-start budget

Measured from the sandbox walk (12 records): discover 24.6 s, a card ≈ 10 s (five in parallel),
script 19 s for 9 lines, a clip ≈ 4 s (two in parallel).

Segment 1 estimate: discover ~25 s (hour skeleton, 10–14 records) + cards for the segment's 3–5
records in parallel ~12 s + write ~10 s (3–5 lines) → **open ≈ 45–50 s**; voice 2–5 clips in a
pool of 3 ≈ 8–12 s → **audio at ≈ 55–60 s** on a true cold start; ≈ 35 s when cards are known
(SC-001). Two dials if it runs long: discovery effort (`medium` → `low`) and voicing the
opening's clip first and returning it before the talk-ups (the voice route can answer in two
parts later without changing its contract).
