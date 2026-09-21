---
name: reshape
description: Refactor a codebase the way a senior engineer would — first see what the app is for, slice it into capabilities worth modelling, find the slice the code models worst, then reshape that one slice against a rubric until it passes. Four commands — architecture, slice, measure, or a plain-language ask naming what to reshape. Use when the user wants healthier structure (SOLID, separation of concerns, testable boundaries), not for a rename or a one-function cleanup.
---

# Reshape

The idea: a fresh agent asked to "clean up this code" tidies files. A senior engineer first sees what
the business is doing, names the pieces *that should exist* — often ones the code never named — and
only then opens the code, one piece at a time, with a clear picture of good. This skill is that order
of work. The first three commands stay high and cheap; only the last goes deep.

Everything it writes lives in `docs/reshape/`. `/reshape <command>`:

| Command | Height | Reads | Writes |
|---|---|---|---|
| `architecture` | High. Not about the code. | Project docs, the tree, entry points, schema, config | `architecture.html` |
| `slice` | High. Synthesis, not study. | `architecture.html` | `slices.md` |
| `measure` | Skims for signals. Judges nothing. | `slices.md`, [measure.md](measure.md) | The queue in `slices.md` |
| anything else — the ask | Deep, in one slice only. | The slice's entry, [rubric.md](rubric.md), the code | Code, tests, the slice's entry |

If a command's input is missing, say which command makes it and stop.

## architecture

What the app is for and what flows where — the page that would still be true after every file was
rewritten. Get there fast: the project's own docs, the directory tree, the entry points, the schema,
the deploy config. Open an implementation only to settle what a box *is*, never how it works. If you
are learning function names, you are too low.

One self-contained HTML page (match the repo's existing docs if it has a style; diagrams in Mermaid):

1. **What it is for** — the few promises the product makes, and the shape those force on the system.
2. **The system** — one data-flow diagram: the outside services, the processes we run, the stores,
   the clients, and who touches what.
3. **The pipelines** — the handful of things the app does end to end: trigger, what happens, what it
   leaves behind. A closer diagram only for a pipeline with real internal stages.
4. **The laws** — the invariants any change must keep.

No file inventories, no line counts, no findings. It changes only when a box or an arrow changes.

## slice

Read the architecture and ask what a senior engineer would: *what is this business doing, and what are
the pieces I would want to exist?* Name the capabilities first, as verbs in the domain's words — "produce
a slot", not "slot route". Name them even when — especially when — the code has no such thing: a
capability smeared across handlers, a store that exists only as scattered SQL. Those are the finds.
What the capabilities stand on (adapters, stores, rules) falls out after.

Do not study the code for this. One glance per slice to say where it lives today, in a line.

`slices.md`, lean:

- **The types** and what good means for each — capability, entry point, adapter, store, rule, view
  (adjust to the codebase; keep it to a handful).
- **What is frozen** while working inside any slice: the public contracts — wire shapes, schema,
  storage keys, every other slice's "exposes".
- **One entry per slice:** its job in a sentence, consumes → exposes, what it stands on, where it
  lives today. Slices already in shape get one line between them.
- **The queue:** the order to work in, bottom-up — a capability can't be made good until what it
  stands on can be handed to it. A judgment until `measure` replaces it.

## measure

Follow [measure.md](measure.md). Gather the cheap signals, roll them up to slices, and answer in
slices, never files: *"produce-a-slot is not contained — it is spread across X and knows how to do
everything it touches"*, not *"route.ts is 500 lines"*. Name the top three and why, rewrite the queue,
and stop. No fixing.

## the ask

The user names something in their own words — "the http layer for program generation". Resolve it to
slices; following the rubric may pull in a slice they didn't name (an entry point can't be made good
if the capability behind it doesn't exist). Say which slices in a line.

From here the architecture, the other slices and the measurements have done their job. Work from
the slice's entry and [rubric.md](rubric.md), and now go deep: read all of the slice's code.

1. **Goal.** Answer the rubric's questions about the slice as it stands. Tell the user, briefly: what
   fails, the shape you are going to, and how done will be measured. Then keep going — stop only if a
   frozen contract has to move.
2. **Pin.** Hold today's behaviour at the slice's outer contract, as the rubric describes.
3. **Reshape.** Smallest steps that keep the pin green, committing as you go if the user has asked
   for commits. Work bottom-up inside the slice too.
4. **Verify.** The project's full check. Then a fresh agent, given only the rubric and the slice's
   code, answers the questions cold. Any "no" is the next step; loop until there are none.
5. **Record.** Update the slice's entry and the queue. Report what changed, what was verified and
   how, and anything found but deliberately not fixed.
