# Slices

What the station does, cut the way a senior engineer would hold it in their head — from
`architecture.html`, not from a study of the code. One entry is one assignment for `/reshape`.
**Find** marks a piece the business clearly has and the code never named.

## Types

| Type | Is | Good means |
|---|---|---|
| **capability** | A thing the station does. Sequences other slices. | Reads as the steps of the job. Everything it touches is handed in. Testable with plain fakes. |
| **entry point** | The edge of a capability: a route, a server action, a worker's main. One per capability; not listed below. | Parse, call, map. Wires the real adapters and stores in. |
| **adapter** | One outside system. | One call, typed in, typed out, typed error, timeout. Knows nothing of the domain. |
| **store** | What is kept and how. | The only place that knows SQL and bucket keys. Speaks the domain's types. |
| **rule** | The domain's own knowledge, pure. | No I/O, no clock, no framework. Table-tested. |
| **view** | Pixels and gestures. | State in, events out. No fetching, no sequencing. |

## Frozen

While working inside any slice: the HTTP routes and the slot on the wire, the database schema, the
bucket keys, the prompts' meaning, and every other slice's *exposes*. Moving one is its own assignment.

---

## Making the show

### fill-the-show · capability
- **Job:** turn the ask and what has played into the next few proposed slots.
- **Consumes** the ask, played and upcoming, the clock → **exposes** proposed slots, unjudged.
- **Stands on:** propose-songs, find-the-versions, the-show, show-store.
- **Today:** lives in its entry point.

### produce-a-slot · capability · **find**
- **Job:** take one proposed slot to voiced — judge, choose the news, write, check, save, voice — resuming from whatever is already saved.
- **Consumes** a proposed slot, the clock time → **exposes** the slot voiced, or what was kept before the failure.
- **Stands on:** judge-the-recording, choose-the-news, write-the-copy, voice-the-take, the-show, the-record, show-store.
- **Today:** has no home. The whole job is the body of one route handler — now asking show-store rather than the pool.
- **Handed over by the show-store pass:** the staged-failure policy (which keep point, when to go back) is the rung's and still inline; the locked show hands its raw client to the prepared-edition readers; the one test reaches the job by mocking nine modules and matching SQL text, so it should become a test of this capability with a fake show.

### judge-the-recording · capability
- **Job:** choose the recording from the hits, chart it, choose the mix.
- **Consumes** proposal, hits → **exposes** pick, chart, plan, and every answer retained.
- **Stands on:** jev. **Today:** its own files beside the routes.

### choose-the-news · capability
- **Job:** for a break, choose zero to two prepared stories this session has not reserved, and reserve them.
- **Consumes** the latest edition, the ask, the session's history → **exposes** the chosen stories.
- **Stands on:** jev, prepared-content, show-store.
- **Today:** the choosing is its own file; the reserving is inline in the slot route.

### write-the-copy · capability
- **Job:** the brief in; words and lead line out.
- **Stands on:** claude, prompts. **Today:** its own files.

### propose-songs · capability
- **Job:** name the next songs, with the catalog in the room.
- **Stands on:** claude, qobuz (as its tools), prompts. **Today:** shares a file with find-the-versions.

### find-the-versions · capability
- **Job:** a proposal to its streamable hits; drop the repeats.
- **Stands on:** qobuz. **Today:** shares a file with propose-songs.

### voice-the-take · capability · **find**
- **Job:** a script to a kept clip: speak, bucket first, row second; another take is a new key.
- **Consumes** the words, the DJ → **exposes** the clip's key and the take's record.
- **Stands on:** elevenlabs, bucket, show-store.
- **Today:** the tail of the slot route. The control room's "hear it" is a second, separate use of the voice.

### hold-a-track · capability
- **Job:** make the pick's bytes exist in the library, once, for everyone.
- **Stands on:** qobuz, bucket, show-store. Not serialized, by law.
- **Today:** lives in its entry point; small.

## Preparing the day

### prepare-content · capability
- **Job:** on a schedule, publish a dated edition of news, of weather; serve the latest to a break.
- **Stands on:** claude, nws, rss. **Today:** the worker scripts and a shared contract file — already separate.

## Airing the show  *(browser)*

### run-the-show · capability · **find**
- **Job:** keep production one slot ahead: decide the next call, make it, fold the answer into the rundown, fire the track hold.
- **Consumes** the snapshot, the cue → **exposes** the rundown, current.
- **Stands on:** the next-move rule, the HTTP routes.
- **Today:** the rule is pure and named; the doing of it lives inside the session page's component.

### play-a-slot · capability
- **Job:** one cue to sound: load, lay the mix, run three lanes on one clock, survive backgrounding, say "ended".
- **Consumes** a voiced, held slot → **exposes** transport state.
- **Stands on:** mix-plan, transport, lock-screen (rules); Web Audio.
- **Today:** the rules are pure and named; graph, clocks and recovery share one hook.

## Running the station

### run-the-station · capability
- **Job:** edit identity, clock, voices, news desk; hear a voice; preview a news choice.
- **Stands on:** settings, elevenlabs, choose-the-news. **Today:** the control room — already separate.

---

## What they stand on

### the-show · rule · **find**
- **Job:** the domain's model of a session: a slot's life (proposed → written → voiced, derived from what is present), what has played and what is coming, where the last break was, what news is already reserved.
- **Today:** unnamed. It exists as null-checks on columns and ad-hoc queries wherever a route needs to know.

### the-record · rule · **find**
- **Job:** build what is kept about a production — the retained questions and answers, each take, the public news receipt — from the decisions made.
- **Today:** the types have a file; the building is inline in the slot route.

### show-store · store
- **Job:** read and write sessions, slots and the track library; the session lock; "what was saved survives a later failure"; bucket-first-row-second, stated once.
- **Exposes:** a locked show for the rungs (its reads, its saves, keep points, commit); plain functions for creation, the snapshot, the log, the streams, the heard receipt and the track library.
- **Today:** `api/sessions/show-store.ts` (reshaped 2026-09-21). Still hands out rows in the table's shape — that waits for **the-show**. The two live smoke scripts keep their own SQL (plain Node, can't import it).

**Already in shape** — adapters: `claude` · `jev` · `qobuz` · `elevenlabs` · `nws` · `rss` · `bucket`.
Stores: `settings` · `prepared-content`. Rules: `clocks-law` · `mix-plan` · `transport` · `next-move` ·
`lock-screen` · the Claude shapes · prompts. Views: home desk · rundown · player · the settings editors.

---

## The queue

Bottom-up. Measured 2026-09-21; the signals agreed with the judgment and added item 6.

1. **the-show** — the model. **show-store** is done (2026-09-21) and hands out table-shaped rows; a
   slot's life is still a null-check on those rows wherever someone needs it. Small, and could ride
   along with 2.
2. **produce-a-slot** — the loudest slice by every signal at once: all the station's kinds of I/O in
   one place, by far the highest complexity, steady churn, and its one test has to mock nine modules
   to reach it (that test is also the pin). **voice-the-take**, **the-record** and the news
   reservation fall out of it.
3. **run-the-show** — the production loop is carried by the most-changed live component, which makes
   the calls itself; the doing has no test, only the rule.
4. **fill-the-show**, **hold-a-track** — the same move as 2, smaller and quiet.
5. **play-a-slot** — complex and changing, but its rules are already pulled out and tested; graph,
   clocks and recovery still share one place.
6. **the views** (rundown, player, the settings page) — not a find, a drift: high complexity and high
   churn for things that should only show state. Look after 3, which will take logic out of them.
