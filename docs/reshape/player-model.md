# Player and scrub model

Status: implemented locally. The findings below document the code before extraction.

Implementation homes:

- `apps/web/src/lib/playback/plan.ts` and `mix.ts`: pure composition, coordinate conversion and envelopes.
- `apps/web/src/lib/playback/player.ts`: transport ownership and cancellable seek transactions.
- `apps/web/src/lib/playback/browser-engine.ts`: native audio, clock observations and run lifetimes.
- `apps/web/src/components/scrub.ts` and `use-scrub.ts`: gesture model and React pointer/keyboard adapter.
- Session route `load-slot.ts`, `session-deck.ts`, and `use-deck.ts`: asset loading, lifetime wiring and subscription.

The browser engine decodes the short voice and bed into buffers scheduled on the audio clock;
the full song remains a media element. This removes the second asynchronous media start from
DJ playback. During song startup the engine holds the other lanes until native playback is
confirmed, then schedules them at the same position. React frame updates only display that position.

Run `pnpm exec playwright install chromium webkit` once, then `pnpm check`. `pnpm test` runs deterministic
unit contracts; `pnpm test:browser` exercises native audio and actual React interactions in headless
Chromium and WebKit. Windows WebKit omits Web Audio, so its local run covers gestures; Linux CI
runs the full suite in both engines. Actual iPhone lock/unlock remains device acceptance.

Reviewed local `776a8df` and the seek paths in `origin/main`. The previous playback fix is
committed locally but has not been pushed. Both versions have the conflicting seek paths below;
this review does not establish which browser event sequence produced the reported symptom.

## Findings

| Area | Evidence in current code | Consequence |
| --- | --- | --- |
| Two incompatible seeks | `use-deck.ts:547–577`: `seek` moves the mix; ordinary `seekTrack` only writes `rec.currentTime`. | Song seeks leave the voice, bed, gain schedules, and `startedAt` at their old positions. A still-pending song-start timer can overwrite the user's seek. |
| Paused seeks do not prepare the same destination | `seek` while paused updates `headMs` only; `resume` at lines 449–473 can simply call `rec.play()`. | The mixer can show the requested position while the song resumes at its previous position. Conversely, paused song seeking can be undone when `resume` rebuilds the mix from the old head. |
| No seek acknowledgement in the view | `player.tsx:173–202`: pointer release clears `drag` immediately. Both views then show the last published playback position. | During preparation/seek completion the thumb can jump back, then forward. Preview, requested position, and confirmed position are not distinguished. |
| State is owned twice | `use-deck.ts:174–180`: React owns state; callbacks read `st.current`, updated later in an effect. | Rapid commands and browser events can decide from an older phase or position. This is a race risk; the exact reported sequence still needs reproduction. |
| Cancellation does not cover the whole playback operation | Preparation has an AbortController, but play promise handlers, `onended`, and the visibility recovery timeout have no operation identity. | A late failure/completion from old work can affect the current cue. The recovery timeout is not part of the run's tracked timers. |
| Three clocks and two meanings of length | `tick` uses wall time, sources use media time, automation uses audio-context time. `Plan.lengthMs` is a short display extent. | Buffering/suspension makes the clocks disagree. Display extent has already been mistaken for playback duration in the earlier start clamp. |
| Resume guesses that the mix is finished | `resumes` checks voice end and music start; the fast path restores full music gain. | Pausing during the duck-release ramp resumes at full volume, losing the remaining envelope. |
| Gesture lifetime is incomplete | `useScrub` stores only a number, without cue identity or active pointer identity; no lost-capture handling. | Cue changes, a second touch, or lost capture have no explicit policy. A drag can outlive the cue it targeted. |
| Lock-screen position misses seeks | `media-session.ts` publishes position on cue/phase/playing changes, not seek completion. | Seeking while playing can leave the lock screen extrapolating from the old position. |
| Tests erase a relevant race | `use-deck.test.ts:11–31` replaces React and immediately updates the state ref from its setter. Its media fake also treats currentTime assignment as immediate. | Existing passing tests do not establish correctness under React scheduling or asynchronous native seeking. |

The central problem is ownership: changing position is not one operation with one owner.
Moving the same functions into separate files would preserve that problem.

## Domain

A **slot** is one playable composition: one song, an optional DJ take, and an optional looping
bed. Its **mix** places those three lanes on one slot-relative timeline and supplies their gain
envelopes. The **player** transports that composition through time. A **scrub gesture** proposes
and commits a destination to that player; it does not operate an audio element.

This is a fixed three-lane radio mixer, not a general-purpose audio workstation.

| Name | Owns | Does not own |
| --- | --- | --- |
| `PreparedSlot` | Stable identity, exact voice take, measured source durations, media references, immutable mix | Fetching, playback, React |
| `MixPlan` | Lane placements, envelopes, source offsets at a slot position, coordinate conversion | Timers, browser events, mutable playhead |
| `Player` | Listener intent, active slot, committed/confirmed position, operation identity, transitions | DOM, AudioContext, HTTP, show production |
| `BrowserAudioEngine` | Media elements, audio graph, scheduled sources, source readiness, native event handling, one playback clock | Next-slot selection, React state, news HTTP calls |
| `ScrubGesture` | Pointer ownership, preview position, pending commit, cancellation | Audio, gain scheduling, loading slots |

The existing show coordinator selects/prepares the next slot. A small loader translates the
session's wire `Cue` into `PreparedSlot` through the existing cache/API. The player emits
completion events; the coordinator decides what comes next. News acknowledgment consumes a
completed, uninterrupted voice-play event outside the engine, preserving the exact take ID.

## Time and identity

Use explicit coordinates at public boundaries:

```ts
type SeekTarget =
  | { coordinate: "slot"; ms: number }
  | { coordinate: "song"; ms: number };

type PlaybackIdentity = {
  slotId: string;       // session + slot + exact take/media revision
  operationId: number; // advances when work is replaced or invalidated
};
```

Both seek targets normalize to slot time before transport makes a decision:

```text
slot position = song start in slot + song position
song position = slot position - song start in slot, while the song is active
```

Before the song starts, its displayed zero is not evidence that it is playing. Represent lane
position as not-started, active, or ended instead of deriving that distinction from zero alone.

Keep three separate extents:

- `songDurationMs`: measured song length; clamps the song scrubber.
- `slotDurationMs`: the latest audible lane end; bounds transport.
- `previewEndMs`: the mixer viewport, covering the intro/envelopes; never bounds recovery.

Retain the useful pure functions in `plan.ts`. Rename the ambiguous length and add a pure
`mixAt(slotMs)` projection returning each lane's activity, source offset and gain, plus remaining
automation. A looping bed's offset is derived modulo its buffer duration so seeking does not
implicitly restart the bed phrase. Exact boundaries must be specified and table-tested.

The engine publishes one authoritative slot position. Before the song starts it derives that
position from the running audio-context clock. Once the song has actually started it uses the
song's observed position plus its slot offset. This handoff must be continuous and tested.
Wall time may detect a stalled device, but cannot advance musical position during a stall.
The engine reconciles or holds the other active lanes when buffering breaks synchronization.
Animation frames only read/display position; they never decide that a lane has ended.

## Player state and commands

Separate listener intent (`play` / `pause`) from observed activity:

```text
empty
loading(slot identity, intent)
ready(slot, position, paused | playing | interrupted)
seeking(slot, requested position, last confirmed position, intent, operation identity)
ended(slot, intent)
failed(slot identity, recoverable position, error)
```

Implement these as a discriminated union, avoiding unrelated nullable fields and a separate
`ended` boolean that can disagree with the phase. There is one synchronous transition function
inside a plain TypeScript player controller. React subscribes to immutable snapshots.

Commands: `load`, `play`, `pause`, `seek`, `dispose`. Keep `play` and `pause` idempotent; the UI
can translate its toggle into an explicit command. Lock-screen commands use them directly.

Inputs from the engine include prepared/seek-complete, playing, position, interruption,
recovery, failure, and natural completion. Asynchronous results carry playback identity.

Every operation that replaces playback invalidates prior work. Cancellation releases resources;
identity checks reject late results even if cancellation could not stop an underlying promise.
Native DOM events do not carry our IDs: the adapter must validate the active source/run and
actual native state before emitting a domain event. Relabelling an old event with the latest ID
is not sufficient. End events are accepted only for the active run at its confirmed end.

## One seek transaction

1. Convert the target coordinate, clamp against its real duration, and allocate an operation ID.
2. Publish `seeking` synchronously with the requested target and current listener intent.
3. Cancel old lane starts, gain schedules, pending plays, and recovery work. Silence/hold as needed.
4. Prepare every relevant lane at `mixAt(target)`, including the target's remaining gain envelopes.
5. Accept readiness/seek completion only for this operation. Start the shared schedule if intent
   is still play; otherwise leave all lanes at the target and silent.
6. Publish the confirmed destination. Subsequent observed position advances from there.

Another seek supersedes this one. Pause during preparation updates intent immediately; a late
completion cannot start playback. A cue change/disposal invalidates all old results. An
interruption preserves intent and destination; a listener's pause always survives recovery.
Seeking to the exact end becomes an explicit ended state rather than waiting indefinitely for
more playable data. A cancelled or replaced seek must never advance the show.

The initial implementation should route all seeks through this transaction. Only add an
in-place song-only optimization once the same contract passes for both paths, including the
end of bed/voice/duck-release automation.

Confirmed listening behavior: both scrubbers are views of the same mix. Rewinding into an
overlapping DJ passage replays the DJ in sync with the song, including the corresponding bed
and gain envelopes. Song scrubbing must use the same seek transaction as mixer scrubbing.

## Scrub interaction

Extract one reusable gesture model and a thin pointer/keyboard adapter for both visual sliders:

```text
idle -> dragging(pointerId, slotId, previewMs)
dragging -> pending(slotId, operationId, targetMs) on release
dragging -> idle on cancel / lost capture / cue replacement
pending -> idle on matching seek confirmation or failure
```

During dragging, playback continues and the thumb shows the preview. On release, send exactly
one seek and retain its displayed target until the matching operation confirms or fails. In
pending state a newer gesture may supersede the old request. A cue change cancels the gesture;
release cannot seek a different song. Ignore other pointers and non-primary mouse buttons.
Zero-width geometry and unknown/zero durations do not produce invalid targets. Keyboard seeks
share the same commit/acknowledgment path; repeated keys advance from the current preview or
pending target, not a stale media sample.

This model makes the visible rule precise: old telemetry cannot pull the thumb backwards while
the user's newer seek is pending. A failure exits pending and shows the actual position/error.

## Encapsulation and wiring

```text
Player view -> ScrubGesture -> Player commands -> BrowserAudioEngine
                                ^                    |
                                | typed observations |
                                +--------------------+
                                   snapshots
                                       |
                            React + Media Session
```

Place the pure plan and player under an app-level playback module, alongside the browser
adapter and their tests. Keep the reusable scrub interaction next to UI components. The
session route becomes wiring: loader, player lifecycle, show continuation and acknowledgments.
`useDeck` becomes a subscription/lifecycle adapter with no scheduling or transport decisions.
Create/dispose the engine explicitly for its owner; remove the module-global graph/listener
pair. Reuse its audio context during that owner's lifetime, with gesture unlock exposed at the
browser boundary. React remount behavior must be tested rather than left to implicit globals.

Media Session subscribes to the same snapshot and publishes position on seek confirmation as
well as start/stop/cue changes. It does not maintain another transport truth.

## Tests before switching the UI

Use the real TypeScript player with an injected fake engine. Control promise resolution and
event ordering explicitly; do not mock React to make the player work. Keep pure transition
tests separate from browser-adapter contract tests and real React interaction tests.

| Scenario | Required assertion |
| --- | --- |
| Seek song while DJ overlaps | All lane offsets and remaining gains describe the same slot position. |
| Seek song before its scheduled start | Old start callback cannot overwrite the new destination. |
| Pause, scrub either slider, play | Playback starts at the committed position for both sliders. |
| Seek A, seek B, complete A last | Only B can publish position, start audio, report errors or end the slot. |
| Seek, pause, then readiness arrives | All lanes remain silent at the target. |
| Release while seeking takes time | Thumb stays on target until matching acknowledgment; old frames cannot move it. |
| Pointer cancel/lost capture/second touch | Zero accidental commits; active pointer alone controls the gesture. |
| Cue changes during drag/load/play promise | Old work cannot seek, stop, fail, or advance the new cue. |
| Suspend during DJ, during duck release, or during song | Correct position and envelope survive recovery; manual pause survives. |
| Return 90 seconds into an eight-second preview | Song remains at 90 seconds; preview extent is irrelevant. |
| Delayed first readiness/play/seek; buffering | No schedule begins before its required readiness and no phantom wall-clock advance. |
| Exact end; duplicate/stale ended events | Completion is accepted at most once for the current operation; no accidental next cue. |
| Rapid keyboard seeks | Each nudge uses the latest requested target. |
| Seek while playing on lock screen | Position publication reflects the confirmed seek without requiring a pause. |
| Mount, unmount, remount | One owner, no orphan callbacks/sources/listeners; new owner is unaffected by old disposal. |

The fake engine should distinguish requested seek from confirmed media position, have delayed
play promises, deliver out-of-order events, and expose controlled audio/media clocks. Browser
tests then verify that the real adapter meets the same contract with short deterministic audio
fixtures. Include a real React pointer test so render timing and pointer capture remain visible.
Actual iPhone app switching and lock/unlock remain device acceptance tests; fake clocks or a
desktop browser are not proof of iOS background behavior.

## Implementation order

1. Establish failing reproductions for the two seek paths, pending-thumb behavior, and late events.
2. Extract/clarify the pure mix projection and coordinate conversions; preserve existing mix rules.
3. Build the player state transitions and cancellable seek transaction against the fake engine.
4. Encapsulate the browser graph/events behind the tested engine contract and verify native behavior.
5. Extract the scrub model, test it independently and through real React events, then connect both
   sliders to the same player seek command.
6. Replace the old hook's internals, wire Media Session/continuation, and remove obsolete paths/tests.
7. Run full repository checks and iPhone acceptance scenarios before claiming the interaction fixed.

Each step should remove an existing responsibility from the hook. Avoid introducing a generic
event bus, a plugin system for lanes, or a second transport beside the current one.
