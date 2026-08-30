# Research: Program Pipeline

No `NEEDS CLARIFICATION` markers remained in the Technical Context; this records the decisions
that shaped the plan and what was rejected.

## 1. Where the pipeline runs: route handlers driven by a page, not a script

- **Decision**: One `POST /program/make/[stage]` route handler per stage, inside the
  `(program)` route group, plus a `/program/make` page that runs them in order (or one at a time).
  Stage output is written to `apps/web/public/program/make/`, which `next dev` serves as static.
- **Rationale**: Spec FR-001 asks for containment in `/program`. A `scripts/*.mjs` file can't import
  the app's TypeScript (`lib/claude.ts`, `lib/spotify.ts`) without a runner, and Node 24's type
  stripping needs `.ts` import specifiers that the app's tsconfig doesn't allow. Route handlers reuse
  everything and match the repo's shape (stateless functions; the browser sequences).
  `next dev` serves files added to `public/` at runtime, so the player sees a fresh program without
  a restart.
- **Alternatives**: (a) keep `scripts/clock-prep.mjs`-style Node scripts — duplicates Spotify/TTS
  code and lives outside the route group; (b) one long-running `POST /program/make` doing all
  stages — no per-stage re-run, a 5-minute request; (c) Server Actions — same as (a)'s reuse but
  harder to call from a curl for debugging. Route handlers won.
- **Safety**: the handlers return 404 when `process.env.NODE_ENV === "production"` — they write
  into the app's source tree and must never run on Railway.

## 2. Claude calls: forced tool, adaptive thinking, effort per stage

- **Decision**: `ask(brief, tool, effort)` in `make/ask.ts` — `claude().messages.create` with
  `model: env().CLAUDE_MODEL` (default `claude-opus-5`), `thinking: { type: "adaptive" }`,
  `output_config: { effort }`, `tools: [tool]`, `tool_choice: { type: "tool", name }`,
  `max_tokens: 16000`, `strict: true` on the tool with `additionalProperties: false`. The tool input
  is parsed again by the stage's zod schema (belt and braces; `strict` guarantees shape, zod
  narrows enums/ranges).
- **Rationale**: This is how `/api/program/clock` already works and it produced usable plans; adding
  adaptive thinking is what lets discovery "reason in its own space" and the log stage weigh the
  cards before committing. Effort: `high` for discover/log/script, `medium` for the per-record
  enrichment (recall, not reasoning).
- **Alternatives**: structured outputs via `output_config.format` — equivalent here, but the existing
  code and the browser-side DJ use tools, so one pattern is kept. Batch API for enrichment — cheaper
  but asynchronous; ten parallel calls finish in under a minute, which the spec's 5-minute budget
  absorbs.

## 3. Enrichment: per-record calls, files as the cache

- **Decision**: One call per record (`Promise.allSettled`, concurrency 5 via a tiny semaphore),
  cached at `make/cards/<spotifyId>.json`; `?refresh=1` re-enriches. A rejected or invalid card
  drops the record and lands in `picks.json`'s `dropped[]` for the report.
- **Rationale**: Cards are facts about a record, not a program (spec US3). Files are readable,
  hand-editable, and need no schema change in Postgres — the sandbox rule. Per-record calls give each
  record full attention and isolate failures.
- **Alternatives**: a `card` table in Postgres — right for the live station later, wrong for a
  throwaway sandbox; one call for all records — a single bad answer poisons the batch.

## 4. Timing from known offsets, not searching

- **Decision**: The script returns `legalId?`, `words`, `leadLine?` as separate fields. `voice.ts`
  builds the spoken text as `[legalId, words, leadLine].filter(Boolean).join(" ")` and calls
  ElevenLabs `with-timestamps`. `bedInMs` = alignment start time at character index
  `legalId.length + 1`; `leadMs` = duration − start time at index `text.length − leadLine.length`.
  Both are validated (offset within the alignment, monotonic, `leadMs < durationMs`) and otherwise
  fall back (bed in at 0; hand-off at clip end). Talk-ups never touch alignment: `atMs = introMs −
  clipMs − BEAT_MS`, or the late fallback.
- **Rationale**: Satisfies FR-015/017/018: nothing is located by searching text, and every derived
  number has a defined fallback. Alignment is free on the pregeneration call and makes the
  "song under the last line" trick reliable, which was the user's worry.
- **Alternatives**: separate clips for the legal ID and the lead line — needs a multi-clip break
  element (a reducer change) or mp3 concatenation; constant offsets only (`leadMs = 1500`) — simpler
  but every lead sounds the same; kept as the fallback value rather than the default.

## 5. The log: Claude plans, code validates

- **Decision**: The log brief states the clock rules (from `clock-rules.ts`, so the prompt and the
  validator can't drift), Claude orders the set and assigns treatments, and `checkLog()` then
  enforces the rules that are hard constraints: no talk-up unless `card.introMs ≥
  MIN_TALKUP_INTRO_MS`; no two breaks closer than `MIN_SONGS_BETWEEN_BREAKS`; the opening is a break;
  at most one top-of-hour slot and only when the program crosses the hour. A violation is
  downgraded (talk-up → segue, extra break → sweeper) and recorded as a fallback on that slot.
- **Rationale**: Judgment (which songs deserve a talk-up, where a sweeper resets energy) stays with
  the model; hard rules stay in code, tested, so a creative log can't produce an unplayable one.
- **Alternatives**: fully rule-based log (no call) — loses the ordering judgment; fully trusting
  the model — an unenforced rule is a bug that shows up on air.

## 6. `program.json` is the player's input

- **Decision**: `assemble.ts` writes `{ station, dj, voiceId, startMs, elements: Element[],
  notes: Note[] }`; `program.tsx` fetches it and passes `elements` straight to `useProgram`. The
  `Clock`/`toClockElements` and `Manifest`/`toElements` adapters in `manifest.ts` are removed.
- **Rationale**: The reducer's `Element` is the contract (FR-002); producing it directly removes
  an adapter and lets the rundown render from `notes` without re-deriving anything.
- **Alternatives**: keep `clock.json` as an intermediate — one more shape to keep in sync.

## 7. Model choice

- **Decision**: `claude-opus-5` for every stage (the app's `CLAUDE_MODEL` default).
- **Rationale**: Enrichment is recall of specific records — the step where the bigger model is
  most worth it, and it's paid once per record. Discovery/log/script are a few calls per program.
- **Alternatives**: Sonnet for enrichment — cheaper per call, but more confident wrong intro
  lengths; the card cache already amortises the cost.
