# Jev recording selection

Claude proposes tracks and their order; Qobuz finds up to three streamable recordings
for each proposal. Before writing a slot, Jev selects one supplied recording. Claude
gets that fixed recording plus Jev's chart and mixer plan, and writes only the spoken
copy. See [Jev planning](jev-planning.md). Its schema has no recording ID or mixer decisions. There are no modes, alternate pickers, confidence gates, or automatic
retries. Jev errors, invalid responses and `none` stop the slot with 502. A writer
failure also stops the request. A later voice retry uses the already written slot.

The server uses `TYPESAFE_API_KEY` and `TYPESAFE_MODEL` (default `jev-1.13.0`).
`.env.op` references `op://Developer/pof4-radio-typesafe-proart/credential`. Deployment needs
the production credential from `op://Developer/pof4-radio-typesafe/credential` in the server environment. Credentials never appear in the receipt.

The declarative schema adds nullable `session_slot.selection`. It stores the exact
request, validated response, model, probabilities, token usage and elapsed time,
atomically with the write. Existing slots remain readable. The receipt is server
only; failed selection/write requests are logged and roll back. Production schema
changes use `pnpm db:plan` followed by a reviewed `pnpm db:apply`.

## Labeled evaluation

```sh
op run --env-file=.env.op -- node apps/web/scripts/pick-eval.mts
```

This makes 12 billed Jev calls using synthetic catalog-shaped fixtures, including
live/remix requests, wrong artists, karaoke, equivalent remasters, missing versions,
obscure tracks and instruction-like metadata. IDs are illustrative, not playable.
It never calls Claude, Qobuz, the database, or ElevenLabs.

To save a report, pass the fixture file and a new destination:

```sh
op run --env-file=.env.op -- node apps/web/scripts/pick-eval.mts apps/web/scripts/fixtures/picks.json report.json
```

Reports contain `cases: [{ id, input, acceptable, passed, receipt }]` and are also
valid evaluation inputs. `acceptable` is a set of acceptable recording IDs; `[null]`
means no supplied recording should match. Set these labels by inspecting the prompt
and metadata, independently of Jev's answer. Replay a report with:

```sh
op run --env-file=.env.op -- node apps/web/scripts/pick-eval.mts report.json new-report.json
```

Replay uses the saved inputs and the current rubric/configured model; the old report
retains the original request for comparison. Outputs never overwrite an existing
file. A wrong decision or service failure gives a nonzero exit. The report separates
service errors, no-match decisions, correctness, latency and usage. Passing these
fixtures does not establish musical taste or correctness on arbitrary catalog data.

## Real Qobuz search

```sh
op run --env-file=.env.op -- node apps/web/scripts/pick-search.mts "Play Dreams by Fleetwood Mac, the original studio recording" "Fleetwood Mac" "Dreams" receipt.json
```

This searches Qobuz and calls the same Jev selector as the app, without creating a
session, downloading music or generating speech. A no-match decision writes/prints
its receipt and then exits unsuccessfully. To make a saved receipt into a labeled
case, use its `request.state` as `input` and supply independently reviewed
`acceptable` IDs in a suite's `cases` array.

For real playback, use `pnpm dev`, create a new session, and inspect the slot's
`selection` receipt in Postgres. To exercise the full slot route against a running
local app, `pick-slot-smoke.mts <origin>` creates one labeled session, uses real
Qobuz hits, calls Jev and Claude, voices the slot, and checks persisted selection
and retry identity. This is billed and retains its test session and any voice clip.

The nullable schema column has been applied. Railway `radio-web` has the production
key and pinned model, set with deployment skipped. The infrastructure declaration
preserves the key. The application changes still need deployment.

## Initial recording-selection verification on 2026-09-19

- Jev `jev-1.13.0`: 12/12 labeled fixtures passed; 3 correctly chose no match.
- Median Jev request: 190 ms; maximum: 350 ms; 7,887 input tokens.
- Real Qobuz search: selected `19512574`, “Dreams (2001 Remaster)” from *Rumours*,
  among three streamable recordings in 254 ms.
- Full live slot smoke: session `c14aa8bc-f15d-4064-8787-033b38f5d478`, slot 2;
  Jev selected `19512574` in 292 ms, Claude wrote a talk-up, ElevenLabs voiced it,
  the selection receipt was saved and a repeated request preserved the pick and clip.
- `pnpm check`: 371 tests passed; production build passed.
- Unit and route boundary tests cover malformed responses, fixed writer input/output,
  no alternate recording on errors, saved receipt, and voice-only retries.
