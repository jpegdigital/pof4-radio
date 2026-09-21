# Pass 2 — Design

**No code changes.** Decide the target shape, its boundaries, and how anyone will know it was reached.
Work from `model.md`, not from the code: the code is how the problem was solved last time, and
designing from it produces the same thing in more files. Open the code only to check a fact.

Requires `docs/reshape/<slug>/model.md`. If it is missing, run pass 1 first. If the owner answered the
model's open questions, use the answers; otherwise proceed on the model's stated guesses and mark each
decision that rests on one.

Output: `docs/reshape/<slug>/design.md` — one page a person reads in five minutes, plus detail below
the fold.

## Think before writing

1. **Name the organizing idea** (`concepts.md` §3). Look at the lifecycles and the rules enforced by
   ordering and transaction shape in the model: they usually point straight at it. Check whether the
   same idea already exists elsewhere in the repo, and borrow its words.
2. **Weigh at least two candidate shapes**, genuinely different — not one shape and a strawman. For
   each: a five-line sketch, what becomes easy, what becomes awkward, which failure stories it can
   state as tests. Pick one. If "leave it, and extract two pure functions" is a real candidate, include
   it; sometimes it wins.
3. **Draw the boundaries** with the four layers (§2). Put every row of the model's responsibility
   inventory in exactly one module. A responsibility with no home, or a module holding two kinds, means
   the boundary is wrong.
4. **Give every rule one home** (§4), preferring structural over procedural. Note each rule whose
   enforcement *changes kind* — especially those that stop being code — because those are where the
   design earns its keep and where behaviour is most at risk.
5. **Right-size** (§9). Delete every module, port and type from the sketch that no test and no second
   implementation needs. Then do it again.

## Write `design.md`

### Above the fold (one page)

- **The idea**: one paragraph — what kind of thing this is and the shape that follows.
- **The modules**: a table — name, layer, one-sentence job, where it lives. Aim for the fewest that
  make the failure stories testable.
- **A sketch of the top-level code**: the use case as it will read, ten to twenty lines of near-real
  code. If this does not read like the "What it does" bullets from the model, the design is not done.
- **What changes for the product**: nothing, stated plainly — or the exact list, each flagged for the
  owner.
- **House-rule changes this needs**: quoted rule → proposed rewrite → why. Proposed only.
- **Done means**: the fitness checks (below), as a checklist.

### Below the fold

- **Alternatives considered** and why they lost.
- **Module contracts**: for each — typed signature; inputs and outputs; collaborators injected (and
  how: factory, `deps` argument, in the codebase's idiom); the outcome or error types; what it must not
  import; how it is tested (pure table / fakes / live script only).
- **The outcome type** of each use case, and the transport mapping table (outcome → status, body).
- **The store**: each statement from the model's inventory → the named function it becomes. SQL
  unchanged unless a change is listed as its own step.
- **Transactions and concurrency**: where the transaction lives, what holds the lock and for how long,
  and how each "what a failure keeps" guarantee is met. If the locking strategy changes, say exactly how
  the old guarantee is preserved, and list it among the risks.
- **Rule map**: rule # → old enforcement → new home → the test that states it.
- **Failure stories as tests**: each one as a sentence that will become a test name.
- **Ports and fakes**: each port, why it is earned, and what its fake can be scripted to do.
- **The exemplar**: which existing module this follows as its pattern, and a note that this target,
  once built, is the reference for its siblings — name the siblings that should follow.

### Fitness checks — "done means"

Make them measurable and few. Draw from:

- Complexity: no function in the target's modules above the project's limits (state them), and no
  function's score *raised* anywhere else.
- Boundaries, checkable by grep or a lint rule: transport imports no database client and no vendor
  client; application imports no framework and no `Response`; domain imports nothing with I/O.
- Size: the transport handler under N lines; no function over M.
- Every rule in the rule map has a test that fails when the rule is removed.
- Every failure story is a passing test against fakes.
- The project's gate is green (here: `pnpm check`, then the build).
- Behaviour unchanged, by the pins defined in the steps.
- What can only be verified live, and the script that does it.

### Steps

An ordered list that `build` will execute. Each step: what moves, what proves it safe, how to undo it.
Every step ends green and could be the last one shipped. The usual spine:

0. **Pin** — characterization tests and/or a differential harness (§11). No production code changes.
1. **Seam** — move the body behind the use-case signature with ports injected. A pure move: same
   statements, same order, same strings. Transport shrinks to parse → call → map.
2. **Fakes and the failure stories** — now that there is a seam, write the tests the design promised,
   green against the moved-but-unshaped code.
3. **Store** — statements become named functions, one at a time.
4. **Pure rules and data shaping** out, each with its table.
5. **Reshape** to the organizing idea — stages, state function, outcome type — the step the rest were
   preparing for. Split it as finely as the design allows.
6. **Boundaries enforced** — the lint or grep checks added so the shape cannot rot.
7. **Live verification** and clean-up.

Mark the risky steps (anything touching transaction shape, locking, or persisted strings) and say what
extra proof each needs.

## Review

Hand a fresh agent `design.md`, `model.md`, `concepts.md` and the target's path, and ask it to attack:

- a responsibility or rule from the model with no home, or with two;
- a module that fails the function-existence test, or that exists for a pattern rather than a test;
- a failure story the shape still cannot state as a test;
- a step that is not independently green, or that mixes a move with a reshape;
- a place the design is "the current code in more files";
- a guarantee (idempotency, what a failure keeps, locking) the new shape quietly weakens.

Fold in what survives. Then stop and give the owner the path and the above-the-fold summary in five
lines: the idea, the module count, the house-rule changes, the riskiest step, and what will still need
live verification. Under `all`, continue to pass 3 unless a blocking objection is unresolved.
