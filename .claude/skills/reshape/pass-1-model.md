# Pass 1 — Model

**Read-only. No proposals.** The job is to see what is here — the business and the code — clearly
enough that someone who has never opened the target could design its replacement from your document
alone. Proposing a fix now anchors the design to the first idea and hides what you have not understood
yet. If a solution occurs to you, put it under "Hunches" at the very end, one line each.

Output: `docs/reshape/<slug>/model.md`.

## Gather

Read, in this order, and keep a list of what you read for the document's appendix:

1. The target, whole. Not excerpts.
2. **Inward**: everything it calls that lives in the repo, far enough to know each collaborator's
   contract, failure modes and timeouts.
3. **Outward**: every caller — the UI or worker that invokes it, and what that caller does with each
   possible response. The caller's expectations are the real contract.
4. The tables it touches (the schema files), the docs that describe the feature, and the tests that
   exist near it.
5. Siblings: other routes or modules doing a similar job. Note where the same idea is already solved
   cleanly, and where the same mess is repeated.
6. The measurements: the project's complexity command (here `pnpm complexity`), line counts, deepest
   nesting, longest function, parameter counts, and the import list of the target.

Use subagents for wide reading if the target is a feature rather than a file, but read the target
itself yourself.

## Write `model.md`

Use these sections. Keep each tight; prefer tables and short bullets to prose. Use the repo's own
domain words — and if the house rules list retired words, don't revive them.

### 1. What it does
Five to seven bullets, hot path only, in order. No detail that a newcomer doesn't need to follow the
next sections.

### 2. Intent and contract
- **Intent** in one or two sentences, in the product's terms.
- **Input**: what the caller supplies; what the code looks up for itself.
- **Output**: every distinct ending — success shapes and each failure — with what the caller does
  about each one.
- **Side effects**: rows, files, messages, external calls, logs something depends on.
- **Guarantees**: idempotency, ordering, what survives a failure, what a retry does.

### 3. The business domain
- **Things**: the entities and values in play, each in a line, with its identity and who owns it.
- **Lifecycles**: for anything with a status — stated or derived from which fields are present — draw
  the states and transitions. This is where shapes are found; do not skip it because no `status` column
  exists.
- **Rules**: every business rule, numbered, in the product's words. For each: where it is enforced
  today (file:line) and *how* — conditional, ordering, or transaction shape. Hunt specifically for the
  rules that are only ordering or transaction shape; ask of every savepoint, lock, `await` order and
  "X first, Y second": *what promise to the product does this keep?*
- **Vocabulary**: the terms, one line each, and any place the code uses two words for one thing or one
  word for two.

### 4. The code as it stands
- **Collaborators**: each outside thing (database, APIs, bucket, clock, randomness, config): what it is
  asked, how it fails, timeouts, whether it is injected or reached for.
- **Statements**: every SQL statement or store call, numbered: what it reads or writes, and why it
  exists — the name it would have if it were a function.
- **Transaction and concurrency**: where the transaction begins and ends, locks, savepoints, what is
  inside the lock that is slow.
- **Responsibility inventory**: a table of every distinct responsibility found in the target →
  its kind (transport / orchestration / rule / data shaping / persistence / integration /
  observability) → line ranges. This table is the raw material of the design.
- **Duplication and drift**: values built more than once, the same rule stated in two places, logic
  that a sibling module also has.

### 5. Tests and measurements
- What is pinned by tests today, per responsibility; what is only verified live; what is not verified.
- The baseline numbers, in a table that `build` will extend.
- Which production failure stories (a collaborator down, a race, a retry after partial success) can
  currently be demonstrated without live services. Usually none — say so.

### 6. Tensions
- House rules or conventions that pushed the code into this shape, quoted, with the consequence.
- Constraints that are real and must survive the redesign (deployment, a wire format a client depends
  on, a persisted shape, performance of the hot path).

### 7. Open questions
Only questions whose answer changes the design and that the code cannot answer. Give your best guess
for each, so the design pass can proceed on the guess if the owner is away.

### 8. Hunches
One line each. No elaboration.

### Appendix
Files read; commands run.

## Review

Hand a fresh agent `model.md`, the target's path and `concepts.md`, and ask it to:

- open the target and find **a responsibility, a rule, an ending or a side effect the model missed**;
- find any claim in the model the code contradicts;
- say whether it could design a replacement from this document without opening the code, and if not,
  what it would have to go and look up.

Fold in what it finds. Then stop and give the owner the path and a five-line summary: the intent, the
shape of the lifecycle, the count of rules and how many are enforced only by ordering or transaction
shape, the worst tension, and the open questions.
