# Quickstart: validating the client-driven station

Prerequisites: 1Password CLI signed in, `.env.op` with `ELEVENLABS_KEY` added, Spotify Premium account
connected on the page, `pnpm db:apply` run for the `station`/`segment` schema, `pnpm db:clear` to drop prototype
rows.

## Run

```
pnpm dev            # web only now — there is no worker
```
Open https://dev.radio.pof4.com:3000 (through Guard).

## Scenarios

1. **Cold start (US1, SC-001)** — pick a voice in Settings, enter a prompt, press **Run**. Expect: "planning…"
   → spoken intro within 60 s → first song on the Spotify device in this tab. The history list gains segment 1.
2. **One ahead (US1, SC-002)** — while the intro plays, the network tab shows a second `/api/station/next`.
   Let the block play out. Expect: talk 2 starts < 1 s after the last song ends and refers to the block that
   just played.
3. **Stop / Run (US2, SC-003/004)** — press **Stop** mid-song: audio stops, no new `/next`. Press **Run**:
   buffered segment's talk starts within 1 s. Reload the page, press Run: the DJ continues the same
   conversation (talk references earlier blocks; `station.segment_count` keeps climbing).
4. **Transport (US3)** — during talk press ⏭: first song starts. Pause/play the song: station stays "running".
   ⏮/⏭ move within the block; ⏭ on the last song → next talk (or "planning…" if you outran the DJ, then the talk
   starts by itself). The following talk still reads naturally after heavy skipping.
5. **Voice (US4, SC-007)** — change voice in Settings; the *next generated* talk uses it; reload keeps the
   choice.
6. **Failure paths** — set a bogus `voiceId` in localStorage: the talk is skipped, songs still play, error is
   shown. Temporarily break `CLAUDE_KEY`: first failure retries once, second stops the station with the error.
7. **Two tabs** — open the page in a second tab and press Run while the first is planning: 409 `busy` is
   surfaced as "another tab is running this station".

## Checks

- `pnpm check` (lint, format, typecheck, unit tests for the reducer, DJ trimming, prompt builders) and
  `pnpm --filter web build`.
- `pnpm db:sql "select seq, left(talk,60), jsonb_array_length(tracks) from segment order by seq"`.
- `pnpm db:sql "select jsonb_array_length(messages), segment_count from station"` — messages ≈ 3 × segments
  (trimming works) and never above 60.
- Claude response `usage.cache_read_input_tokens` > 0 from the second segment on (log it in the route).
