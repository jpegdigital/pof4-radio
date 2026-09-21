# Concepts

The vocabulary and the judgment the three passes share. "Apply SOLID" is not an instruction anyone can
follow: it has dozens of valid answers and says nothing about *which* boundaries this domain has. What
follows is the narrower set of ideas that actually decide the shape of application code, stated so they
can be applied the same way every time.

The owner thinks in service classes, constructor injection and a use-case layer. The codebase may be
functional TypeScript. These are the same design: a **service** is a module of functions over one
collaborator; **constructor injection** is a factory, `makeProduceSlot(deps)` returning the function,
or a `deps` first argument; a **use case** is one exported function. Use the owner's words in the
documents and the codebase's idiom in the code.

## 1. Healthy, as claims that can be checked

"Healthy" is only useful if it can be tested for. A healthy unit of code is one where:

- You can say what it is for in one sentence without "and".
- You can read a caller without opening what it calls.
- Every business rule lives in exactly one place, and you can point to the test that states it.
- The things that fail in production — a collaborator down, a second request racing the first, a
  half-finished job retried — can be demonstrated in a test without the real services.
- Dependencies point one way (§2), and a machine can verify it.
- Changing *what we ask a collaborator* does not touch *how we talk HTTP* or *how we store rows*.

Each of these becomes a fitness check in the design pass.

## 2. Four kinds of code, and what each may know

| Layer | Its one job | Knows about | Must not know about |
|-------|-------------|-------------|---------------------|
| **Transport** (route, controller, CLI, worker entry) | Translate the outside world to a call and the outcome back | the framework, request/response, status codes | SQL, transactions, collaborators, business rules |
| **Application** (use case / app service) | Carry out one intent: order the steps, own the transaction, decide what a failure keeps | the domain, the ports | HTTP, `Response`, the framework, a vendor's SDK |
| **Domain** (rules, states, values) | Say what is true: pure functions and types | nothing but itself | I/O of any kind, the clock unless handed in |
| **Infrastructure** (stores, API clients) | Talk to one outside thing | that thing, and the domain's types | other infrastructure, the use case |

The dependency rule: transport → application → domain ← infrastructure. The application layer names
what it needs (a **port**: a function type or small interface); infrastructure supplies it; whoever
starts the process wires them together.

A transport handler done right is some twenty lines: parse and validate, one call, map the typed
outcome to a response. It has no branch worth testing beyond that mapping. If a handler owns a
transaction or talks to more than one collaborator, it *is* a use case wearing a route's name.

## 3. Finding the shape

The decomposition that matters is not "which helpers can I pull out" but "what kind of thing is this".
Look for the organizing idea before drawing any boundary. The common ones, and their tells:

- **Staged pipeline with checkpoints.** Tell: work that proceeds A → B → C, each step's result saved,
  a retry picking up where it failed; status derived from which fields are present; savepoints. Shape:
  one function per stage (`input, ports → result`), a pure `nextStage(state)`, a store that saves each
  result, and a short producer loop. The failure rules ("a failed C keeps B's result") stop being code
  and become a consequence of saving after each stage.
- **State machine.** Tell: a status field or derived status, `if` ladders on it, actions legal only in
  some states. Shape: states and transitions as data or a pure `transition(state, event)`; the use case
  loads, transitions, saves.
- **Command / use case.** Tell: one intent, several steps, one transaction. Shape: `execute(input) →
  Outcome`, deps injected.
- **Query / read model.** Tell: no writes; assembling a view from rows. Shape: the SQL and a pure
  mapper; no use-case ceremony.
- **Policy and mechanism.** Tell: a decision ("is this slot a break?", "may this redirect be
  followed?") tangled into the code that acts on it. Shape: the decision as a pure function, the
  mechanism taking its answer.
- **Aggregate and repository.** Tell: several tables always read and written together under one
  invariant. Shape: one type for the whole, one store that loads and saves it whole.
- **Anti-corruption.** Tell: a vendor's response shapes leaking into business code. Shape: parse at the
  boundary into the domain's own types; nothing past the client sees the vendor's.

Always weigh at least two candidate shapes and write down why one wins. The first shape that comes to
mind is usually "the current code, in more files".

If the same idea already exists elsewhere in the codebase — the browser may already have a pure
`nextMove` while the server re-derives the same thing inline — that is the strongest hint available.
Reuse the idea, and the words.

## 4. Rules: find them, then give each one home

Business rules hide in three places: in conditionals (easy to see), in *ordering* ("bucket first, row
second, so a row always means the bytes exist"), and in *transaction shape* (a savepoint that makes "a
failed voice keeps the script" true). The last two are invisible to a reader skimming for `if`, and
they are the ones a careless refactor breaks.

For every rule: state it in the product's words, find where it is enforced today, and in the design
give it exactly one home. Prefer, in order:

1. **Structural** — the rule follows from the shape and cannot be violated (each stage saves its own
   result, so there is no code path that loses it).
2. **Typed** — illegal states don't typecheck (a `Voiced` slot has a clip key; a `Proposed` one has
   no pick).
3. **Pure and tested** — a named function with a table of cases.
4. **Procedural** — a line in the use case, with a test that fails if it is removed.

A rule enforced in two places will eventually be enforced two ways.

## 5. Ports and fakes

A port is earned by exactly one of: a test needs to substitute it, or there are two real
implementations. Not by "it might change". The ports of a typical use case are the things that fail
independently: the store, each external service, the clock, id generation.

Prefer **fakes** (a small in-memory implementation you can script: "the voice fails once") to mocks
that assert call sequences — a fake tests the behaviour, a mock tests the implementation and breaks on
every refactor. One fake per port, kept beside the port.

The tests that justify the whole exercise are the failure stories: *the writer fails → the reservation
is kept and the retry does not reselect*; *a second request arrives mid-production → it is refused*.
If the new shape cannot state those as plain tests, the boundaries are in the wrong place.

## 6. Outcomes, not exceptions for the expected

A use case returns a discriminated union of everything a caller must handle — `produced`,
`alreadyDone`, `busy`, `notFound`, `failedAfter(stage, kept)` — and transport maps it to status codes
in one table. Exceptions are for what nobody planned: they cross the use case untouched and become a
500. This keeps `Response` out of the application layer and makes the full set of endings something a
reader, and the compiler, can see.

## 7. Persistence: SQL, named

"No ORM" means the SQL stays SQL, written by hand and visible. It does not mean the SQL lives inline in
the handler. A **store** is a module of named functions — `lockSession`, `loadSlot`, `recentSlots`,
`saveGeneration`, `saveScript`, `stampVoiced` — each one statement, typed in and out, taking the
transaction's client. The name says why the query exists; the use case reads as intent; a fake store
makes the use case testable. The transaction itself (begin, lock, commit, what survives a failure)
belongs to the application layer, because what a failure keeps is a business decision.

Inventory every statement in the model pass. Seven statements scattered through a handler are a
repository that has not been named yet.

## 8. When a function should exist

The test: **can you read the caller without opening it?** If the name and signature tell the whole
story, it earns its place. If you must open it to follow the caller, it is a jump, not an abstraction.

It earns its place when it:

- has a contract you can state without mentioning the caller ("a response → its text, under a byte
  cap" — not "the middle part of parseFeed");
- hides state (mutable locals, a `try/finally`, a loop) from its caller;
- changes for a different reason than its surroundings (a security rule vs. a feed-format quirk);
- removes nesting rather than relocating branches.

It is only pretending to be atomic when:

- its parameters are the caller's locals under new names — three or more, or one called `fallback`,
  `options`, `ctx`;
- it returns a pair the caller immediately destructures;
- part of the rule stays behind in the caller, so you need both to understand either;
- its name restates its body (`handleData`, `processItem`, `doStep2`);
- it exists to satisfy a metric.

Called from one place is fine. Called from one place *and* meaningless without the caller's context is
the smell. When a helper fails this test there are two honest fixes: let it take the whole decision,
or put it back inline as flat early-exit code.

## 9. Right-sizing

Design weight follows the code's weight. Leave alone: handlers under ~40 lines with one collaborator;
pure modules that are long because the domain is (a parser, a table of rules); anything with good tests
that nobody finds hard to change. Do not add a layer that would be empty, an interface with one
implementation and no fake, a class where a function does, or a folder per pattern. Three similar
blocks are still cheaper than the wrong abstraction — WET is a fine default *below* the threshold where
a unit has become a use case; it is not an argument for a 500-line handler.

## 10. What the numbers are for

Cognitive complexity charges for nesting, cyclomatic for branches; function length, parameter count,
import direction and test presence round out the picture. They are good at *finding* trouble and at
proving a step did not make things worse. They are bad at judging design: extraction moves complexity
as readily as it removes it, and a number can always be hit by slicing a function at arbitrary points.

So: measure before, after every step, and at the end. Investigate every regression. Never accept a
step on the number alone — it must also pass §8 and the independent read. A high score that is mostly
data-shaping at depth (big object literals with `?:` and `??` inside nested blocks) is a nesting
problem, and the fix is removing the nesting, not the literals.

## 11. Pinning behaviour before moving anything

Refactoring without a net is rewriting. Before the first structural change, pin what the code does:

- **Characterization tests** for paths with no coverage — written against the *old* code and green
  there first, so they describe what is, not what you expect.
- **Differential run** when old and new can both execute: keep a copy of the original, generate a wide
  spread of inputs (the odd ones matter: empty, malformed, boundary, every failure a collaborator can
  produce), assert deep equality of results *and* of side effects (calls made, in order where it
  matters, error strings that are persisted). Delete the harness and the copy afterwards.
- **Seam first** when the code cannot run without live services: step one is a pure move behind
  injected ports with no reshaping at all, verified by the project's live script; then fakes make the
  rest pinnable; then reshape. Never combine the move and the reshape.
- Persisted strings are behaviour: error messages stored in rows, keys, log lines something parses.

## 12. How this goes wrong, specifically for an agent

Know your own defaults, because they are what produced the code you are looking at:

- **Smallest diff wins.** Each addition to an existing function looks fine; the sum is a 500-line
  handler. In `build`, the step size is small but the *destination* is the design, not the nearest
  local improvement.
- **Anchoring to house rules.** "SQL at the call site", "one readable file", "no small functions" will
  be read as forbidding the fix. They are inputs to the model pass, not constraints on the design.
- **No felt cost.** You read 500 lines in a second and remember nothing next session, so nothing pushes
  back. The owner's pain, the metrics and the failure-story tests are your stand-ins for it.
- **Design as a side effect.** If you find yourself deciding a boundary while editing, stop: that
  decision belongs in `design.md`, where it can be reviewed.
- **Politeness about scope.** Restructuring feels like exceeding the ask. Here it *is* the ask.
- **The catalogue reflex.** Do not apply every pattern in §3. One organizing idea, the fewest modules
  that make the failure stories testable, and stop.
