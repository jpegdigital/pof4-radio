# Radio

An AI radio station over the listener's own records. A listener types an ask; the show is one list
of **slots**: Claude proposes a few songs at a time (the fill), Qobuz search finds the versions of
each, then one slot at a time Jev picks the recording, estimates its chart and decides the mixer plan.
Claude writes the spoken copy and ElevenLabs voices it in the same request; each track is pulled once from Qobuz
as an MP3 into the bucket, and the browser plays it — the clips and the tracks on three lanes of one
Web Audio graph, one slot ahead of the listener. Everything produced is **kept forever**. The
browser is the state machine; the server is stateless functions. Sibling of `../dreamweaver` and
built the same way; when in doubt, do what dreamweaver does (its `CLAUDE.md` is the fuller
philosophy).

## Philosophy — minimize cost, maximize simplicity

- One service (`radio-web`) in the **`pof4`** Railway project, sharing the one Postgres (database
  `radio`) and one bucket (`radio-clips`, for the voice clips and the tracks). Two bounded cron workers prepare news/weather; there is no queue. See docs/prepared-content.md. Infra is not in this repo: `../pof4-infra/.railway/railway.ts`
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
  weather is plain fetch; headlines use `fast-xml-parser` for bounded RSS/Atom evidence (DTD/entity
  declarations rejected), read once per worker run with ordinary fetch. No AWS SDK, no auth or
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
  preview and news preview still ask for the passkey; flip it back). Exempt = `api/health` + static, nothing else. No
  user table. Dev runs at `https://dev.radio.pof4.com:3000` because the cookie is bound to `pof4.com` —
  no localhost bypass.

## Where things live

Three places, each owning what it alone needs:

- **`apps/web/src/lib/`** — app-level process concerns, shared by the station and the control room:
  `env` (zod over `process.env`, read lazily), `db` (one `pg.Pool`, `pool()`), `claude` (one client, no
  SDK retries), `bucket` (`put`, `open`, `head`) + `sigv4`, `guard`, `voices` (the roster's shape:
  schema, models, `ttsBody` — pure, client-safe), `identity` (call letters, city, on-air name — pure),
  `clock` (break every, fill, low water — pure), `news` (source roster, configuration and receipt),
  `settings` (`loadVoices` / `loadIdentity` / `loadClock` / `loadNews`, server only: a client component that imports a module touching the
  pool drags `pg` into the browser bundle and the build fails).
- **`apps/web/src/app/api/sessions/`** — the server, one folder: the routes and, beside them, the
  files they read: `params` (the two bodies), `shapes` (the zod each Claude call is held to:
  `Proposal`, `Written`), `fill` (the proposer call with its two catalog tools, the search, the
  dedupe), `write` (the writer's
  brief and call), `rules` (the clock's law: `isBreak`, `legalIdDue`, `checkSlot`), `qobuz` (search
  and the pull, on the listener's token), `weather`, `headlines` (the news worker's one read: fetch/evidence),
  `headline-choice` (Jev choices over prepared facts), `generation` (retained audit), `doc` (the slot on the wire). Tests
  sit next to the pure parts.
- **`apps/web/src/app/(app)/`** — the browser: the home (`page.tsx` + `home-desk.tsx`), the session
  page (`sessions/[id]/`: `session-view` (the loop), `loop` (pure: `nextMove`), `player`, `rundown`,
  `use-deck`, `plan`, `transport`, `types`), and `lib/` for what those share (`voice-cache` — clips
  and tracks fetched once as blobs, `voice-store`, `dj-picker`, `ui`).
- **`apps/web/src/app/(settings)/`** — the control room, desktop-wide: the identity, the clock and the
  voice roster and news desk, every row in the `settings` table. `/api/tts/preview` is its "hear it";
  `/settings?news=1` previews prepared options through the shared Jev selector at `/api/news/preview` without writing or TTS.

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
  pick marked `held` when the bucket holds it, news receipts included but never audio. Then two **rungs**, each
idempotent and under the session's row lock (`for update nowait`; a second producer gets 409), and
the track pull, lock-free:

- `POST …/fill` — Claude **proposes** `clock.fill + 2` songs by name knowing what has played and what
  is coming up (a repeat is dropped), **with the catalog in the room**: two tools on the call,
  `search` (Qobuz `catalog/search`, typed to albums / tracks / artists / playlists or untyped for
  all four) and `album` (`album/get`, the tracks in order), so a record it has never heard of — a
  release after its training — is a lookup, not a guess, and an album named in the ask is played in
  its order across fills (the SDK's tool runner loops the lookups, `LOOKUPS` at most, and the last
  message is the structured answer). Then Qobuz search finds each one's versions, and one row per
  proposal with a hit is appended: the proposal and its hits, nothing judged. Nothing found → 502
  with the reasons.
- `POST …/slots/:seq` `{ clockMs, again? }` — **write, then voice**, one request. The clock says
  whether this slot is the break (`isBreak`: slot 1 and every `breakEvery` after) and whether the
  legal ID is due (`legalIdDue`: slot 1, or the hour turned since the last break). The brief carries
  the ask, the clock, the identity, the DJ, the proposal and the fixed recording selected by Jev, the last three slots'
  copy, everything played, Jev's fixed mixer plan and word budgets, and for a break the
  latest prepared NWS weather and up to two prepared stories selected by Jev's headline ranking and count choices. **One Jev Choice call** selects a recording from the hits (or fails if none fits). Its request,
  response, model, usage and elapsed time are retained in `session_slot.selection`. No alternative
  picker or automatic retry. Jev then answers five chart questions in parallel (DJ finish point at 0–5 seconds or beyond 5,
  ending, energy, tempo, mood), followed by one action choice over code-built executable mixer
  plans. All judgments and probabilities are retained under selection.planning. A zero finish point
  offers dry/no-voice actions; playback aligns measured clips using finishAtMs. Estimates are not audio measurements. **One unified** Claude
  call returns only words and leadLine, combining news, weather and music with thinking disabled and fixed word budgets. checkSlot fails on invalid copy or a clock mismatch; it never changes
  Jev's action. A Jev segue skips prose and TTS. One update lands the plan, copy and receipts. Then
  the clip: legal ID + words + lead line through ElevenLabs in the session's voice, `PUT` to
  `sessions/<session>/<seq>.mp3`, the row stamped — bucket first, row second; a segue is stamped
  voiced with no clip. A voicing that fails after the write **keeps the write** (502 with the slot as
  written; the next request voices only). `{ again: true }` is another take under a new key. `GET
  …/clip?take=…` streams that exact retained take, immutable; unknown keys return 404.
  Playback always uses the saved production without a freshness preflight or alternate mode.
- `POST …/slots/:seq/track` — the slot's pick, held: a `track` row → held; else the bucket's `HEAD`
  finds the bytes → the row rebuilt from the pick's tags; else Qobuz → `PUT` → row. **Not under the
  session lock**: the track is the library's, and the browser fires this the moment the pick is
  known — a race costs one duplicate download of the same bytes. `GET` streams the bytes, immutable.

**The clock is a setting.** `settings.clock` is `{ breakEvery, fill, lowWater }`, edited on
`/settings`, read per request by the fill, the slot rung and the snapshot; no default in code — a
missing row is a fault naming it. Defaults as seeded: 5, 6, 2.

**News and weather are prepared before sessions.** Railway cron workers append dated editions to
`news_entries` and `weather_entries`; source evidence and reviews are retained. The web request only
reads the latest saved editions. Jev compares headline options against the prompt and reserved
session history and chooses a count of zero, one, or two; code takes that many in probability order.
The session lock serializes reservations; `session_slot.generation` retains choices before writing,
so later breaks cannot reuse stories even if playback never happens. It retains exact model inputs,
outputs, probabilities, source edition IDs/dates, Claude's brief, and every voice take's text/settings/key.
Claude writes one coherent news, weather and music script, then ElevenLabs makes one take. A failed
writer keeps the reservation; a failed voice keeps the script. No request-time fetching or alternate
news-free generation exists. See `docs/prepared-content.md` for the complete contract.

`session_slot.news` is the public source receipt. `POST …/slots/:seq/news` records every
included story after a complete live read of the matching clip; generated does not imply heard.
Playback always uses the saved script and audio. Explicit revoice appends another take.

**Prompt prose lives in flat `apps/web/prompts/*.prompt` Handlebars templates.**
`apps/web/src/lib/prompts/index.ts` is the typed registry; its adapters validate template
variables with Zod and own context formatting. Strict rendering rejects undeclared variables
(including inactive branches), missing inputs and blank output. Values are inserted once without
HTML escaping. Short field/choice/action labels and output schemas remain typed in code.
Call sites supply context and own API execution. `pnpm prompt:preview --list` lists templates;
`pnpm prompt:preview <name> [variables.json]` renders one without a model call. Next traces the
files for deployment; plain-Node workers ship the same directory. See `docs/prompts.md`.

**The loop lives in the browser, one slot ahead.** The session page fetches the snapshot and asks
`nextMove` (`loop.ts`, pure) for the one call: a fill when there are no slots or the proposed ones
are down to `lowWater`; else the first unvoiced slot, but only one ahead of the cue in the deck — so
before play only slot 1 is written, and once slot *k* is on air slot *k*+1 is. It folds the response
in, pulls the track the moment a pick is known (not awaited), and repeats; each move once per page
life, a reload retries. Resume is free: a reload lands in the same place. One **deck**
(`use-deck.ts`) holds one cue: loading it fetches its clip and its track side by side, reads the
clip's length, lays the **plan** (`plan.ts`, pure — Jev's timing numbers, the chart's ramp, plus
house constants: bed gain and fades, the duck), and runs three lanes from
one clock in one Web Audio graph — the mic (the voice `<audio>`), the bed (a looping buffer) and the
track (its MP3 in its own `<audio>` through a gain node), the bed's and the track's gain scheduled on
the audio clock, the track started at its mark and ducked under the voice. The transport is
start/stop; rows (voiced and held) and ⏮ ⏭ pick the slot; the track ending advances to the next
voiced slot (`transport.ts`, pure), whose track was pulled while this one played. First sound after
the fill and slot 1 (a full break includes prepared news and weather). **iOS in the background** (Safari hidden, the screen
locked): the graph is made under a `"playback"` audio session (`navigator.audioSession`, iOS 17.5+ —
WebKit interrupts an `AudioContext` on hide under any other type, and the ringer switch silences
it), each lane is seeked to the real head when its start fires (a hidden page's timers run up to a
second late; `offsetsAt`), a call taking the audio holds the deck and it plays again from the head
when the audio comes back (`onContext`, phase `held`), on return the record's own clock is checked
against the head and the mix laid again from the record if they came apart (`realign`) else the
context is resumed by hand (WebKit bug 263627), and the lock screen is the Media Session
(`media-session.ts`): the pick's tags, play/pause/⏮/⏭ into the same transport, what it shows the
transport's rule (`lockScreen`). Three clocks — wall, audio, the record's element — tied once at
start; every rule for their coming apart is pure and tested in `transport.ts`.

## Jev recording selection

`pick.ts` uses plain fetch to TypeSafe. `TYPESAFE_API_KEY` comes from
`op://Developer/pof4-radio-typesafe-proart/credential`; `TYPESAFE_MODEL` pins `jev-1.13.0`.
Claude proposes songs and their order; Jev chooses the supplied Qobuz recording and its mixer plan.
`Written` contains only words and leadLine. See `docs/jev-planning.md` for planning and timing limits. See `docs/jev-selection.md` for the labeled evaluation and
real Qobuz search scripts. Selection failures stop the slot with 502.

## Working here

- Line endings are LF everywhere: `.gitattributes` (`* text=auto eol=lf`) overrides any local
  `core.autocrlf`; `.editorconfig` and Biome write the same. Phantom "modified" files after a fresh
  clone → `git add --renormalize .` once.
- Node via fnm (`.node-version`), pnpm workspaces. `pnpm check` (= lint + format:check + typecheck +
  test) then `pnpm --filter web build` is the pre-push gate; CI runs the same.
- Tests: pure logic only (`*.test.ts` next to the code: the rules, the shapes, the fill's dedupe,
  search query, brief and the text its tools hand the proposer, the writer's brief, the slot on the
  wire, the clock, the loop, the plan, the transport, the weather and headline readers, the roster,
  the Qobuz bundle parser, signature and catalog parsers, the SigV4 signer against the AWS vectors). Anything needing Postgres, Qobuz, Claude, ElevenLabs or the
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
  `track`, `settings`, `headline_snapshot`, `headline_story`, `session_news_exposure`, plus `common.sql`)
  and three scripts run with plain `node` — `schema.mts`
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
