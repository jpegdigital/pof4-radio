# Feature Specification: Client-Driven Station Loop

**Feature Branch**: `001-client-driven-station`

**Created**: 2026-08-28

**Status**: Draft

**Input**: User description: "Client-driven radio station loop, no worker. Remove the pg-boss worker, queue, and radio-worker service; the browser is the state machine and the server is stateless functions. A segment is {talk, tracks[3-4]} — talk is a single spoken bridge: a pure intro on cold start, otherwise a continuation from the previous segment. Claude receives the entire previous segment and writes a natural continuation whether the listener played or skipped songs. Client states: idle → planning → talk → tracks → talk of next segment. Absolute Run/Stop buttons control the loop; separate play/pause for the current song; skip talk; prev/next within the mini playlist. Request N+1 the moment N's talk starts; hold its talk audio in memory. One ongoing DJ conversation stored server-side with prompt caching and trimmed tool chatter. Streamed text-to-speech with client-side voice settings; only the TTS key lives on the server. Segments table becomes a history log. Spotify playback stays in the tab."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run the station (Priority: P1)

The listener types what they're in the mood for and presses **Run**. The station plays a spoken intro
from the DJ, then three to four songs, then the DJ talks again — bridging from what just played into
the next block — and the loop continues indefinitely. The listener never has to press anything again.
There is exactly one wait, at cold start, while the first segment is being planned; from then on the next
segment is always prepared while the current one plays.

**Why this priority**: This *is* the product. Everything else is control over this loop.

**Independent Test**: Enter a prompt, press Run, and let it play through two full segments hands-off.
The second segment's talk must refer back to the first and start without a gap the listener would
notice as "waiting".

**Acceptance Scenarios**:

1. **Given** the station is idle with a prompt entered, **When** the listener presses Run, **Then** the
   station shows it is planning, and when the segment arrives the DJ's intro plays followed by its songs.
2. **Given** segment N's talk has just started, **When** segment N+1 is prepared in the background,
   **Then** N+1's talk is ready to play the instant N's last song ends, with no additional planning wait.
3. **Given** the station is on its second or later segment, **When** the talk plays, **Then** it is a
   bridge: it refers to the previous block and leads into the next, never a fresh "welcome" intro.
4. **Given** the DJ is planning and the listener runs out of buffered songs, **When** the last song ends,
   **Then** the station visibly shows it is waiting on the DJ and continues automatically when the
   segment arrives.

---

### User Story 2 - Stop and resume (Priority: P1)

**Stop** halts the loop absolutely: nothing new plays, nothing new is requested. **Run** resumes from
where it left off — the segment that was already prepared is still there, and the DJ still remembers
everything that has played, so the continuation is seamless rather than a restart.

**Why this priority**: Without a real Stop the station is a runaway; without memory-preserving resume,
every pause becomes a cold start.

**Independent Test**: Run, wait until the next segment is buffered, press Stop mid-song, wait, press
Run. The buffered segment is used (no planning wait) and its talk still references the block that was
playing when stopped.

**Acceptance Scenarios**:

1. **Given** a song is playing, **When** the listener presses Stop, **Then** audio stops, no further
   segment is requested, and the station shows it is stopped.
2. **Given** the station was stopped with a next segment already buffered, **When** the listener presses
   Run, **Then** playback continues without a planning wait.
3. **Given** the station was stopped, **When** the listener presses Run, **Then** the DJ's next talk
   still builds on the conversation so far (history is not lost by stopping).
4. **Given** the page is reloaded, **When** the listener presses Run, **Then** it is a fresh show: a new
   station, an opening talk, empty history. (Memory is kept across Stop/Run, not across page loads.)

---

### User Story 3 - Transport controls inside a segment (Priority: P2)

While the loop runs, the listener has ordinary player controls that never interfere with the loop
itself: pause/resume the current song, skip the DJ talk straight to the first song, move forward and
backward within the current segment's songs, and skip past the last song into the next segment.

**Why this priority**: Makes the station listenable day to day; secondary to the loop working at all.

**Independent Test**: During a segment, exercise each control and confirm the loop state stays
correct — pausing a song does not stop the station, skipping talk starts song one, prev/next stay
within the current block, and "next" past the last song moves to the next segment's talk (or the
planning state if it isn't ready yet).

**Acceptance Scenarios**:

1. **Given** the DJ talk is playing, **When** the listener presses skip, **Then** the talk stops and the
   segment's first song starts.
2. **Given** a song is playing, **When** the listener presses pause, **Then** the song pauses and the
   station remains running (the next segment is still prepared in the background); pressing play resumes.
3. **Given** song 2 of 4 is playing, **When** the listener presses next / previous, **Then** song 3 /
   song 1 plays; previous on song 1 restarts song 1.
4. **Given** the last song is playing, **When** the listener presses next, **Then** the next segment's
   talk plays if it is ready, otherwise the station shows planning and continues when it arrives.
5. **Given** the listener skipped most of a segment, **When** the next talk plays, **Then** it still
   sounds natural — the DJ was told the whole previous segment and writes a continuation that reads
   correctly whether or not every song was heard.

---

### User Story 4 - Choose the DJ's voice (Priority: P3)

The listener picks the voice (and voice model/settings) from a settings panel in the page. The choice
is remembered on that browser and applies to the next talk that is generated. Changing the voice does
not require a deploy or any server configuration.

**Why this priority**: Nice to have; the station works with a default voice.

**Independent Test**: Open settings, change the voice, confirm the next generated talk uses it and the
choice persists across a page reload.

**Acceptance Scenarios**:

1. **Given** the settings panel, **When** the listener selects a different voice and closes it,
   **Then** the next talk that is generated is spoken in that voice.
2. **Given** a voice was chosen, **When** the page is reloaded, **Then** the same voice is still selected.

---

### Edge Cases

- The DJ fails to produce a segment (model error, no results, declined request): the station shows the
  error, stays running, and retries once automatically; after a second failure it stops and tells the
  listener.
- Voice generation fails or is slow: the talk is skipped for that segment (songs still play) and the
  error is shown; the loop continues.
- The Spotify device disconnects or the account is not Premium: the station stops with a clear message;
  Run is disabled until the device is back.
- The listener changes the prompt mid-session: takes effect from the next segment requested; the DJ is
  told the mood changed and keeps the conversation.
- Two tabs run the same station: not supported — the second tab warns and does not start.
- Very long sessions: the DJ's memory is capped to the most recent segments so cost and latency stay
  flat; older history is dropped silently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A segment MUST consist of one spoken *talk* and 3–4 songs, in that order. There is no
  separate outro; the next segment's talk serves as the bridge.
- **FR-002**: The first talk of a station MUST be a pure intro; every later talk MUST be a continuation
  written with the entire previous segment (its talk and its songs) as context.
- **FR-003**: The DJ MUST NOT be told which songs were played or skipped; it MUST write a continuation
  that reads naturally either way.
- **FR-004**: The station MUST expose the states: idle, planning, talk, tracks (with the current song
  index), and stopped; the visible UI MUST reflect the current state at all times.
- **FR-005**: The station MUST request the next segment the moment the current segment's talk starts,
  and MUST hold at most one prepared segment ahead.
- **FR-006**: The prepared segment's talk audio MUST be fetched as soon as the segment arrives and held
  ready, so that reaching it never waits on audio generation.
- **FR-007**: Run and Stop MUST be absolute loop controls: Stop halts audio and prevents any new
  request; it MUST NOT discard the prepared segment or the DJ's conversation.
- **FR-008**: Play/pause of the current song MUST be independent of Run/Stop.
- **FR-009**: The listener MUST be able to skip the talk to the first song, move to the previous/next
  song within the segment, and skip past the last song to the next segment (or to planning).
- **FR-010**: The DJ MUST hold one ongoing conversation per station, persisted on the server, so that
  memory survives Stop/Run. A page load starts a new station (fresh show).
- **FR-011**: The conversation MUST be kept lean: after a segment is accepted, that turn's search
  activity is reduced to the final decision; history is capped at roughly the last 20 segments.
- **FR-012**: The conversation prefix MUST be cached so that each new segment request pays only for the
  new turn; the cache lifetime MUST cover the gap between segments (≈15 minutes of music).
- **FR-013**: Talk audio MUST be streamed to the browser as it is generated, and Spotify's volume MUST
  be ducked while the talk plays.
- **FR-014**: Voice identity, voice model, and voice settings MUST be chosen in the client, remembered
  per browser, and sent with each talk request; the only voice-related secret on the server is the
  provider key.
- **FR-015**: Song playback MUST remain in the browser tab via the Spotify device the tab creates.
- **FR-016**: There MUST be no background process: with no tab running, nothing is planned or generated.
  The worker service, queue, and the voice-id and clips-bucket infrastructure are removed.
- **FR-017**: Every segment produced MUST be recorded in a history log (prompt, talk, songs, when) for
  display and for the DJ's own memory.

### Key Entities

- **Station**: one listener's ongoing show — its current prompt, voice settings snapshot, and the DJ's
  conversation so far. Survives reloads. One per browser session for now.
- **Segment**: a talk plus an ordered list of 3–4 songs, belonging to a station, with a creation time.
  The history log is the list of segments.
- **Song**: a Spotify track reference (id, name, artists, album, duration) as picked by the DJ.
- **Voice settings**: voice id, model, and tuning values; lives in the browser, sent per request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After pressing Run, the listener hears the first talk within 60 seconds (cold start).
- **SC-002**: Between segments, the gap from the last song ending to the next talk starting is under
  1 second in 95% of transitions when the listener did not skip; when skipping through a whole segment,
  the wait is at most the remaining planning time and is clearly indicated.
- **SC-003**: Stop takes effect within 1 second and no new segment is requested after it.
- **SC-004**: Resuming a stopped station with a buffered segment starts playback within 1 second.
- **SC-005**: Every talk after the first refers to the preceding block (verified by listening over a
  10-segment session; zero "welcome"-style restarts).
- **SC-006**: Per-segment DJ cost stays flat over a 20-segment session (no growth beyond the last
  segment's own work), demonstrating the cached, trimmed conversation.
- **SC-007**: A voice change made in the page applies to the very next talk with no deploy.

## Assumptions

- Single private listener behind the existing gate; one station per browser is enough. No multi-user
  concerns, no user table.
- The "cold start" wait is acceptable; there is no pre-generation while nobody is listening, by design.
- One prepared segment ahead is enough buffer; the DJ typically answers in 20–60 seconds while a segment
  plays for 12–18 minutes.
- Talk audio is held in memory for the session only; nothing is stored in a bucket. Replaying old
  segments is out of scope.
- The voice provider's expressive model is used over its streaming endpoint; per-request voice choice
  is supported by that endpoint. Exact model naming is confirmed during planning against current docs.
- The existing Spotify connection (one connected Premium account, token refresh on the server) is
  reused unchanged.
- Existing segment rows from the prototype may be wiped; there is no migration of old data.
