# Radio

An AI radio station over the listener's own records. A listener types an ask; the show is one list
of **slots**: Claude proposes a few songs at a time (the fill), Qobuz search finds the versions of
each, then one slot at a time Claude picks the version, charts it, writes what is said over it and
sets the timing, and ElevenLabs voices it in the same request; each track is pulled once from Qobuz
as an MP3 into the bucket, and the browser plays it — the clips and the tracks on three lanes of one
Web Audio graph, one slot ahead of the listener. Everything produced is **kept forever**. The
browser is the state machine; the server is stateless functions. Sibling of `../dreamweaver` and
built the same way; when in doubt, do what dreamweaver does (its `CLAUDE.md` is the fuller
philosophy).

## Philosophy — minimize cost, maximize simplicity

- One service (`radio-web`) in the **`pof4`** Railway project, sharing the one Postgres (database
  `radio`) and one bucket (`radio-clips`, for the voice clips and the tracks). No worker, no queue:
  nothing runs when nobody is listening. Infra is not in this repo: `../pof4-infra/.railway/railway.ts`
  is the only place Railway resources are declared — edit there, `pnpm plan` → `pnpm apply` **from
  that directory**. Secrets stay `preserve()`d, set via `railway variables`.
- One database, on purpose: `pnpm dev` talks to the same Railway Postgres (and bucket) as prod over its
  public proxy.
- Fewest moving parts: route handlers, plain `pg` + SQL at the call site (no ORM, no query layer),
  declarative schema diffed and applied from the dev machine (`pnpm db:plan` / `db:apply`, no
  migration files — `db/schema/*.sql`).
- **Always minimize dependencies.** Before adding a package, ask whether `fetch`, Web Crypto, the
  platform, or thirty lines of our own would do: Qobuz is plain `fetch` against its web player's own
  API (`api/sessions/qobuz.ts`, the app id + secret read out of the player's bundle), the bucket
  client is AWS SigV4 by hand (`apps/web/src/lib/sigv4.ts`, tested against the AWS vectors), the
  weather and the headlines are two public feeds read by hand. No AWS SDK, no auth or
  state-management library. Same rule for services: if the browser can do it (playback, audio
  mixing), the server doesn't.
- **WET over DRY, lib at the level that uses it.** Code lives beside the route that reads it; a
  helper is promoted one level up only when a *third* consumer appears. A hot path stays one
  readable file — no small functions that obfuscate straight-line code. Extract only pure judgment
  worth table-testing. `.claude/rules/coding-standards.md` governs (WET → SOLID → YAGNI, TDD).
- **The domain's words only.** In code the show is made of: track, tags, slot, proposal, hits, pick,
  chart, copy, timing, clip, fill, plan, the clock. Retired with the first two builds: record, song,
  card, candidate, playlist, segment, program — as identifiers; prose may still say "record" for the
  thing on the shelf, and the writer's timing number stays `recordUnderMs` (the writer's word, and
  the schema's). `docs/domain.html` §"What goes away" is the map.
- Private behind Guard (`guard.pof4.com`): one gate, `apps/web/src/proxy.ts` (**temporarily open** —
  `GUARD_OPEN = true` there, so friends can test without a login — only `/settings` and the voice
  preview still ask for the passkey; flip it back). Exempt = `api/health` + static, nothing else. No
  user table. Dev runs at `https://dev.radio.pof4.com:3000` because the cookie is bound to `pof4.com` —
  no localhost bypass.

## Where things live

Three places, each owning what it alone needs:

- **`apps/web/src/lib/`** — app-level process concerns, shared by the station and the control room:
  `env` (zod over `process.env`, read lazily), `db` (one `pg.Pool`, `pool()`), `claude` (one client, no
  SDK retries), `bucket` (`put`, `open`, `head`) + `sigv4`, `guard`, `voices` (the roster's shape:
  schema, models, `ttsBody` — pure, client-safe), `identity` (call letters, city, on-air name — pure),
  `clock` (break every, fill, low water — pure), `settings` (the three loaders, `loadVoices` /
  `loadIdentity` / `loadClock`, server only: a client component that imports a module touching the
  pool drags `pg` into the browser bundle and the build fails).
- **`apps/web/src/app/api/sessions/`** — the server, one folder: the routes and, beside them, the
  files they read: `params` (the two bodies), `shapes` (the zod each Claude call is held to:
  `Proposal`, `Written`), `fill` (the proposer call, the search, the dedupe), `write` (the writer's
  brief and call), `rules` (the clock's law: `isBreak`, `legalIdDue`, `checkSlot`), `qobuz` (search
  and the pull, on the listener's token), `weather`, `headlines`, `doc` (the slot on the wire). Tests
  sit next to the pure parts.
- **`apps/web/src/app/(app)/`** — the browser: the home (`page.tsx` + `home-desk.tsx`), the session
  page (`sessions/[id]/`: `session-view` (the loop), `loop` (pure: `nextMove`), `player`, `rundown`,
  `use-deck`, `plan`, `transport`, `types`), and `lib/` for what those share (`voice-cache` — clips
  and tracks fetched once as blobs, `voice-store`, `dj-picker`, `ui`).
- **`apps/web/src/app/(settings)/`** — the control room, desktop-wide: the identity, the clock and the
  voice roster, every row in the `settings` table. `/api/tts/preview` is its "hear it".

`docs/sessions.html` is the API dance and `docs/domain.html` the data model — the source of truth for
how the pieces talk; keep them current. `docs/slot-first.md` is why the show is shaped this way.

## How it works (the shape)

**Qobuz gives us the tracks.** There is no developer API: `qobuz.ts` speaks the web player's own
API with the listener's token (`QOBUZ_TOKEN`, their own from play.qobuz.com — a personal player, one
account) and the app id + secret the player ships in its bundle (`QOBUZ_APP_ID` / `QOBUZ_SECRET`
pinned; when the pair stops signing, the bundle is scraped and checked against a known track). Search
finds each proposal's versions, streamable hits only, up to three. A track is pulled **once**, MP3
320, into the bucket at `tracks/<qobuz id>.mp3` with a `track` row carrying Qobuz's own tags — bucket
first, row second, so a row always means the bytes exist (and a `HEAD` rebuilds a missing row without
a download) — and is shared by every session after. Playback streams from the bucket through the
app; Qobuz is never touched at play time. Ported from Sei969/qobuz-dl's MP3 path; the FLAC tiers are
not ours.

**The session is the show, and the show is a list of slots.** `POST /api/sessions` is creation only
and instant: one `session` row. `GET /api/sessions/:id` is the snapshot: the clock and every
`session_slot` in order, status per slot *derived from presence* (proposed → written → voiced), each
pick marked `held` when the bucket holds it, never audio, never the receipts. Then two **rungs**, each
idempotent and under the session's row lock (`for update nowait`; a second producer gets 409), and
the track pull, lock-free:

- `POST …/fill` — Claude **proposes** `clock.fill + 2` songs by name knowing what has played and what
  is coming up (a repeat is dropped), Qobuz search finds each one's versions, and one row per proposal
  with a hit is appended: the proposal and its hits, nothing judged. Nothing found → 502 with the
  reasons.
- `POST …/slots/:seq` `{ clockMs, again? }` — **write, then voice**, one request. The clock says
  whether this slot is the break (`isBreak`: slot 1 and every `breakEvery` after) and whether the
  legal ID is due (`legalIdDue`: slot 1, or the hour turned since the last break). The brief carries
  the ask, the clock, the identity, the DJ, the proposal and its hits as a menu, the last three slots'
  copy, everything played, another DJ's chart of any hit from an earlier session, and for a break the
  weather (NWS) and the headlines (Google News; a failed pull is logged and the show goes on). **One**
  Claude call returns the pick (which hit plays), the chart (the ramp and whether it is sure, the
  post, the outro, the feel), the copy (a kind, the words, the break's lead line, why) and the timing
  (`recordUnderSec`, `voiceInSec`). `checkSlot` holds it to the clock after — the clock's break is
  the break, a break elsewhere is a sweeper, a talk-up needs a ramp ≥ 7 s the writer is sure of,
  no words is a segue — every step-down kept as the slot's `fallback`; a writer that gives nothing
  usable twice makes the slot a no-chart segue on the first hit. One `update` lands the write. Then
  the clip: legal ID + words + lead line through ElevenLabs in the session's voice, `PUT` to
  `sessions/<session>/<seq>.mp3`, the row stamped — bucket first, row second; a segue is stamped
  voiced with no clip. A voicing that fails after the write **keeps the write** (502 with the slot as
  written; the next request voices only). `{ again: true }` is another take under a new key. `GET
  …/clip` streams the bytes, immutable.
- `POST …/slots/:seq/track` — the slot's pick, held: a `track` row → held; else the bucket's `HEAD`
  finds the bytes → the row rebuilt from the pick's tags; else Qobuz → `PUT` → row. **Not under the
  session lock**: the track is the library's, and the browser fires this the moment the pick is
  known — a race costs one duplicate download of the same bytes. `GET` streams the bytes, immutable.

**The clock is a setting.** `settings.clock` is `{ breakEvery, fill, lowWater }`, edited on
`/settings`, read per request by the fill, the slot rung and the snapshot; no default in code — a
missing row is a fault naming it. Defaults as seeded: 5, 6, 2.

**The prompts are inline** at each call site (`fill.ts`, `write.ts`) — structured outputs via
`messages.parse` + `zodOutputFormat`, one zod shape per call in `shapes.ts`; the fill's count is
enforced with `numbered(key, n, item)` (song1…songN) because the grammar does not bound arrays.

**The loop lives in the browser, one slot ahead.** The session page fetches the snapshot and asks
`nextMove` (`loop.ts`, pure) for the one call: a fill when there are no slots or the proposed ones
are down to `lowWater`; else the first unvoiced slot, but only one ahead of the cue in the deck — so
before play only slot 1 is written, and once slot *k* is on air slot *k*+1 is. It folds the response
in, pulls the track the moment a pick is known (not awaited), and repeats; each move once per page
life, a reload retries. Resume is free: a reload lands in the same place. One **deck**
(`use-deck.ts`) holds one cue: loading it fetches its clip and its track side by side, reads the
clip's length, lays the **plan** (`plan.ts`, pure — the writer's two numbers, the chart's ramp, plus
house constants: bed gain and fades, the beat before the vocal, the duck), and runs three lanes from
one clock in one Web Audio graph — the mic (the voice `<audio>`), the bed (a looping buffer) and the
track (its MP3 in its own `<audio>` through a gain node), the bed's and the track's gain scheduled on
the audio clock, the track started at its mark and ducked under the voice. The transport is
start/stop; rows (voiced and held) and ⏮ ⏭ pick the slot; the track ending advances to the next
voiced slot (`transport.ts`, pure), whose track was pulled while this one played. First sound after
two model calls: the fill, then slot 1.

## Working here

- Line endings are LF everywhere: `.gitattributes` (`* text=auto eol=lf`) overrides any local
  `core.autocrlf`; `.editorconfig` and Biome write the same. Phantom "modified" files after a fresh
  clone → `git add --renormalize .` once.
- Node via fnm (`.node-version`), pnpm workspaces. `pnpm check` (= lint + format:check + typecheck +
  test) then `pnpm --filter web build` is the pre-push gate; CI runs the same.
- Tests: pure logic only (`*.test.ts` next to the code: the rules, the shapes, the fill's dedupe and
  search query, the writer's brief, the slot on the wire, the clock, the loop, the plan, the
  transport, the weather and headline readers, the roster, the Qobuz bundle parser and signature, the
  SigV4 signer against the AWS vectors). Anything needing Postgres, Qobuz, Claude, ElevenLabs or the
  bucket is verified live: `apps/web/scripts/bucket-smoke.mts` proves the signer (PUT, GET, HEAD)
  against the real bucket, `qobuz-smoke.mts` the whole track path against Qobuz (search → signed URL
  → the MP3 in the temp dir), each run with plain `node` under `op run` — so nothing they import may
  use the `@/` alias or TS syntax Node strips badly (parameter properties). Red test first.
  `specs/004-slot-first/quickstart.md` is the live script for the show itself.
- Env for local dev comes from 1Password via `op run --env-file=.env.op` (see that file for the vault
  items; the five `BUCKET_*` come from `pof4-radio-clips-bucket`, the three `QOBUZ_*` from
  `pof4-radio-qobuz`).
- Qobuz: `QOBUZ_TOKEN` is the listener's own web-player token (play.qobuz.com localStorage,
  `localuser.token`) and rotates whenever Qobuz changes auth — a 401 from every call means paste a
  fresh one into the 1Password item and set it on `radio-web` again; nothing else moves. A 400
  "Invalid Request Signature" means the app pair rotated — the code scrapes the new one on its own,
  `qobuz-smoke.mts` prints it for pinning. A 30-second file where a track should be is the plan
  lapsing (`download` refuses samples).
- `db/` at the root is the database: `schema/*.sql` (one file per table: `session`, `session_slot`,
  `track`, `settings`, plus `common.sql`) and three scripts run with plain `node` — `schema.mts`
  (`pnpm db:plan` / `db:apply`), `sql.mts` (`pnpm db:sql "select …"`, read-only), `clear.mts`
  (`pnpm db:clear` wipes sessions and their slots; `--tracks` wipes the track rows too — the bytes
  stay in the bucket and a row comes back by `HEAD` the next time a slot picks that track). No
  workspace packages: `apps/web` is the one app and imports nothing from outside itself. The
  `settings` table still carries `prompt.*` rows from the first build; nothing reads them.
- The dev server caches the pool, the Claude client and the bucket client on `globalThis` across HMR:
  a change to one of those clients' *shape* (a new method) needs the dev server restarted, not just
  saved.
- `specs/001–003` and `docs/handoff.*`, `docs/the-program.html`, `docs/superpowers/` describe the
  first build (deleted 2026-09-03), and the segment world (2026-08-31 → 2026-09-04) lives on in
  `specs/004-slot-first/` as the thing that was refactored away — history, not guidance.
