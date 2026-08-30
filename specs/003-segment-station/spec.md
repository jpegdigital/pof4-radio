# Feature Specification: Segment Station

**Feature Branch**: `003-segment-station`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "Ok bucket's in, you have the spec let's move towards proper API routes and moving back to home / what do you think? Program route group is a sandbox to pull components from not to re-use with eventual plan to straight up delete that folder and everything should still work." — following the design conversation: the show is produced **on the fly, one segment at a time**, from the home page, with each produced segment kept forever so a past station replays without asking anything again.

## Overview

Today the home page runs a conversation-shaped show (a spoken bridge, then three or four songs, voiced as it goes), and the `/program` sandbox plays a whole hour that was produced ahead of time by hand-run stages. This feature brings the sandbox's craft — records chosen for the hour, timed talk-ups over intros, breaks over a bed with a lead line into the song, legal IDs at the top of the hour — to the **home page**, produced **live** as the listener listens.

The unit of production is the **segment**: a break (the opening, on the first segment) followed by three to five songs. The listener's request first yields the **skeleton of the hour** (which records, in what order, where the breaks fall) plus the **opening segment ready to air** — words, voice, the first song and what to do at its top. Every later segment is produced while the one before it plays, always one ahead. What is produced is **kept**: a segment's songs, words, clips and timings are stored once and never re-made, so "Resume a show" replays a past station as it was heard, and the knowledge gathered about each record (its intro length, its post, how it ends) is reused by every future station that plays it.

The `/program` route group stays as a sandbox to lift components from. Nothing on the home path may depend on it — it must be *deletable* (conceptually: the home page would build and play without it). Deleting it is not part of this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A request goes on air as a produced show (Priority: P1)

The listener types a request on the home page and presses Run. Within about a minute the DJ opens the show over the bed — naming records coming up this hour — and the first song comes in under the last line. Talk-ups land on the post where the record's intro is known; sweepers and clean segues fill the rest; a break closes the segment and opens the next; the next segment is already produced by the time it is needed.

**Why this priority**: This is the feature: the sandbox's produced sound, on the real page, live.

**Independent Test**: On a fresh home page, type a request, press Run; the opening plays with the bed, the first song starts under the lead line, the segment's remaining songs play with their treatments, and the next segment's break plays without a gap.

**Acceptance Scenarios**:

1. **Given** a fresh page and a connected Premium account, **When** the listener presses Run with a request, **Then** the rundown of the hour appears before anything plays, and the opening is heard within 60 seconds of pressing Run.
2. **Given** the opening is on air, **When** it reaches its last line, **Then** the first song is already playing under it and rises to full as the line ends.
3. **Given** a segment is playing, **When** its last song ends, **Then** the next segment's break begins without silence, and its songs were resolved and timed before that moment.
4. **Given** the hour turns during the show, **When** the segment covering that moment is produced, **Then** the break at the turn carries the station's legal ID.
5. **Given** any production step fails for one element (a card cannot be made, a clip cannot be voiced), **When** the segment is played, **Then** that element takes its plain, safe form (a clean segue, the song alone) and the show never stops.

---

### User Story 2 - A past station replays without being re-made (Priority: P2)

Everything produced is kept with the station. The "Resume a show" list offers past stations; picking one loads every segment as it was produced — the same songs, the same words, the same clips and timings — and Run plays it from the start (or from any tapped row) without asking the planner, the enricher or the voice for anything. Continuing past the last kept segment produces a new one that follows from it.

**Why this priority**: Stable, replayable history is what makes a station an object worth keeping — and what makes production cost paid once.

**Independent Test**: Play a station for two segments; reload; pick it from the list; Run. Nothing is produced, nothing is billed, and the two segments play as before. Let it run past the second segment; a third is produced and appended.

**Acceptance Scenarios**:

1. **Given** a station with kept segments, **When** it is picked and Run, **Then** playback uses the kept segments and no production request is made for them.
2. **Given** a kept station, **When** the listener taps any row in the rundown, **Then** playback jumps there with the kept clip and timing for that row.
3. **Given** a kept station played to its end, **When** playback continues, **Then** a new segment is produced that follows from the last kept one (the break bridges from it; records already played are not repeated).

---

### User Story 3 - What is learned about a record is reused (Priority: P2)

A record's card — intro length, whether the post is sure, how it ends, energy, talking points — belongs to the record, not the station. The first station to play a record pays for its card; every later station that plays it reuses the card. A record that cannot be described is left out of the set rather than failing the segment.

**Why this priority**: Enrichment is the slowest, most failure-prone step and the only one whose cost is a function of the catalogue; reuse is how a cold start gets shorter over time.

**Independent Test**: Play a station that includes a given record; start a second station that includes it; the second does not enrich it. Force an enrichment to fail; the segment completes without that record.

**Acceptance Scenarios**:

1. **Given** a record with a card, **When** a new station's segment includes it, **Then** the card is reused and no enrichment is requested.
2. **Given** a record whose card cannot be made, **When** the segment is produced, **Then** the record is dropped, the omission is recorded on the segment, and the segment is still complete.
3. **Given** a card that is later corrected, **When** an already-kept segment that used the old card is replayed, **Then** it plays with the timings it was produced with (kept segments are immutable).

---

### User Story 4 - The home page is the control room and the player in one (Priority: P3)

The home page blends what the sandbox's rundown and the current cue sheet each show today: the player up top, and below it the whole show as produced — every segment, every row with its treatment, the DJ's words for anything spoken, the timings that were chosen (where the talk-up lands, when the bed comes in, where the lead line starts under the song), the card the row was timed from, and a badge for any fallback with its reason. It is read-only: nothing on the page hand-edits or re-produces a kept segment. While the opening is being produced the page is not a spinner: the moment the hour's records are known they appear as the rundown, and rows fill in as their cards, words and timings land. A listener who resumes a station sees the whole kept show at once.

**Why this priority**: This *is* the app now — the page where the show is heard is the page where it is understood. Turns the cold start from a wait into part of the show and retires the sandbox's separate views.

**Independent Test**: Press Run and watch: records appear before the opening plays; words, timings and badges appear as segments land; the on-air row is marked and taps rewind; nothing on the page changes a kept segment.

**Acceptance Scenarios**:

1. **Given** Run was just pressed, **When** the hour's records are known, **Then** they are listed before the opening is voiced.
2. **Given** a segment has been produced, **When** the listener opens any of its rows, **Then** it shows the treatment, the words (if spoken), the timings chosen, the card's relevant facts, and any fallback with its reason.
3. **Given** a kept station, **When** it is loaded, **Then** every segment's rows show the same detail as when they were produced.
4. **Given** a produced show, **When** the home path is inspected, **Then** nothing it imports or fetches lives under the `/program` route group (it could be deleted later without effect).

---

### Edge Cases

- The listener changes the request mid-show: the next segment to be produced follows the new request; kept segments are untouched; the hour's remaining skeleton is re-planned from the change point.
- The next segment is not ready when the current one ends (production slow or failed): the show plays a sweeper or a clean segue into a resolved song and keeps trying; if nothing is resolved, playback waits with the rundown showing "producing…" rather than erroring.
- Two tabs run the same station: only one produces; the other is told the station is busy and can still play kept segments.
- A record resolves to an unexpected version (album cut, remaster): the shortest matching version is preferred; the card is keyed to the version actually played.
- The hour turns inside a song: the legal ID goes on the first break after the turn, never mid-song.
- The voice service is down: every talk element falls back to its wordless form, the segment is kept with the fallbacks recorded, and the show goes on.
- The bed is missing: breaks play dry (voice alone), recorded as a fallback.
- Playback of a kept station on a device without Premium: the rundown loads and shows; Run is gated as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The home page MUST take a request and, on Run, produce and play a segment-based show without any hand-run stage.
- **FR-002**: The first production step MUST return the hour's skeleton (records in order, where breaks fall, which carries the legal ID) together with the opening segment ready to air: the DJ's words, their voice, the first song and its treatment and timing.
- **FR-003**: The opening MUST be heard within 60 seconds of Run on a cold start (no cards known).
- **FR-004**: Every later segment MUST be produced while the previous segment plays, so it is complete before it is needed; production of segment N+1 starts no later than the first song of segment N.
- **FR-005**: A segment MUST consist of one break (the opening on the first segment) followed by three to five songs, each song with exactly one treatment at its top (talk-up, sweeper, clean segue) and, where words are spoken, their voice and timing.
- **FR-006**: Timings for talk-ups, bed entry and the lead line into the first song MUST be computed at production from the clip and the record's card, never measured or searched for in the browser.
- **FR-007**: The rules the log obeys today (first slot is a break; a talk-up needs a long enough known intro; the break at the hour's turn carries the legal ID; breaks are spaced three to four songs apart, the legal ID winning) MUST hold for segments produced live.
- **FR-008**: Every produced segment MUST be kept: songs, words, clips, timings and any fallbacks, bound to its station, immutable once kept.
- **FR-009**: The "Resume a show" list MUST offer stations with kept segments; picking one MUST load all of them, and playing them MUST make no production request.
- **FR-010**: Continuing a kept station past its last segment MUST produce a new segment that follows from it.
- **FR-011**: A record's card MUST be kept per record, independent of any station, and reused by every later segment that plays the record.
- **FR-012**: A record that cannot be described MUST be dropped from the segment with the reason recorded; the segment MUST still complete.
- **FR-013**: When any input a good timing needs is missing or does not add up, the element MUST take the next plain form and record what fell back and why; no fallback may stop the show.
- **FR-014**: The rundown MUST appear as soon as the hour's records are known and fill in as segments are produced; each row MUST expose its treatment, its words where spoken, the timings chosen, the card facts it was timed from, and any fallback with its reason — read-only, on the home page, alongside the player.
- **FR-015**: Nothing on the home path MAY depend on the `/program` route group — no imports, no routes, no files under it — so that the folder is deletable at any later time. Deleting it is out of scope here.
- **FR-016**: The voice clips MUST be stored outside the application's own file tree, addressed per segment and element, and served to the browser for playback.
- **FR-017**: Only one producer per station at a time; a concurrent production request for the same station MUST be refused and reported, not run twice.
- **FR-018**: The planner's memory of a station (what was said, what was played) MUST carry across segments so each break bridges from the last and records are not repeated within the hour.

### Key Entities *(include if feature involves data)*

- **Station**: one listener's show — the request in force, the planner's memory, and its kept segments in order. Offered in "Resume a show".
- **Skeleton**: the hour's plan at production time — records in order, where breaks fall, which break carries the legal ID. Re-planned from the change point if the request changes.
- **Segment**: the kept unit — its sequence number, its break (words, clip, timings), its songs each with a treatment and, where spoken, words, clip and timings; the fallbacks taken; the planner's memory as of its production. Immutable once kept.
- **Card**: what is known about one record, keyed to the version played — intro length and whether the post is sure, how it ends, energy, talking points. Shared by all stations; may be corrected, without changing kept segments.
- **Clip**: one produced voice element — the audio and its measured length and marks (bed-in point, lead-line start). Belongs to exactly one segment element.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a cold start the opening is heard within 60 seconds of Run in 9 of 10 attempts; with all of the hour's cards already known, within 30 seconds.
- **SC-002**: Across a one-hour listen, no gap of silence longer than one second occurs between elements attributable to production (a segment not ready).
- **SC-003**: Replaying a kept station produces zero planner, enrichment or voice requests.
- **SC-004**: A record played by a previous station is never enriched again; the second station to play a set of already-carded records produces its opening at least 40% faster than the first did.
- **SC-005**: Every element of every kept segment has a treatment, and every non-segue element has words and a clip or a recorded fallback saying why not; no element is ever silent by omission.
- **SC-006**: A dependency check shows zero references from the home path into the `/program` route group (the folder is deletable; this feature does not delete it).
- **SC-007**: Where a record's card says its intro is sure, the talk-up ends within 400 ms before the post in 8 of 10 cases, as heard.

## Assumptions

- The show is **continuous**: segments keep being produced while the listener listens; the hour's skeleton is a planning horizon, and clock rules (legal ID at the turn) apply to whatever hour the show is in. "An hour" is not a stop.
- **Decided**: the current home-page show (the conversation-shaped bridge-plus-tracks flow) is **replaced** by the segment show — this is the app now. The station history it kept is the basis for the new one, extended rather than duplicated; the old flow is not kept reachable anywhere.
- The bed remains a single hand-supplied asset; produced sweepers are optional and used only when present.
- The Spotify account, playback device, Premium gate and Guard stay exactly as they are; the browser remains the playback device and the state machine; the server stays stateless functions.
- Where the listener runs is where production is requested from; nothing is produced for a station nobody is listening to.
- The prompts that shape discovery, cards, the log and the script move to the settings the control room edits, like the station's prompts today; the rules the log obeys stay in code.
- **Decided**: the home page is the blended control view and player (User Story 4) — read-only. The maker's desk (hand-run stages, hand-edited files, re-running from a stage) stays in the sandbox and is **not** carried over; kept segments are never hand-edited or re-produced from the page.
- No new user-facing surface beyond the home page; the control room (`/settings`) gains only what the prompts need.
