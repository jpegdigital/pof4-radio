# Rubric

How to look at one slice and say whether it is good code. These are questions, not metrics: read the
slice's code, answer them honestly, and let the "no"s be the work. No numbers here: they only ever say
where to look; this page says what good is. Where the project has its own coding standards, they hold
too, and win on a conflict.

## Every slice

- **Can you say its job in one sentence without "and"?** If not, the "and" is the seam.
- **Does it speak the domain's words?** A reader who knows the business should recognise the names; a
  reader who knows the framework should not find business decisions hiding in framework code.
- **If one outside thing changed — a vendor, a table, the HTTP shape — how many files change?** One is
  the answer. More means knowledge of that thing has leaked.
- **Does it fail at the boundary, loudly, with a specific error?** No catch-alls, no silent fallback, no
  default that hides a missing value.
- **Are the knobs data?** No magic numbers or strings inside the logic.

## By type

**Capability** — a thing the business does.
- Does it read top to bottom as the steps of the job, at one level of abstraction? Someone should be
  able to check it against a plain-language description of the job.
- Is everything it touches handed in? It may *decide* to save, fetch or speak; it does not know *how*.
  No SQL, no `fetch`, no SDK, no framework request/response types.
- Is its order, its failure staging and its resume logic visible here and nowhere else?
- Keep it straight-line. Pulling the I/O detail out is the goal; chopping the steps into many tiny
  functions is not.

**Entry point** (route, handler, server action, worker main) — the edge of a capability.
- Does it do exactly three things: parse the input, call one capability with its dependencies, map the
  result or the typed error to a response? Anything else belongs behind it.
- This is also where wiring happens: the real adapters and stores are chosen here and passed down.

**Adapter** — one outside system.
- One call in, typed answer or typed error out, with a timeout?
- Does it know nothing of the domain? It should be liftable into another project unchanged.
- Are key, timeout and `fetch` handed in rather than reached for?

**Store** — what is kept.
- Is it the only place that knows the SQL, the keys, the row shapes?
- Does it take and return domain types, with functions named for what the business needs
  ("the slots of a session"), not for the tables?
- Do the write-order and locking rules live here, stated once?

**Rule** — pure judgment.
- No I/O, no clock, no randomness, no framework: same input, same output?
- Is it table-tested, give/want, including the edges?

**View** — pixels and gestures.
- State in, events out? No fetching, no sequencing, no business decisions in the component.
- Could the logic it displays be tested without rendering anything?

## Tests are a reading of the design

Tests are not the goal. How hard they are to write is the measurement.

- **What must be faked to test the core logic, and how much setup does that take?** A few plain objects
  passed as arguments: good design. Module mocks, patched globals, a fake server, a page of setup: the
  design is telling you where the seam is missing. Fix the design, not the test.
- **Does the test read as a spec of the job, or a mirror of the implementation?** It should survive a
  rewrite of the internals. Asserting that a fake was called with exact arguments, in order, is a mirror.
- **Does each test exist because a behaviour matters?** One happy path and the sad paths that matter
  per public function; tables for anything with more than two variations. No tests written for count.
- **Is behaviour pinned before it is moved?** Before reshaping, a test at the slice's outer contract
  holds what it does today. It stays green throughout; it is the proof nothing changed. When the
  slice is too tangled to pin cheaply — the pin itself would need the module mocks this page warns
  against — don't build that scaffolding: the pin is whatever end-to-end check the project already
  has (a smoke script, a manual script), run before and after, and the cheap tests arrive with the
  first extraction. Say which it was.

## What a reshape must not do

- **No abstraction without a consumer.** A dependency is handed in because it does I/O and a test needs
  to fake it — that is the consumer. No interface-per-class, no factories, no containers, no layers
  added for symmetry. In a language with structural types, the parameter's type *is* the port.
- **No extraction before the third use.** Two similar blocks stay two blocks.
- **No behaviour change.** Same inputs, same outputs, same failures, same things kept. A bug found on
  the way is reported, not fixed in the same pass.
- **No touching frozen contracts** (see `slices.md`). If the slice can't be made good without moving
  one, stop and say so.
- **No drive-by work** outside the slice, and no dead code left behind.

## Done

The slice is done when every question above gets a plain "yes" from someone who didn't write the change,
the pinned behaviour is still green, the project's full check passes, and `slices.md` says where the
slice lives now.
