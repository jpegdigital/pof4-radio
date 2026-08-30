# Quickstart: the segment station, live

Live verification against the dev server. Nothing here touches Railway except the shared
database and the `radio-clips` bucket, which dev and prod share on purpose.

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

Run 2026-08-30 (`grep -rn "(program)" apps/web/src --include=*.ts --include=*.tsx | grep -v "app/(program)/"`):
no output — nothing on the home path imports the sandbox.

## 7. Unit tests

`pnpm check` runs, beside the existing suites: `shapes.test.ts`, `clock-rules.test.ts` (per-segment
rules: first slot break, talk-up gate, legal ID when the hour turned), `assemble.test.ts` (every
rung), `timings.test.ts` (offsets from an alignment), `sigv4.test.ts` (the AWS test vector),
`reducer.test.ts` (lanes + `APPEND_SEGMENT` / `LOAD_SHOW` / pending rows).

## First walk

**2026-08-30, implementation session — verified without spending on a show:**

- `pnpm check` green (lint, format, typecheck, all suites incl. the six new ones) and `pnpm --filter web build` green.
- Schema applied to the Railway Postgres (`pnpm db:apply`, 20 actions; a re-plan is empty). The old
  bridge-style rows were cleared (39 stations / 99 segments) — sandbox mode, per tasks.md.
- Settings seeded: `prompt.discover`, `prompt.card`, `prompt.write`, `station.identity`
  (`WFAI`, Dallas, "56.6, Claude Radio"); `prompt.system` and the `voices` roster kept as they were; the
  retired `prompt.opening/bridge/shift` rows are left in the table, unread.
- Bucket: `apps/web/scripts/bucket-smoke.mts` against `radio-clips` — PUT 200, GET 200 with the body
  back, GET of a missing key 404. The signer also passes the AWS test vectors (`sigv4.test.ts`).
- Routes smoke on dev: `GET /api/station/<bad id>` 404, `POST /api/segment/<bad id>/voice` 404,
  `GET /api/clip/<bad>/0` 404, `POST /api/station/open` with a bad body 400.

**Still to walk live (needs a Spotify Premium session in the browser and spends Claude + ElevenLabs):**
§1 timings (T041 — record open/voice ms and time-to-opening here), §2.4 continue past the end (T045),
§3 card immutability on a second station (T049), §4 fallbacks and §5 busy (T056).

**Deviations from the plan, all deliberate:**

- `open` and `next` take a `clockMs` body field (ms since the browser's local midnight) so `{clock}` and
  `hourTurnedBetween` use the listener's wall clock, not the server's.
- A second `break` treatment inside one segment is rewritten to `sweeper` by `checkSegmentLog` (one
  break per segment), logged as a fallback.
- When a top-of-hour break comes back without a legal ID, it is filled from `station.identity` and
  noted as a `break→break` fallback rather than failing the write.
- `voice` falls back to the first voice on the roster when the station's `voiceId` is no longer there.
- The Winamp skin (`app/(winamp)`) was ported onto `useProgram` rather than removed.

## Amendment, 2026-08-30 (later): the slot producer

The first real walk (§1) showed the shape was wrong for the hot path: `open` did discovery, every
card of the first run, and the whole segment's write before returning anything, then `voice` did
every clip before a note played; a card blocked by the API's output filter (it quoted a lyric)
retried and dropped the record; discovery took Spotify's first hit when no title matched, playing
the wrong record. Replaced the same day:

- **The unit of production is the slot.** `open` / `next` only open a segment (discover when
  needed, keep its records — no card, no words); `POST /api/segment/:id/slot/:seq` produces one
  slot end to end (card → line → clip → elements, appended to the row); the last slot completes the
  segment. `voice` is gone. Contracts in `contracts/api.md`.
- The browser paints the records the moment a segment opens, asks for slot 0 (the break), plays
  it, and asks for the rest under the music; a slot that hasn't landed when its record is due is
  a clean segue (its late clip is kept, not played). On a fresh show it waits in silence for the
  opening break instead.
- Cards never quote a lyric (the post is *where* the vocal comes in); the filter's 400 is treated
  as a refusal (one more try); no card is a segue, never a dropped record. Discovery requires the
  title *and* the artist to match, else the pick is dropped with why (shown as "Not found").
- The `prompt.write` row is now a per-slot brief (`{slot}` var; `{records}` marks the slot's record;
  `{previous_words}` is everything said so far); `prompt.card` says no lyrics. Both rows were
  replaced in the table on 2026-08-30. Card and write calls run at medium effort.

Walk §1 again: expect time-to-first-note ≈ discover + one card + one short write + one TTS.

