# Quickstart: make a program and play it

Live verification for the program pipeline. Everything below runs against the dev server; nothing
here touches Railway.

## Prerequisites

- `op run --env-file=.env.op -- pnpm dev` running at `https://dev.radio.pof4.com:3000`
  (needs `CLAUDE_KEY`, `SPOTIFY_CLIENT_ID/SECRET`, `ELEVENLABS_KEY`, `DATABASE_URL`).
- A `voices` row with at least one voice (the first is the program's DJ).
- `apps/web/public/program/bed.mp3` present (the talk bed — not produced by any script; copy it
  in). Optional: `pnpm exec node scripts/sweepers-prep.mjs` for produced sweepers.
- A Spotify Premium account connected on `/program`.

## 1. End to end (US1)

1. Open `https://dev.radio.pof4.com:3000/program/make`.
2. Type a request, e.g. `Saturday night 80s, Dallas, hits-forward, keep it warm`. Leave the
   station and DJ as pre-filled. Press **Make**.
3. Watch the five stages land in order. Expected: each shows a green check and a link to its file;
   total under 5 minutes (SC-001).
4. Open `/program`. Expected: the rundown lists the new set, each row with its treatment, its
   words, and any fallback badge. Press **Run**. Expected: the opening break plays over the bed,
   the lead line ends as the first song comes in under it, talk-ups end a beat before the post
   where the card was sure (SC-006), sweepers/segues are clean.

Check: `apps/web/public/program/make/program.json` exists and `notes[]` has one entry per clip.

## 2. Re-run from a stage (US2)

1. Open `apps/web/public/program/make/log.json`; change one `"talkup"` to `"segue"`; save.
2. On `/program/make` press **Run** on `script`, then on `voice`.
3. Expected: `script.json` has no line for that `seq`; `program.json` has a plain song there;
   `picks.json` and `cards/*` timestamps unchanged; no discovery/enrichment calls in the server
   log; both stages under a minute together (SC-003).

## 3. Cards are cached (US3)

1. After run 1, note `ls apps/web/public/program/make/cards | wc -l`.
2. Run **discover** again with a request that overlaps the first set (e.g. the same request).
   Run **enrich**. Expected: the response's `reused[]` lists the overlapping ids; only new records
   were enriched; the cached files' timestamps are unchanged (SC-004).
3. Corrupt one card (`echo '{}' > cards/<id>.json`) and run **enrich** again. Expected: the card
   is rewritten (invalid ⇒ treated as missing). Delete a card and set its record's name to
   gibberish in `picks.json`, run **enrich**: expected the record lands in `picks.json.dropped`
   with the reason and the run continues.

## 4. Fallbacks never stop the show (US4)

1. In `cards/<id>.json` of a talk-up slot, set `introMs` to `3000`. Run **voice**.
   Expected: that note has `fallback: { from: "post", to: "late", … }` and `atMs = TALKUP_LATE_MS`;
   `/program` plays the song with the voice coming in 1.5 s after it starts.
2. In `script.json`, delete `leadLine` from a break. Run **voice**. Expected: the note shows
   `fallback: { from: "lead", to: "end" }`, `leadMs: 0`; the next song starts when the clip ends.
3. In `script.json`, delete a break's `words`. Run **voice**. Expected: the slot becomes a
   sweeper (if `/program/sweepers` has clips) or a segue, recorded as a fallback; playback is fine.
4. Point `ELEVENLABS_KEY` at a bad value and run **voice**. Expected: every clip fails, every
   talk element falls back to its wordless treatment, `program.json` is still written and playable
   (SC-002); the response reports each failed clip.

## 5. Malformed input is named (FR-005)

Set `slots[0].intro` in `log.json` to `"talkupx"` and run **script**. Expected `400` with
`log.json: slots[0].intro — …` and nothing written.

## 6. Unit tests

`pnpm check` runs `shapes.test.ts`, `clock-rules.test.ts`, `assemble.test.ts` alongside the
existing reducer tests. The assembly test covers each rung of the fallback ladder.

## First walk (2026-08-30) — what deviated

Run with the sample request via the routes (curl), 12 records asked for:

- **Timing**: discover 24.6 s (12/12 resolved) · enrich 50.3 s (11 cards, 5 in parallel) · log 14 s ·
  script 19 s · voice 33 s (9 clips) — **≈ 2.4 min** end to end (SC-001: 5 min). A second `enrich`
  reused all 11 cards in 29 ms with zero tokens (SC-004). A `script` re-run from a hand-edited
  `log.json` touched nothing upstream; a malformed `intro` came back as
  `400 log.json: slots[0].intro — Invalid option: …` with nothing written (§5).
- **Every card came back `sure: false`.** Opus is honest about "within a second or two". The
  planned rule (`talkup` needs `card.sure`) would have downgraded every talk-up to a segue, so the
  rule moved: the log only needs `introMs ≥ MIN_TALKUP_INTRO_MS`; `sure` decides *in assembly*
  between landing the post and the late start (`post → late: card not sure`, voice 1.5 s in). All
  three talk-ups in the walk took the late rung and play cleanly under long intros (24–38 s).
  Tuning idea, not done: land the post anyway when the intro leaves a wide margin.
- **The model mis-places the hour.** Twice it marked `topOfHour` on slot 3 while the clock said
  slot 5. The validator now *promotes* the slot where the hour turns to the top-of-the-hour break
  (recorded as `segue → break: the hour turns here: legal ID`), and when an earlier break is too
  close, that earlier one gives way (`break → sweeper: 2 songs before the top of the hour`)
  rather than the legal ID.
- **One refusal.** `finish_card` for Prince — "1999" came back with `stop_reason: refusal`; the
  record was dropped into `picks.json.dropped` and the run continued. `enrich` now retries a
  refusal once before dropping. A dropped record stays dropped for that `picks.json` — re-run
  `discover` to try it again.
- Discovery resolves to the first search hit, which was the album/remaster version for two
  records (Prince 6:14, Mr. Mister 5:44). Not changed; a "prefer the shortest hit" rule is an
  easy follow-up.
- Not walked live: §4's bad `ELEVENLABS_KEY` run (covered by `assemble.test.ts`'s clip-error
  cases and `voice.ts` treating a failed clip as `{ error }`), and Run on `/program` with a
  Premium account (the page loads and reads `program.json`; playback is the user's check).
