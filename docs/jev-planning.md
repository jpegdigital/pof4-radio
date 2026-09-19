# Jev plans; Claude writes

The slot route has one decision path: Claude proposes → Qobuz supplies recordings → Jev picks →
Jev chooses prepared headlines for breaks → Jev charts and plans → fixed identification or unified Claude prose → ElevenLabs voices → the browser schedules playback.
No substitute model, automatic selection retry, or alternate mixer plan is used on failure.

After the pick, planning.ts asks five independent Choice questions in one TypeSafe request:
intro lower bound, ending/tail, energy, tempo, mood. Each question identifies the exact recording.
Intro bins are 0, 1, 5, 10, 20, 30, 45, 60, 90, 120 seconds, plus instrumental and unknown.
These are knowledge-based estimates from catalog identity, not audio analysis. Confidence is saved,
not treated as proof of a vocal timestamp. Vocal timing is musical guidance, not overlap eligibility.

The second request supplies that chart and its probability distributions, the prompt, the clock's break decision, and recent slots.
For non-breaks, Jev chooses a complete spoken format and entry at 0/1/2/3 seconds:

- Song and artist: the full phrase, such as “Panama, Van Halen.”, assembled from the proposal.
- Station identification: the complete configured on-air name, as an occasional branding accent.
  The identical station tag is unavailable if it was the immediately preceding slot's entire copy.
- Context: one complete, specific thought, 6–14 words with an approximately eight-second target.
- Segue or a dry station ID when overlap would not fit naturally or add anything.

Fixed IDs are assembled before estimating their natural duration (minimum two seconds), including
extra allowance for numbers/frequencies and long names. They are never truncated to meet a small
word cap and bypass Claude entirely. Longer IDs get more time; no ID over the existing 35-word/
20-second short-copy envelope is offered. The contextual format goes to Claude, and `checkSlot`
rejects fragments below its minimum. Recent spoken copy is supplied to Jev for variety.

The prompt favors worthwhile DJ voice over music, not the shortest possible utterance. It asks
Jev to preserve striking opening hits and sustained vocals and choose a segue when no complete
phrase fits. There is no ten-second intro minimum or hard first-vocal cutoff; a brief intentional
overlap can still work. A break retains zero or 1–20 seconds of overlap, a 35-word music budget plus 25 words per selected headline and 25 for available weather, and
an 8-word lead-line cap. `copyStyle`, `fixedWords`, `wordsMin` and `talkOverMs` are retained in the
planning receipt and writer brief; the treatment describes the format and duration.
The house still owns break cadence, legal IDs, gains, fades and Web Audio scheduling.

Claude's schema contains only words and leadLine. Its call has thinking disabled and a 2048-token
output limit. Full breaks use one script containing Jev-selected prepared
headlines, latest valid structured weather, and music copy. Jev explicitly includes/omits/rejects
repeats; code orders includes by probability and caps them at three. Fixed IDs require no prose
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
intro lower bounds are conservative. Include immediate vocals, opening speech/ad-libs, long intros,
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
