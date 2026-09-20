# Jev plans; Claude writes

The slot route has one decision path: Claude proposes → Qobuz supplies recordings → Jev picks →
Jev chooses prepared headlines for breaks → Jev charts and plans → fixed identification or unified Claude prose → ElevenLabs voices → the browser schedules playback.
No substitute model, automatic selection retry, or alternate mixer plan is used on failure.

After the pick, planning.ts asks five independent Choice questions from `chart.jev.json`:
DJ finish point, ending/tail, energy, tempo, and mood. Each identifies the exact recording.
The finish point is 0, 1, 2, 3, 4, 5 seconds from song start, or beyond 5. It estimates where
the DJ should finish before the first vocal, spoken word, or defining musical hit. Zero
protects the opening; beyond 5 allows a brief overlap without claiming an exact timestamp.
These are musical estimates from catalog identity, not audio analysis.

A second request uses `mix.jev.json` to choose the delivery, given the chart, listener
request, clock and recent songs and spoken copy. Non-break options are music only, a dry
station sweeper, a station tag into the opening, and a short contextual talk-up. Zero posts
allow no overlapping speech. Contextual copy gets 3–9 words, capped at a five-second target;
shorter posts offer fixed station tags. Station tags contain only the configured name and
bypass Claude. The identical tag is unavailable immediately after its last use.

The voice starts at the slot's beginning. For an exact estimated post, playback uses the
measured clip length to start the song under the voice so it ends 150 ms before the post.
A shorter clip finishes early without padding or a delayed voice entrance. Beyond-five
plans cap actual overlap at five seconds, even for a longer clip; they display no exact cue.
Music uses eased gain changes and reaches full level by an exact post; tiny voice-edge fades
soften clip boundaries. Existing slots without the new alignment field retain their timing.

Greeting/news breaks remain on the clock, with a dry entry or closing overlap at the post.
Their budget remains 35 music words plus 25 per headline and 25 for weather, with an 8-word
lead-line cap. The legal ID stays dry. The plan and Jev's exact answers are retained in the
existing slot JSON; `finishAtMs` and `chart.postTiming` reach the player through the API.
No database migration or shared track-chart cache is required.

Claude's schema contains only words and leadLine. Its call has thinking disabled and a 2048-token
output limit. Full breaks use one script containing Jev-selected prepared
headlines, latest valid structured weather, and music copy. Jev compares the headlines and chooses
a count of zero, one, or two; code takes that many in probability order. Fixed IDs require no prose
call; a segue requires no prose or voice call. No source fetching or separate news writer runs
inside a session request. See [the prepared-content contract](prepared-content.md).

checkSlot rejects empty or over-budget copy and clock violations. The browser plays the complete
TTS take at Jev's chosen entry, ducking music for its actual length. It does not reject, truncate or
move a take because it crosses an estimated vocal cue. Target seconds guide writing; TTS timing
can vary. The estimated vocal cue remains visible on the timeline.
A break's overlap is limited to the voice remaining after its estimated dry legal ID.
A new voice take can be requested through the existing rundown control.

The existing selection JSON column also stores selection.planning, including both exact requests,
responses, probabilities, usage, durations and the resulting plan. The new generation JSON column retains prepared choices, exact writer input/output and every voice take.
Existing written slots keep their saved decisions; voice retries do not re-plan them.

## Manual checks

Run the catalog planning check (billed, four songs concurrently, no Claude/TTS/session writes):

~~~sh
op run --env-file=.env.op -- node apps/web/scripts/plan-eval.mts new-report.json
~~~

The report preserves the selected catalog recordings and all planning receipts. It does not report
accuracy: fill observedFirstVocalMs by listening to each exact recording before evaluating whether
estimated DJ finish points land before the vocal or musical hit. Include immediate vocals, opening speech/ad-libs, long intros,
instrumentals, live takes, edits and unfamiliar tracks in subsequent listening tests.

For an end-to-end test, create a labeled local show, prepare slots 1 and 2, and inspect the logged
phase durations. Startup also includes Claude proposal/search, prepared-content selection, TTS and
track download; fast Jev decisions alone do not establish fast overall preparation.

The API has returned two-decimal distributions totaling 0.99, and occasionally a declared choice
whose reported probability is slightly below another option. Validate IDs, types, ranges and total
mass within the per-entry rounding bound; consume the explicit choice without recomputing an
argmax. Keep the raw distributions for evaluation. They do not override Jev's action.

## Local verification, 2026-09-19

For `mix-3`, `pnpm check` passed (374 tests) and the production build passed. Regressions cover
the observed “Panama.” and “Adams.” failure: complete fixed title/artist copy, full numeric station
identification, a two-second minimum target, consecutive station-tag suppression, minimum contextual
copy, and fixed-copy delivery without a Claude call. No live Jev/TTS listening evaluation was run.

For `mix-2`, `pnpm check` passed (367 tests) and the production build passed. Regression cases
cover two-second talk-ups with short, immediate and unknown vocals, zero overlap, one-word stings,
delayed voice entry, duration-based copy budgets, actual-TTS playback across vocal cues, and a long
break overlap preserving the dry legal ID. No live Jev/TTS listening evaluation was run for this
revision; production listening remains the check on musical taste and real voice duration.

Earlier `mix-1` integration checks:

- Final concurrent catalog check: 4/4 completed; planning 280–471 ms, entire batch 1.154 s.
  Completion verifies the API contract, not correctness of musical timing.
- Fresh show bb19441d-b9bb-41b2-8fd8-0f78dea05662: proposal/search 22.6 s. Opening
  54.0 s, including Jev planning 407 ms, Claude prose 3.794 s, news editing 27.834 s,
  primary TTS 13.942 s, news-free TTS/storage 8.431 s. News and prose overlapped.
- Slot 2: Jev chose a segue; completed in 2.05 s with no prose/TTS. Repeated request
  preserved the selected recording and clip identity.
- Remaining manual work: listen to exact recordings and label first-vocal times; evaluate
  talk-up timing against real speech; inspect the long news/voice preparation separately.
