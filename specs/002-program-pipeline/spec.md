# Feature Specification: Program Pipeline

**Feature Branch**: `002-program-pipeline`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "Ok sounds good. two opus steps in serial. Let's do this still in /program ensure we contain as much as possible in route group so we can study and iterate there." — following the design conversation: a prompt becomes a pre-generated, previewable radio program in stages (discovery → enrichment → log → script → voicing), voiced ahead of time, and played on the existing `/program` sandbox.

## Overview

Today `/program` plays one hand-assembled 8:43 pm segment over a fixed set of ten songs. This feature turns it into a **program maker**: the operator types a request ("Saturday night 80s, Dallas, hits-forward"), and the sandbox produces a complete hour-shaped program — the records, in an order that makes sense, each with a treatment at its top (talk-up, sweeper, clean segue, or full break), every word the DJ says, and the voice clips — as files the operator can inspect, hand-edit, and re-run from any stage. The existing player then plays it.

The work is organised as a pipeline of stages, each producing a file that the next stage reads:

| Stage | Question it answers | Output |
|-------|---------------------|--------|
| 1. Discovery | Which records, and why? (creative) | resolved song set with the reasoning |
| 2. Enrichment | What do we know about each record? (per record, cached) | one card per record |
| 3. Log | In what order, and what happens at the top of each? (disciplined) | the log |
| 4. Script | What does the DJ say? | the script |
| 5. Voicing | Say it, measure it, assemble | clips + the final program |

Stages 3 and 4 are the "two serial planning steps" from the conversation: the log is fixed before the words are written so the script reads as one show against a rundown that doesn't move.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A prompt becomes a program (Priority: P1)

The operator gives the program maker a one-line request and, a few minutes later, `/program` has a new program ready to preview: ten-ish records in a deliberate order, each with its treatment, the DJ's words written for every talk element, and the audio for those words. Pressing Run plays it exactly as the existing sandbox plays today's program.

**Why this priority**: This is the feature. Everything else is how it is inspected or tuned.

**Independent Test**: Run the maker with a request; open `/program`; the rundown shows the new set; Run plays it end to end with talk in the right places.

**Acceptance Scenarios**:

1. **Given** a request and a running sandbox, **When** the maker is run end to end, **Then** a complete program (songs, log, script, clips) exists and `/program` plays it.
2. **Given** the same request run twice, **When** the operator compares them, **Then** the record picks may differ (discovery is creative) but every produced program is structurally complete and playable.
3. **Given** a produced program, **When** the operator reads its rundown, **Then** every record has exactly one treatment at its top, every non-segue treatment has words, and the top of the hour has a legal ID.

---

### User Story 2 - Inspect and re-run from any stage (Priority: P2)

Each stage writes a plain, readable file. The operator can open the log, change a treatment ("no talk-up here"), and re-run only the script and voicing; or edit a line of the script and re-run only the voicing. Nothing upstream is re-paid.

**Why this priority**: The sandbox exists to study and iterate. Cheap re-runs from a checkpoint are what make iteration possible.

**Independent Test**: Edit the log file by hand, re-run from the script stage, confirm the script reflects the edit and discovery/enrichment did not run.

**Acceptance Scenarios**:

1. **Given** a finished run, **When** the operator re-runs from stage N, **Then** stages before N are not executed and their files are unchanged.
2. **Given** an edited stage file, **When** downstream stages run, **Then** they consume the edited content.
3. **Given** a stage's output, **When** the operator opens it, **Then** it is readable without tooling and its fields are the ones documented in Key Entities.

---

### User Story 3 - Records are enriched once and remembered (Priority: P2)

Enrichment describes a record, not a program: intro length, the post, how it ends, energy, mood, a few talking points. A record enriched for one program is not asked about again for the next; a record that could not be enriched is dropped from the set rather than failing the run.

**Why this priority**: Enrichment is the only stage whose cost grows with the catalogue, and it is the step most likely to fail per item.

**Independent Test**: Run two programs that share a record; the second run does not enrich the shared record. Force one enrichment to fail; the program completes without that record.

**Acceptance Scenarios**:

1. **Given** a record already enriched, **When** a new program includes it, **Then** its card is reused.
2. **Given** a record whose enrichment fails or is malformed, **When** the program proceeds, **Then** the record is left out, the omission is reported, and the run completes.
3. **Given** a card, **When** the operator reads it, **Then** it says how sure the enrichment is about the intro timing.

---

### User Story 4 - Timing is best-effort and never breaks playback (Priority: P3)

Every timing derived from text or from guesses about the record — where a talk-up starts so it lands on the post, when the bed comes in, how far under the last line the song starts — is optimistic: try the good version; if any input is missing or doesn't add up, fall back to a plain, safe version; never stop the show.

**Why this priority**: Correct fallback is what lets the creative parts be wrong without consequences.

**Independent Test**: Hand a talk-up a clip longer than its intro; the program still plays, with the talk-up moved to its fallback placement and the reason logged.

**Acceptance Scenarios**:

1. **Given** a talk-up whose intro is known and long enough, **When** it plays, **Then** the voice ends a beat before the post.
2. **Given** a talk-up whose intro is unknown, unsure, or too short for its clip, **When** it plays, **Then** the voice starts shortly after the song does and the song is never delayed.
3. **Given** a break whose words could not be split into a lead line, **When** the next song starts, **Then** it starts when the clip ends (no overlap) rather than at a wrong time.
4. **Given** any fallback taken, **When** the operator reads the produced program, **Then** the fallback and its reason are recorded on that element.

---

### Edge Cases

- Discovery names a record that the music service cannot find: the record is dropped; if fewer than a minimum number of records survive, the run stops with a clear message before enrichment.
- Discovery returns duplicates (same record twice, or the same artist back to back): the log stage must not schedule the same record twice; back-to-back artists are discouraged, not forbidden.
- The log asks for a talk-up over a record whose card says it starts on the vocal: the treatment is downgraded to a segue or sweeper, recorded as a fallback.
- The script returns words for a segue, or no words for a break: words on a segue are ignored; a break with no words becomes a sweeper if a sweeper clip exists, else a segue.
- The voice service fails for one clip: that element falls back to the wordless version of its treatment; the run completes and reports it.
- The hour boundary: if the program crosses the top of the hour, exactly one top-of-the-hour break with a legal ID is placed at the first record after the boundary.
- The operator re-runs voicing with a different default voice: all clips are regenerated; cards and the log are untouched.

## Requirements *(mandatory)*

### Functional Requirements

**Containment**

- **FR-001**: Everything this feature adds — the stage logic, the prompts, the file shapes, the run entry point, the preview pages — MUST live inside the `/program` area of the app, so it can be studied, changed, and thrown away without touching the station.
- **FR-002**: The existing player, its state machine, and its lane model MUST be reused as-is or extended, not duplicated; the final program's shape MUST be what the player already plays.

**Pipeline**

- **FR-003**: The pipeline MUST run as ordered stages — discovery, enrichment, log, script, voicing — each reading the previous stage's file and writing its own.
- **FR-004**: The operator MUST be able to start a run at any stage, given that stage's inputs exist on disk.
- **FR-005**: Every stage file MUST be human-readable text with a documented shape; a stage MUST reject a malformed input file with a message naming the file and the problem.

**Discovery**

- **FR-006**: Discovery MUST take a free-form request plus the station's identity and produce a set of record picks with a short written rationale for the set; it MUST be encouraged to be creative within the station's format.
- **FR-007**: Each pick MUST be resolved to a playable record with its length; unresolved picks are dropped and reported.

**Enrichment**

- **FR-008**: Enrichment MUST produce one card per record, independently of any program, containing at least: instrumental intro length and confidence, the first sung words (the post) if any, how the record ends (cold or fade) and roughly when the fade begins, an energy level, a mood, and two or three talking points.
- **FR-009**: Cards MUST be cached by record identity and reused across runs; a run MUST NOT re-enrich a record with a valid card unless the operator asks for a refresh.
- **FR-010**: Records may be enriched concurrently; a record whose enrichment fails MUST be excluded from the set without stopping the run.

**Log**

- **FR-011**: The log stage MUST order the surviving records and assign each exactly one treatment at its top — talk-up, sweeper, segue, or break — following the station's clock rules: talk-ups only over a confidently known instrumental intro of usable length; a break every three to four records; the opening is a break; a top-of-the-hour break carries a legal ID.
- **FR-012**: The log MUST record, per element, why that treatment was chosen.
- **FR-013**: The log stage MUST complete before the script stage begins and MUST NOT write any DJ words.

**Script**

- **FR-014**: The script stage MUST write the words for every non-segue element in one pass against the fixed log, so references to what just played and what comes next are consistent across the hour.
- **FR-015**: Words MUST be returned as separate fields where timing depends on them: the legal ID (said dry) apart from the break's body, and the break's final lead line apart from the rest — so no timing has to be found by searching the text.

**Voicing and assembly**

- **FR-016**: Voicing MUST produce one clip per element with words and record each clip's measured length.
- **FR-017**: Assembly MUST derive all timings from measured clip lengths, the cards' intro data, and fixed house constants (the beat before the post, the overlap under a lead line, the bed's rise), never from locating phrases inside voiced audio.
- **FR-018**: Every derived timing MUST be optimistic with a defined fallback: a talk-up that cannot be landed on the post starts shortly after the song starts; a break whose lead line is missing hands off to the song when its clip ends; a bed with no legal ID comes in at the start. Any fallback taken MUST be recorded on the element with its reason.
- **FR-019**: The final program MUST be complete and playable even if every optimistic timing fell back.

**Preview**

- **FR-020**: `/program` MUST load the produced program and show its rundown: each element, its treatment, its words, and any fallback taken.

### Key Entities

- **Request**: the operator's free-form ask plus the station identity (name as said on air, call letters, city, DJ name, the program's start time).
- **Pick**: one record named by discovery — artist, title, and why — before resolution.
- **Record**: a resolved, playable song: identity, title, artists, album, art, length.
- **Card**: what is known about a record independently of any program — intro length and confidence, the post, ending type and fade start, energy, mood, talking points. One per record, cached.
- **Log**: the ordered list of records for the program, each with its treatment (talk-up / sweeper / segue / break), the rationale, and whether it is the top-of-the-hour break.
- **Script**: for each log entry, the words: body, legal ID (top of the hour only), lead line (breaks only).
- **Clip**: a voiced piece of script and its measured length.
- **Program**: what the player plays — the element list in the player's existing shape, plus per-element notes on timings chosen and fallbacks taken.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From request to playable program in under 5 minutes for a ten-record set, unattended.
- **SC-002**: 100% of runs that reach the log stage produce a playable program, including runs where every optimistic timing fell back.
- **SC-003**: A re-run from the script stage completes in under 1 minute and makes no discovery or enrichment requests.
- **SC-004**: A record enriched once is never enriched again across runs unless a refresh is asked for.
- **SC-005**: Every element in a produced program can be traced back through its files: which pick, which card, which log entry, which script line, which clip, which fallback.
- **SC-006**: Listening to a produced program, the operator can hear at least one talk-up land on its post when the card was confident and the intro long enough.

## Assumptions

- The sandbox remains pre-generated: clips are produced ahead of time into local files; live streaming, caching strategy, and cost optimisation are later work.
- The music service can only play one record at a time; a "join" between records is our audio (voice, sweeper, bed) over the outgoing fade and/or the incoming intro, with a single switch instant — never a crossfade of two records.
- Intro lengths, posts, and fade points come from the planner's knowledge of the record and will sometimes be wrong; the confidence flag and the fallbacks absorb that. Measuring the records' audio is out of scope.
- The first voice in the roster is the program's voice; the sweeper and bed audio produced earlier are reused.
- One hour-shaped program per run; multi-hour scheduling, persistence to the database, and running the pipeline on the server for listeners are out of scope.
- The clock rules (break cadence, talk-up threshold, opening and top-of-hour treatments) are house constants for now, editable in one place, not per request.
- The existing `/program` pages (the clock and sweeper prep pages) stay; this feature replaces how the program they play is produced.
