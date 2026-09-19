# Jev plans; Claude writes

The slot route has one decision path: Claude proposes → Qobuz supplies recordings → Jev picks →
Jev charts and plans → Claude writes prose → ElevenLabs voices → the browser schedules playback.
No substitute model, automatic selection retry, or alternate mixer plan is used on failure.

After the pick, planning.ts asks five independent Choice questions in one TypeSafe request:
intro lower bound, ending/tail, energy, tempo, mood. Each question identifies the exact recording.
Intro bins are 0, 1, 5, 10, 20, 30, 45, 60, 90, 120 seconds, plus instrumental and unknown.
These are knowledge-based estimates from catalog identity, not audio analysis. Confidence is saved,
not treated as proof of a vocal timestamp. Unknown intro timing has no overlap actions available.

The second request supplies that chart and its probability distributions, the prompt, the clock's break decision, and recent slots.
Jev chooses one executable action: break with dry entry or 1/3/5-second overlap; segue; dry sweeper;
or talk-up starting at 0/1/3 seconds. Code builds only actions that fit the estimated intro with
2 seconds of margin. Spoken copy budgets use 1.8 words/second, capped at 35 words; break lead lines
have a separate 8-word cap. The model chooses; code calculates milliseconds and word budgets.
The house still owns break cadence, legal IDs, gains, fades and Web Audio scheduling.

Claude's schema contains only words and leadLine. Its call has thinking disabled and a 2048-token
output limit. News editing and music copy run concurrently; copy always leaves room for news when
news is enabled. A segue requires no prose or voice call. The existing evidence-checked news editor
is unchanged, including its omission/expiry rules; those are separate from mixer planning.

checkSlot rejects empty or over-budget copy and clock violations. The browser checks actual TTS
length against the planned talk-up window and fails instead of moving the voice or knowingly
playing past that window. This cannot protect against an incorrect estimated vocal timestamp.
A new voice take can be requested through the existing rundown control.

The existing selection JSON column also stores selection.planning, including both exact requests,
responses, probabilities, usage, durations and the resulting plan. No new schema migration is needed.
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
phase durations. Startup also includes Claude proposal/search, news discovery/editing, TTS and
track download; fast Jev decisions alone do not establish fast overall preparation.

The API has returned two-decimal distributions totaling 0.99, and occasionally a declared choice
whose reported probability is slightly below another option. Validate IDs, types, ranges and total
mass within the per-entry rounding bound; consume the explicit choice without recomputing an
argmax. Keep the raw distributions for evaluation. They do not override Jev's action.

## Local verification, 2026-09-19

- Final concurrent catalog check: 4/4 completed; planning 280–471 ms, entire batch 1.154 s.
  Completion verifies the API contract, not correctness of musical timing.
- Fresh show bb19441d-b9bb-41b2-8fd8-0f78dea05662: proposal/search 22.6 s. Opening
  54.0 s, including Jev planning 407 ms, Claude prose 3.794 s, news editing 27.834 s,
  primary TTS 13.942 s, news-free TTS/storage 8.431 s. News and prose overlapped.
- Slot 2: Jev chose a segue; completed in 2.05 s with no prose/TTS. Repeated request
  preserved the selected recording and clip identity.
- Remaining manual work: listen to exact recordings and label first-vocal times; evaluate
  talk-up timing against real speech; inspect the long news/voice preparation separately.
