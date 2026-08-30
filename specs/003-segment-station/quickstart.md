# Quickstart: the segment station, live

Live verification against the dev server. Nothing here touches Railway except the shared
database and the `clips` bucket, which dev and prod share on purpose.

## Prerequisites

- `op run --env-file=.env.op -- pnpm dev` at `https://dev.radio.pof4.com:3000` (needs
  `DATABASE_URL`, `SPOTIFY_CLIENT_ID/SECRET`, `CLAUDE_KEY`, `ELEVENLABS_KEY`, the five `BUCKET_*`).
- Schema applied: `pnpm db:plan` shows nothing to do after `pnpm db:apply`. Old bridge-style
  stations cleared first (`delete from station;` via `pnpm --filter @radio/db sql`).
- Settings rows present: `prompt.system`, `prompt.discover`, `prompt.card`, `prompt.write`,
  `station.identity`, `voices` (at least one voice). Fill on `/settings`.
- `apps/web/public/bed.mp3` present (copied by hand). `/sweepers/*.mp3` optional.
- A Spotify Premium account connected on `/`.

## 1. Cold start (US1, SC-001)

1. Open `/`. Type `Saturday night 80s, Dallas, hits-forward, keep it warm`. Press **Run**; start a
   stopwatch.
2. Expected within ~30 s: the rundown lists the hour's records (skeleton) with the first 3–5 grouped
   as segment 1; rows show "producing…".
3. Expected within ~50 s: segment 1's rows show treatments and the DJ's words (`open` landed).
4. Expected within 60 s: the opening plays over the bed (legal ID dry first), the first song comes in
   under the lead line and rises to full as the clip ends. Note the time.
5. While song 1 plays: the network tab shows `POST /api/station/:id/next` then `POST
   /api/segment/:id/voice`; segment 2's rows fill in. Its break plays after the last song of
   segment 1 with no silence.
6. Talk-ups: where a card's `sure` is true, the voice ends a beat before the post (SC-007);
   otherwise it comes in 1.5 s after the song starts (badge `post → late`).

Check: `select seq, voiced_at is not null as voiced, jsonb_array_length(notes) from segment
where station_id = '…' order by seq;` — one row per segment, all voiced.

## 2. Resume (US2, SC-003)

1. After two segments have played, **Stop**, reload `/`, pick the station under "Resume a show".
2. Expected: every row of both segments appears at once with words, timings and badges; **Run**
   plays segment 1 from the top; tapping any row jumps there.
3. Expected in the server log: no `discover`, `card`, `write` or ElevenLabs calls; only
   `GET /api/station/:id` and `GET /api/clip/...` (which the browser caches; a second run hits
   nothing).
4. Let it run past segment 2. Expected: `next` + `voice` produce segment 3; its break bridges from
   segment 2's words; no record from segments 1–2 repeats.

## 3. Cards are shared (US3, SC-004)

1. Note `select count(*) from card;` after run 1 and the `cardsMs` from `open`'s response.
2. Start a **new** station with the same request. Expected: most records already carded;
   `open`'s `cardsMs` near 0 for those and `ms` at least 40 % lower than the cold run.
3. Corrupt one card's `intro_ms` to 3000 for a record used by a *kept* segment; resume that
   station: it plays with its kept timings (immutable). Start another station including that
   record: the talk-up is a segue or late (the corrected card was used).

## 4. Fallbacks never stop the show (US1.5, FR-013)

1. Set `ELEVENLABS_KEY` to a bad value, restart dev, run a new station. Expected: `open` lands;
   `voice` returns `200` with every clip in `failed[]`; every talk element falls back to its
   wordless form; the show plays songs and sweepers; the rundown shows a badge per row.
2. Stop the bucket (`BUCKET_NAME=wrong`): `voice` answers `503` with a clear message; the rows
   stay "producing…"; the player plays a clean segue into the next resolved song (R8) and retries.

## 5. Busy station (FR-017)

Open the same station in two tabs and press Run in both. Expected: one produces; the other
gets `409 busy` on `next`, shows it in the rundown, and still plays kept segments.

## 6. Deletable sandbox (FR-015, SC-006)

`grep -rn "(program)" apps/web/src --include=*.ts --include=*.tsx | grep -v "app/(program)/"`
returns nothing. (Temporarily moving the folder out and running `pnpm --filter web build` is
the stronger check; not required.)

## 7. Unit tests

`pnpm check` runs, beside the existing suites: `shapes.test.ts`, `clock-rules.test.ts` (per-segment
rules: first slot break, talk-up gate, legal ID when the hour turned), `assemble.test.ts` (every
rung), `timings.test.ts` (offsets from an alignment), `sigv4.test.ts` (the AWS test vector),
`reducer.test.ts` (lanes + `APPEND_SEGMENT` / `LOAD_SHOW` / pending rows).
