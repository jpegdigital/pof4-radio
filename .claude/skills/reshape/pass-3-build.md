# Pass 3 — Build

A measured loop: take the next step from `design.md`, prove it safe, make it, measure, have it read
cold, record it — until every fitness check passes. The destination is the design. Decisions about
boundaries are not made here; if one needs making, the design was incomplete (see "When the design is
wrong").

Requires `docs/reshape/<slug>/design.md`. Keeps `docs/reshape/<slug>/log.md`.

## Before the first step

1. **Working tree.** Run `git status`. If the target's files have uncommitted changes, or unrelated
   work is in flight on this branch, stop and tell the owner — a refactor tangled with someone's
   half-finished feature cannot be reviewed or reverted.
2. **Branch.** Work on `reshape/<slug>`, created from the default branch (or from where the owner says).
   Invoking this pass is the owner's authorization to **commit each green step on that branch**. It is
   not authorization to push, open a PR, merge, or touch any other branch.
3. **Baseline.** Run the project's gate (here `pnpm check`, then `pnpm --filter web build`) and its
   complexity command (`pnpm complexity`). Record in `log.md`: the gate result, the target's scores,
   line counts, and the fitness checklist with every box unticked. If the gate is red before you start,
   stop — you cannot tell your breakage from what was already broken.
4. **Resume.** If `log.md` exists, read it and continue from the first step not marked done.

## The loop — once per step

1. **State the step** in the log: what moves, what proves it safe, how to undo it (from the design).
2. **Proof first.** The pin, the red test, or the differential harness this step relies on exists and
   is in the state it should be — green for a pin against old code, red for new behaviour — *before*
   the production change. For a step that adds a pure function, the table test comes first and fails.
3. **Make the change.** Only this step. Moves are moves: same statements, same order, same strings.
   Reshapes are reshapes. Never both in one step. Match the surrounding code's idiom, naming and
   comment density; delete what becomes dead.
4. **Gate.** Tests, typecheck, lint, format — the whole project gate, not just the nearby tests. Red →
   fix forward once if the cause is obvious and local; otherwise revert the step.
5. **Measure.** The complexity command and the design's fitness checks. Record the numbers. A score
   that went *up* anywhere is investigated before moving on, not explained away.
6. **Cold read.** Hand a fresh agent the step's diff, `design.md` and `concepts.md` — no conversation
   — and ask:
   - Reading only the callers in this diff, is there one you could not follow without opening what it
     calls?
   - Does any rule now live in two places, or has any moved without its test?
   - Does any new function fail the function-existence test (§8) — relabelled locals, a returned pair,
     half a rule left behind, a name that restates the body?
   - Does anything here depart from `design.md`?
   - Could this step have changed behaviour? Where exactly?
   Fix what is real. A finding you reject is recorded with the reason.
7. **Record and commit.** Log the step as done with its numbers and findings. Commit on the branch,
   one step per commit, message saying what moved and why.

Remove every temporary artefact (copies of the original, differential harnesses, scratch scripts)
before the commit of the step that no longer needs them.

## Stop when

- **Done**: every fitness check in `design.md` is ticked, the gate is green, and the final cold read —
  the whole target, read by a fresh agent as a newcomer would — raises nothing blocking. "Satisfactory"
  means the checklist, not a feeling and not a lower number.
- **A step fails twice**: revert it, record what happened, and stop with the branch green at the
  previous step. Everything before it is still an improvement that can ship.
- **The design is wrong** (below).
- **The budget is spent**: more than two fix rounds on one step, or the steps in the design are done
  and checks still fail. Stop and report rather than improvising further steps.

## When the design is wrong

You will sometimes find, mid-build, that a boundary does not hold: a module needs something the design
said it must not know, a guarantee cannot be kept in the new shape, a step cannot be made green alone.
Do not patch around it in code. Stop the loop, write a dated **Design change** section at the end of
`design.md` — what was found, the options, the choice and why — and then:

- if the change is local (a signature, a module's home, a step split in two), continue;
- if it changes the organizing idea, a guarantee, or the product's behaviour, stop and report. Under
  `all`, this is the one place an unattended run waits for the owner.

## Never

- Change behaviour inside a restructuring step. A bug found is logged under "Found, not fixed" with
  file:line and a one-line reproduction.
- Weaken, skip or delete a test to get green. A test that pinned an *accident* of the old code is
  changed in its own step, with the reason logged.
- Hit a number by slicing a function at arbitrary points, or by moving complexity somewhere the
  measurement does not look.
- Bypass the gate, hooks or signing; touch files outside the target's reach; tidy unrelated code on the
  way past.
- Claim what was not verified. Code that needs live services is reported as *pinned by fakes* and
  *awaiting live verification*, with the exact script and what to look for.

## The report

End with `log.md` complete and a summary to the owner:

- a before/after table — scores, line counts, test counts, the fitness checklist;
- the map: what lived where, where it lives now, in one table;
- the failure stories that are now tests;
- what still needs live verification, and the script;
- found, not fixed;
- the house-rule rewrites the design proposed, still awaiting the owner;
- the siblings that should follow this exemplar, in the order you would do them.
