# Feature Specification: Slot-First Show

**Feature Branch**: `004-slot-first`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "Let's implement this refactor please @docs/slot-first.md @docs/domain.html" — the slot-first design decided 2026-09-04: the show becomes a flat list of slots produced breadth-first, one slot at a time, so the first song plays after the least possible work and everything else is made while it plays.

## Overview

Today a listener types an ask and waits for a whole segment to be produced in depth: a playlist proposed, looked up and composed; a description made for every record; the whole segment's program written; and only then the first clip voiced. The first sound arrives after four model calls in series, and most of that work was not needed to start the first song.

This feature turns production around. The show is a list of **slots**, each one clip over one track, and nothing else. The station fills the list a few songs at a time (a **fill**: the proposer names the next several songs in order and the catalog looks each one up), then **writes** one slot at a time just ahead of play (one call picks the version, charts the track, writes the copy and sets the timing, and the clip is voiced in the same request). The track is pulled the moment its version is known, alongside the voicing. The browser runs the loop — ask for the next slot, play it, ask for the one after while this one plays, refill when the unwritten slots run low — and the server decides what each slot is from the clock and what is already on record. Segments, cards, the playlist as a thing of its own, and the split between writing and voicing all go away. The listener hears the first song after two model calls instead of four, and never waits again for as long as they care to listen.

The domain model this lands on is `docs/domain.html`; the reasoning is `docs/slot-first.md`. Both were decided before this spec and this spec does not reopen them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The first song starts sooner (Priority: P1)

A listener types an ask and presses go. The station proposes the opening run of songs, looks them up, writes and voices the intro break over the first one, and starts playing — with no description step, no compose step and no whole-segment program standing between the ask and the first sound. The first record is fetched while the intro is being voiced, so it is ready when the voice needs it.

**Why this priority**: This is the point of the refactor: the least work that makes the first song playable, then play it.

**Independent Test**: On a fresh session, press go with an ask; the intro break plays and the first record comes in under its last line. Count the model calls before first sound: exactly two (one fill, one slot write).

**Acceptance Scenarios**:

1. **Given** a new session with an ask, **When** the browser asks for the first fill, **Then** the show gains a run of proposed slots in the proposer's order, each carrying the versions the catalog found, and songs the catalog could not find are absent without leaving a gap in the numbering.
2. **Given** slot 1 is proposed, **When** the browser asks for slot 1, **Then** the response carries the pick, the chart, the copy, the timing and the clip together, and slot 1 is a break with the station's legal ID when the hour calls for it.
3. **Given** slot 1's response has landed, **When** the browser fires the pull for its track, **Then** the track is fetched (or returned at once if already held) without waiting on the session and without blocking the next slot write.
4. **Given** slot 1 is voiced and its track is held, **When** the deck loads it, **Then** the intro plays over the bed and the record starts under the lead line at the writer's timing, exactly as today's break plays.
5. **Given** a listener reloads mid-session, **When** the page fetches the snapshot, **Then** the loop resumes at the same slot with nothing re-made.

---

### User Story 2 - The show never waits again (Priority: P1)

While slot *k* plays, the browser asks for slot *k+1*, which is written, voiced and pulled before slot *k* ends. When the count of proposed-but-unwritten slots drops to the low-water mark, the browser asks for another fill, and the proposer is told what has played and what is pending so it never repeats a song. Every so many slots the server makes the slot a break, without the browser having to know or say so.

**Why this priority**: Breadth-first only pays if the next slot is always ready; the refill and the clock make the show run as long as the listener likes.

**Independent Test**: Start a session and let it play through more slots than one fill provides. Every slot transition is gapless, a break falls at slot 1 and at the configured interval after, and no song title appears twice.

**Acceptance Scenarios**:

1. **Given** slot *k* is on air and slot *k+1* is proposed, **When** the browser asks for slot *k+1*, **Then** it is written and voiced in one request and its track pull begins on the response, all before slot *k*'s record ends.
2. **Given** the unwritten slots have dropped to the low-water mark, **When** the browser asks for a fill, **Then** new slots are appended after the last one, numbered in sequence, and none repeats a title already played or pending.
3. **Given** the clock says a break falls at slot *n*, **When** slot *n* is written, **Then** it is a break regardless of what the browser said and regardless of the writer's preference; the weather and the headlines are in the writer's brief only for breaks.
4. **Given** two producers ask for the same session's fill or slot at once, **When** the second arrives while the first holds the session, **Then** the second is refused with a conflict and nothing is produced twice.
5. **Given** a slot is already written when asked for again, **When** the request carries no "again" flag, **Then** the existing slot is returned unchanged; with the flag, only the voicing is redone under a new clip key and the copy stays as written.

---

### User Story 3 - The rundown shows what is coming (Priority: P2)

The listener sees the show as one list: what has played, what is on air, what is written and waiting, and what is only proposed so far. A proposed slot shows its title and artist as "coming up"; a written slot shows the picked version's tags and its words; a voiced slot is playable once its track is held. Rows and the transport still pick the slot.

**Why this priority**: The show is now a flat list and the listener should see it that way; it is also how a reload lands in the right place.

**Independent Test**: Open a session mid-show; the rundown lists every slot in order with the right status for each, and clicking a written-and-held slot plays it.

**Acceptance Scenarios**:

1. **Given** a session with proposed, written and voiced slots, **When** the snapshot is fetched, **Then** every slot appears in sequence with its status derived from what is present — proposed, written or voiced — and each written slot says whether its track is held.
2. **Given** a proposed slot, **When** it is shown in the rundown, **Then** it reads as "coming up" with the proposer's title and artist and nothing more.
3. **Given** a written slot, **When** it is shown, **Then** its title, artists, album and art come from the picked version, not from the proposal.

---

### User Story 4 - The station owner sets the clock (Priority: P3)

The station owner sets, in the control room, how often a break falls, how many songs a fill adds, and how few unwritten slots trigger the next fill. The browser and the listener never choose these; the server reads them per request.

**Why this priority**: The clock is a station setting, not a listener knob; it must exist for the show to run but its defaults carry the first sessions.

**Independent Test**: Change the break interval in the control room, start a session, and observe that breaks fall at the new interval; change the fill count and observe that a fill adds that many slots.

**Acceptance Scenarios**:

1. **Given** the clock settings are absent, **When** a session is produced, **Then** the request fails loudly rather than guessing.
2. **Given** the break interval is *k*, **When** the show runs, **Then** breaks fall at slots 1, 1+*k*, 1+2*k*, …
3. **Given** the fill count is *f*, **When** a fill runs, **Then** it appends up to *f* slots and the proposer was asked for a couple more than *f* to absorb misses.

---

### User Story 5 - The old world goes away cleanly (Priority: P3)

The segment table, the card table, the compose step, the separate program and audio rungs, and the first build's unused tables are removed, along with the code that served them. The API and data model documents describe the new shape only. Sessions produced under the old model are wiped, since they cannot play under the new one; tracks already pulled stay, since they are the library's.

**Why this priority**: The refactor is not done while both shapes exist; less code is one of the things it buys.

**Independent Test**: The schema diff applies cleanly; the pre-push gate passes; a search for the retired words (record, song, card, candidate, playlist, segment, program) in the app's source finds only prose in history documents.

**Acceptance Scenarios**:

1. **Given** the schema is applied, **When** the tables are listed, **Then** session, session_slot, track and settings are what remains of the show's tables.
2. **Given** the old sessions are cleared, **When** the home page lists past shows, **Then** only sessions that can play under the new model appear.
3. **Given** a track pulled under the old model, **When** a new session picks it, **Then** it is returned at once as held and is not fetched again.

---

### Edge Cases

- A fill where the catalog finds none of the proposed songs: the fill appends nothing, reports why, and the browser surfaces the failure rather than looping silently.
- A fill whose proposer names a song already played or pending: the duplicate is dropped before lookup and the show carries on with the rest.
- The writer picks a version that is not among the slot's hits: the write is rejected and retried once, then fails loudly; nothing lands on the slot.
- The writer is not sure of the ramp: the house rules do not let the voice chase the post; the kind steps down and the step is recorded as the slot's fallback.
- A break falls on a slot the writer would have made a segue: the clock wins and the slot is a break.
- The writer refuses or returns nothing usable for a slot: retried once, then the slot becomes a segue with no clip, so the show goes on.
- The voicing fails after the write landed: the write is kept, the slot is written-not-voiced, and asking for the slot again voices it without rewriting.
- The pull fails: the slot stays voiced; the deck cannot play it until the pull is retried, and the rundown says the track is not held.
- The browser asks for slot *n* before slot *n* is proposed: the server refuses with a clear error, and the browser fills first.
- The browser asks for a fill while unwritten slots are still above the low-water mark: the fill still runs (the server does not police the mark), so the browser must not ask early.
- The hour turns between slots: the next break carries the legal ID; slots between breaks do not.
- A chart of the same track from another session exists: it is offered to the writer as a note and never written back; the writer's own chart lands on this slot.
- The tags on a written slot come from the hit, not from the track table, so a written slot reads correctly before its track is held.

## Requirements *(mandatory)*

### Functional Requirements

**The show**

- **FR-001**: A session's show MUST be a single ordered list of slots numbered from 1 with no gaps, each slot being one clip over one track; there MUST be no segment or playlist entity.
- **FR-002**: Slot 1 MUST be a break, and every `breakEvery` slots after it (1, 1+*k*, 1+2*k*, …) MUST be a break; the server decides this from the slot number and the clock settings, never the browser.
- **FR-003**: Between breaks the writer MUST choose the slot's kind from break, talkup, sweeper and segue, subject to the house rules stepping a kind down and recording why.
- **FR-004**: A slot's status MUST be derived from which of its fields are present — proposed (no pick), written (pick, no voicing), voiced (voicing stamped) — and never stored.

**The fill**

- **FR-005**: A fill MUST ask the proposer for the next `fill` songs in order, plus a small margin for misses, given the ask, the identity, everything played and everything pending, and the proposer MUST NOT repeat a title already played or pending.
- **FR-006**: A fill MUST look each proposal up on the catalog and keep up to three streamable versions per song as its hits, each with the catalog's tags (title, artists, album, art, duration).
- **FR-007**: A fill MUST append one slot per proposal that has at least one hit, in the proposer's order, numbered after the last existing slot; a proposal with no hit MUST NOT become a slot.
- **FR-008**: A fill MUST run under the session's production lock; a concurrent second fill MUST be refused with a conflict.
- **FR-009**: A fill that appends fewer than one slot MUST fail with the reasons for every dropped proposal.

**The slot**

- **FR-010**: Writing slot *n* MUST be one request that, in one model call, picks the version from the slot's hits, charts the track (ramp length and whether the writer is sure of it, where the post lands in words, how the record ends and how long, energy, tempo, mood), writes the copy (kind, words, the break's lead line, why this treatment), and sets the two timing numbers; all of it MUST land on the slot together or not at all.
- **FR-011**: The pick MUST be one of the slot's own hits; a pick outside them MUST be rejected.
- **FR-012**: The writer's brief MUST carry the ask, the identity, the browser's clock time, the slot's proposal and hits, the copy of the last three written slots, the list of everything played, and any earlier charts of the same track from other sessions as read-only notes; for breaks only it MUST also carry the weather and the headlines, and the legal ID when the hour calls for it.
- **FR-013**: The house rules MUST check the writer's timing against the writer's own chart and the house limits after the write, and every step-down MUST be recorded on the slot as its fallback.
- **FR-014**: Right after the write, in the same request, the slot's copy MUST be voiced in the session's voice and stored before the slot is stamped voiced; a segue MUST be stamped voiced with no clip.
- **FR-015**: Asking for a slot already written MUST return it unchanged; asking with "again" MUST re-voice the same copy under a new key and change nothing else.
- **FR-016**: Asking for a slot that is not yet proposed MUST be refused with a clear error.
- **FR-017**: The slot rung MUST run under the session's production lock; a concurrent second producer MUST be refused with a conflict.
- **FR-018**: Writing a slot MUST NOT wait on any other slot being written, voiced or pulled.

**The track**

- **FR-019**: The track's pull MUST be fired by the browser as soon as a slot's response carries a pick, MUST run alongside the voicing, MUST return at once when the track is already held by any session, and MUST NOT be under the session's lock.
- **FR-020**: The track record MUST hold only what the catalog gave (tags, where the bytes are, the size); nothing the writer judged MUST ever be stored on the track.
- **FR-021**: A written slot's displayed tags MUST come from its picked hit, so the slot reads correctly before its track is held.

**The browser**

- **FR-022**: The browser MUST run the loop: fetch the snapshot, find the frontier (the first slot not yet voiced), ask for that slot, fold in the response, fire its pull, and repeat while playing; while slot *k* plays it MUST have asked for slot *k+1*.
- **FR-023**: The browser MUST ask for a fill at open and whenever the count of proposed-but-unwritten slots is at or below `lowWater`.
- **FR-024**: The browser MUST send only the slot number and its clock time when asking for a slot; it MUST NOT say what kind the slot should be.
- **FR-025**: The rundown MUST list every slot in order with its derived status, show a proposed slot as "coming up" with title and artist, and mark a written slot's track as held or not.
- **FR-026**: A reload MUST resume at the same frontier with nothing re-made.

**The clock**

- **FR-027**: `breakEvery`, `fill` and `lowWater` MUST be station settings edited in the control room, read per request, and absent settings MUST fail the request rather than fall back to a value in code.

**Retirement**

- **FR-028**: The segment table, the card table, the compose step, the program rung, the audio rung, and the first build's unused tables MUST be removed with the code that served them.
- **FR-029**: The API and data model documents MUST describe the new shape and no longer describe segments, cards or the compose step as current.
- **FR-030**: Code MUST use the domain's words (track, tags, slot, proposal, hits, pick, chart, copy, timing, clip, fill, plan, the clock) and none of the retired synonyms (record, song, card, candidate, playlist, segment, program).
- **FR-031**: Sessions produced under the old model MUST be wiped; tracks already held MUST stay and be reused.

### Key Entities

- **Session**: One listening — the ask, verbatim, and the voice. Owns the slots. Doubles as the production lock for fills and slot writes.
- **Slot**: One clip over one track at position *seq*. Born as a proposal (title, artist, why) with its hits; written whole with the pick, the chart, the copy and the timing; then voiced with its clip. Status derived from which of these are present. The whole show is this list.
- **Track**: One record ever held by the station, keyed by the catalog's id, carrying only the catalog's tags and where the bytes are. The library's, shared across sessions; never carries anything judged.
- **The clock**: Three station settings — `breakEvery`, `fill`, `lowWater` — that shape every show. Not a client knob.
- **Chart, copy, timing**: The writer's judgment about one slot, living only on that slot. Earlier charts of the same track from other sessions are notes to the writer, never facts about the track.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: First sound is heard after exactly two model calls from a fresh session (one fill, one slot write), down from four in series today.
- **SC-002**: Every slot after the first is produced (written, voiced, pulled) while the previous record plays; across a session of ten or more slots, no transition waits on production.
- **SC-003**: A session runs for as long as the listener listens: the show refills itself and no song title repeats within a session.
- **SC-004**: Breaks fall at slot 1 and every `breakEvery` slots after, in every session, with the legal ID on the first break after the hour turns.
- **SC-005**: A reload lands in the same place with nothing re-made: zero additional model calls or voicings from a reload of a session in progress.
- **SC-006**: The show's tables are session, session_slot, track and settings; the card, session_segment, station and segment tables and their code are gone, and the app's source is smaller than before.
- **SC-007**: The pre-push gate (lint, format, typecheck, tests, build) passes, and the pure logic that changed (the clock's break placement, the frontier and low-water derivation, the house rules over the new chart, the writer's shape, the transport) has red-first tests.
- **SC-008**: The API and data model documents match what ships.

## Assumptions

- The decisions in `docs/slot-first.md` ("Decisions taken") and the row shape in `docs/domain.html` are settled and are not reopened here.
- The two open questions in `docs/slot-first.md` take their stated defaults: the writer's brief carries the last three written slots' copy plus the list of everything played, and the rundown shows a proposed slot as "coming up" with title and artist only.
- The clock's defaults are those in `docs/domain.html`: `breakEvery` 5, `fill` 6, `lowWater` 2. They are seeded as settings rows, not read from code.
- The break's brief carries the weather and the headlines exactly as today's break does; a failed feed is logged and the show goes on.
- The playback side of the deck (the three lanes, the plan's house constants, the transport) is unchanged except that it reads the chart from the slot instead of from a card, and the pull is fired on the slot response instead of on the program response.
- The legal ID stays the server's, placed on breaks when the hour turns, as today.
- Album art is the catalog's CDN URL until that breaks; nothing is copied.
- Existing sessions carry Spotify ids or segment rows and cannot play; wiping them is acceptable, and tracks already pulled are kept.
- The proposer, the writer and the voicing keep their current providers and roster; only the number and shape of the calls change.
- A missed pull is retried by the browser on the next loop pass; there is no server-side retry queue.
