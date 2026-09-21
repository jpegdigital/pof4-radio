---
name: "reshape"
description: "Rebuild a tangled part of the codebase into clean, testable, well-modelled pieces, in three passes: model (understand the domain and what the code really does), design (decide the target shape and its boundaries), build (a measured refactor loop that runs until the design's fitness checks pass). Use when the user asks to make code healthy, reduce complexity, apply SOLID / separation of concerns, extract services or use cases, or restructure a route, module or feature — not for a quick rename or a one-function cleanup."
argument-hint: "model|design|build|all <path or feature> [notes]"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

The first word picks the pass, the rest names the target (a file, a folder, or a feature in words) and
any notes from the owner. No pass named → work out which pass is next from the artifacts that exist
(below) and say which one you are running. No target → ask.

## What this is for

An agent asked to "clean this up" makes the smallest safe-looking change: it moves code within a file,
extracts a helper or two, and stops. That is not a redesign, and it is why the owner has had to walk
every refactor step by step. The cause is not a lack of skill at editing; it is that **design was never
a deliverable** — it happened, if at all, as a side effect of editing, anchored to whatever the house
rules already said, with nothing to check the result against.

This skill makes each missing thing explicit and separate:

| Pass | Question it answers | Output | Touches code? |
|------|--------------------|--------|---------------|
| `model` | What is really here — the business, and the code? | `model.md` | No |
| `design` | What should it be, and how will we know we got there? | `design.md` | No |
| `build` | Get there, in small green steps, measured. | the code, `log.md` | Yes |

Artifacts live in `docs/reshape/<slug>/`, where `<slug>` is a short kebab-case name for the target
(`slot-producer`, not `route-ts`). A later pass reads the earlier artifacts — never the conversation —
so each document must stand on its own for a reader who was not there.

## Before any pass

1. **Read `concepts.md`** (beside this file). It is the vocabulary and the judgment every pass relies
   on: layers, shapes, where rules live, when a function should exist, what metrics are for. Do not
   skip it because the ideas sound familiar; the point is to apply *these* definitions consistently.
2. **Read the house rules** — `CLAUDE.md`, anything under `.claude/rules/`, and the docs they point
   at. Then hold them at arm's length: they describe how the code was built, and part of this job is to
   find where they are the cause of the problem. **A house rule that conflicts with a healthy shape is
   named in the artifact as a tension, with a proposed rewrite. It is never silently obeyed, and never
   silently broken.** Only the owner changes house rules.
3. Read the pass file: `pass-1-model.md`, `pass-2-design.md` or `pass-3-build.md`.

## Running the passes

- `model` and `design` each end by stopping and giving the owner the path to the document and a
  five-line summary. The design is the one cheap, high-leverage review point: five minutes reading one
  page replaces an afternoon of steering. Do not start `build` on a design the owner has not seen,
  unless the pass was `all`.
- `all` runs the three in order without stopping, for when the owner wants to come back to a finished
  job. Every gate inside the passes still applies, and the independent reviews (below) stand in for the
  owner's. If the design review raises a blocking objection that you cannot resolve from the code and
  the model, stop there — a wrong design built well is the expensive failure.
- `build` may be re-run; it resumes from `log.md`.

## Independent review

Your own judgment of your own document is the weak point, so each pass ends with a review by a fresh
agent (the Agent tool, general-purpose, no conversation context) that is given only the artifact, the
target's paths and `concepts.md`, and is asked to **find what is wrong**, not to approve. Each pass
file says what that reviewer is asked. Fix what it finds, note in the artifact what you rejected and
why, and do not run more than two review rounds per pass — past that you are polishing.

## What never changes, in any pass

- **Behaviour is fixed.** This is restructuring. A bug found on the way is written down, not fixed,
  unless the owner asked for it; a fix rides in its own step with its own red test.
- **The score is a prompt to look, never the target.** A change that lowers a complexity number while
  failing the function-existence test in `concepts.md` is a worse codebase with a better number.
- **Right-size.** Most code is fine. A 30-line route is already its own best design. Say "leave it"
  when that is the answer, and say why.
- **Report faithfully.** What was pinned by tests, what was only verified live, what was not verified
  at all — each stated as what it is.
