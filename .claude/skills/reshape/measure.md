# Measure

Where to look next. This judges nothing: it collects cheap signals, lays them over `slices.md`, and
names the slices the code models worst. A high number is a reason to read, never a target to drive
down — a slice is done when the rubric says so, not when a number moves.

## The signals

| Signal | What it hints at |
|---|---|
| **Long file, long function** | More than one job in one place. |
| **Cognitive complexity** per function | Sequencing, branching and recovery tangled together. |
| **Kinds of I/O in one file** (SQL, HTTP out, object storage, SDK calls, framework request/response) | A capability that knows *how*, not just *what*. The strongest single hint. |
| **Logic with no test beside it** | Usually not laziness: it couldn't be tested cheaply. |
| **Heavy test setup** (module mocks, patched globals, long arrange blocks) | A seam is missing under that test. |
| **Churn × size** (commits touching a big file) | Where the tangle is actually costing something. Big and never touched can wait. |
| **Fan-in of a contract** (how many files know a table, a vendor's shape, a wire shape) | Leaked knowledge; the blast radius of a change. |

Get them with whatever the project already has — the linter's complexity rule run one-off, `wc`,
`grep`, `git log`. Don't install anything and don't change config. Skip generated code, fixtures,
styles and the tests themselves.

## Reading them

1. Roll every file up to its slice. A file that belongs to no slice, or to two, is itself a finding —
   and a slice that has no home in the code at all is the biggest one.
2. Rank slices where several signals agree. One loud number alone is a maybe; three quiet ones
   together are a yes.
3. Respect the order: if a high-ranking capability stands on a store or adapter that doesn't exist
   yet, that comes first.
4. Report the top three **as slices**, one or two lines each, in terms of the model: what the slice
   should be, and how the code fails to contain it. Files and numbers are supporting evidence in
   passing, not the headline.
5. Rewrite the queue in `slices.md`. Stop there.
