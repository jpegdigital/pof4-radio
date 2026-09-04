# Slot-first

*Decided 2026-09-04. What we want to see happen, not how. The model this lands on is
[domain.html](domain.html); the world it replaces is [api.html](api.html) and
[sessions.html](sessions.html).*

## The problem

A listener types an ask and waits. Today they wait for everything: a whole segment's playlist
proposed, hydrated and composed, every record's card made, the whole program written, and only
then the first clip voiced. Depth first, breadth at every step. The first sound arrives after
four Claude calls and a search fan-out, and none of that work was needed to start playing the
first song.

We want the opposite. Do the least that makes the first song playable, start playing it, and do
the rest while it plays. Breadth first, one slot at a time.

## What we want to see

**The show is a list of slots and nothing else.** A slot is one clip over one track. Slot 1 is
the intro break. Every so many slots after that is another break, and how many is the
station's setting, not the listener's and not the browser's. Between breaks the writer chooses
what the top of each record sounds like. There are no segments; the break is just a kind of
slot and the clock says where it falls. Room stays open for other kinds later, but nothing is
built for them now.

**The playlist is the slots that have not been written yet.** We do not keep a playlist as its own
thing. A fill asks the proposer for the next several songs in order, looks each one up on Qobuz,
and appends one slot per song found, carrying the versions Qobuz offered. Song one is song one.
There is no compose step; the proposer locks the order, and the only thing left to decide about
the record is which version, which the writer decides when it writes the slot. A song Qobuz
cannot find never becomes a slot; the fill asks for a couple more than it needs so a miss costs
nothing.

**Writing a slot is one call.** When the show needs slot N, the server looks at that slot's
proposal and its hits and, in one call, the writer picks the version, charts the track (how long
the ramp runs, where the post lands, whether it is sure, how the record ends, its feel), writes
the copy, and gives the two timing numbers. All of it lands on the slot's row at once. There is
no separate call to describe the record and no table of descriptions, because the chart only ever
serves the copy written beside it, and forty words over a ramp is a different read of that ramp
than twelve. Earlier charts of the same track from other sessions are offered to the writer as
notes, and never written back.

**Then it is voiced, in the same breath.** The clip is made right after the copy, in the same
request. Another take re-voices the same copy under a new key. A segue is done with nothing to
say.

**The record is pulled the moment the pick is known.** The version is chosen when the slot is
written, so that is the first moment the track can be fetched. The browser fires the pull as
soon as the slot comes back, and it runs alongside the voicing. A track already in the bucket
returns at once. The library is the library's, not the session's, and the pull is never under
the session's lock.

**The browser decides when, the server decides what.** The browser runs the loop: it asks for
the next slot, plays it, and asks for the one after while this one plays. It asks for a fill
when the unwritten slots run low, and that low-water mark is a setting too. But the browser
never says what a slot should be. It says "slot N" and the server knows from the clock and the
database whether that is a break or the writer's choice. The server stays a set of stateless
functions.

**Two homes for what we know about a track: given and judged.** What Qobuz tells us (title,
artists, album, art, duration) belongs to the track and never changes. What the writer decides
about it belongs to the slot that decided it. Nothing Claude says is ever stored as a fact about
a track. If a ramp is one day measured rather than guessed, that number becomes given, moves to
the track, and the writer is told so.

## What it buys

- First sound after two Claude calls (propose, then write slot 1) with the pull running under
  the second, instead of four in series.
- Every later slot costs one call and one voicing, done while the previous record plays, so
  the listener never waits again.
- A session can run as long as the listener likes. The show refills itself.
- One table for the show. Status falls out of which columns are filled.
- Less code: the compose step, the card maker and its table, the segment table, and the split
  between the program rung and the audio rung all go.

## What it costs

- A record cannot be prefetched before its slot is written, because the version is picked at
  write time. The window for the pull is the length of the previous record, which is enough.
- No independent check on the writer's ramp. The writer's own confidence flag and the house
  rules carry that job: not sure means the voice does not chase the post.
- The cross-session cache of charts is gone as a table. Prior slots serve the same purpose in
  the brief.

## Decisions taken

| Question | Decision |
|---|---|
| Who decides a slot's kind | The server, from the clock and the row. The browser sends only the clock time. |
| Where the break falls | Slot 1, and every `breakEvery` slots after. A setting. |
| How many songs a fill adds, and when the next fill fires | Settings: `fill` and `lowWater`. |
| Does the proposer see what has played | Yes, played and pending titles both, so it never repeats. |
| How many versions per song | Up to three streamable hits; the writer picks. |
| Write and voice, one rung or two | One. `{ again: true }` re-voices only. |
| Who fires the pull | The browser, on the slot response. |
| Does the chart get cached | Not as a table. Prior slots are offered in the brief, read-only. |
| Album art | Qobuz's CDN URL, until that breaks. |
| Legal ID | Still the server's, on breaks when the hour turns. |
| Weather and headlines | In the brief for breaks only. |

## Open

- Whether the writer's brief carries the last three slots' copy, or the whole show so far.
  Start with three and the list of everything played.
- What the rundown shows for a proposed-but-unwritten slot. Title and artist as "coming up" is
  enough.
