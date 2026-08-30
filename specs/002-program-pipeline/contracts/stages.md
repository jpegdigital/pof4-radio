# Contracts: the maker's stages

All routes live in `apps/web/src/app/(program)/program/make/[stage]/route.ts`, sit behind Guard
like the rest of `/program`, and answer **404 in production** (`NODE_ENV === "production"`) —
they write into the app's own `public/` tree. JSON in, JSON out. File shapes are in
[data-model.md](../data-model.md).

## POST /program/make/{stage}

`stage ∈ discover | enrich | log | script | voice`. The body is optional and only `discover`
reads it. Each stage reads its input file(s), writes its output file(s), and returns what it wrote.

| stage | reads | writes | returns |
|-------|-------|--------|---------|
| `discover` | body (a `request.json`) | `request.json`, `picks.json` | `picks.json` |
| `enrich` | `picks.json`, `cards/*` | `cards/<id>.json` (new or `?refresh=1`), `picks.json` (dropped) | `{ cards: Card[], dropped: Dropped[], reused: string[] }` |
| `log` | `request.json`, `picks.json`, `cards/*` | `log.json` | `log.json` |
| `script` | `request.json`, `picks.json`, `cards/*`, `log.json` | `script.json` | `script.json` |
| `voice` | all of the above, `script.json` | `clips/slot-<seq>.mp3`, `program.json` | `program.json` |

Query: `?refresh=1` on `enrich` re-enriches every record in `picks.json`.

Responses:

- `200` the stage's output (above), plus `timing: { ms }` and, for Claude stages, `usage`
  (input/output/cache tokens, summed for `enrich`).
- `400 { error }` invalid body (`discover`), or a malformed input file — the message names the file
  and the zod path, e.g. `"log.json: slots[2].intro — invalid enum value"`.
- `409 { error: "missing: picks.json" }` the stage's input file does not exist yet.
- `422 { error }` a stage completed its call but the result is unusable: fewer than `MIN_RECORDS`
  after resolution/enrichment; `checkLog()` found a violation it could not downgrade.
- `502 { error }` an upstream failure (Claude, Spotify, ElevenLabs) — the message is the upstream's.
- `404` in production.

Typical latency: `discover` 20–60 s, `enrich` 30–90 s (parallel), `log` 15–40 s, `script` 30–60 s,
`voice` 30–90 s. The page uses no timeout shorter than 180 s.

## GET /program/make/status

Returns which stage files exist and when they were written, so the page can paint the pipeline
on load and offer "re-run from here":

```json
{ "files": { "request.json": "2026-08-30T20:10:00Z", "picks.json": "…", "cards": 12,
             "log.json": null, "script.json": null, "program.json": null } }
```

## Static files (served by Next from `public/`)

- `GET /program/make/program.json` — the player's input (`program.tsx`).
- `GET /program/make/clips/slot-<seq>.mp3` — the voiced clips.
- `GET /program/make/{request,picks,log,script}.json`, `cards/<id>.json` — for the operator's
  inspection; the maker page links to them.

## Page: /program/make

Client page. A text box for the request (station identity and DJ pre-filled from the roster on
the server), **Make** (runs the five stages in order, showing each one's status and output as it
lands), and one **Run** button per stage for re-runs. Edits to the files happen in the editor,
not on the page — the page only runs stages and shows results.

## Retired

- `POST /api/program/clock` — removed; its two prompts move into `make/prompts.ts` as the log
  and script briefs.
- `scripts/program-prep.mjs`, `scripts/clock-prep.mjs` — removed. `scripts/sweepers-prep.mjs` stays.
- `manifest.ts`'s `Manifest`/`Clock` types and adapters — removed; `PROGRAM_URL`, `clipUrl`, `BED`,
  `PROGRAM_START_MS` remain.
