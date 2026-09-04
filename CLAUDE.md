# Radio

An AI radio station over Spotify. A listener types an ask; Claude composes a playlist from it,
writes a program over it (a break, then a talk-up, sweeper or segue for every record), ElevenLabs
voices each slot, and the browser plays it — the clips woven around Spotify tracks played through
the Web Playback SDK. Everything produced is **kept forever**. The browser is the state machine;
the server is stateless functions. Sibling of `../dreamweaver` and built the same way; when in
doubt, do what dreamweaver does (its `CLAUDE.md` is the fuller philosophy).

## Philosophy — minimize cost, maximize simplicity

- One service (`radio-web`) in the **`pof4`** Railway project, sharing the one Postgres (database
  `radio`) and one bucket (`radio-clips`, for the voice mp3s). No worker, no queue: nothing runs when
  nobody is listening. Infra is not in this repo: `../pof4-infra/.railway/railway.ts` is the only
  place Railway resources are declared — edit there, `pnpm plan` → `pnpm apply` **from that
  directory**. Secrets stay `preserve()`d, set via `railway variables`.
- One database, on purpose: `pnpm dev` talks to the same Railway Postgres (and bucket) as prod over its
  public proxy.
- Fewest moving parts: route handlers, plain `pg` + SQL at the call site (no ORM, no query layer),
  declarative schema diffed and applied from the dev machine (`pnpm db:plan` / `db:apply`, no
  migration files — `db/schema/*.sql`).
- **Always minimize dependencies.** Before adding a package, ask whether `fetch`, Web Crypto, the
  platform, or thirty lines of our own would do: Spotify is plain `fetch` (client credentials on the
  server, PKCE by hand in the browser), the bucket client is AWS SigV4 by hand
  (`apps/web/src/lib/sigv4.ts`, tested against the AWS vectors), the weather and the headlines are two
  public feeds read by hand. No Spotify SDK, no AWS SDK, no auth or state-management library. Same
  rule for services: if the browser can do it (tokens, playback, audio mixing), the server doesn't.
- **WET over DRY, lib at the level that uses it.** Code lives beside the route that reads it; a
  helper is promoted one level up only when a *third* consumer appears. A hot path stays one
  readable file — no small functions that obfuscate straight-line code. Extract only pure judgment
  worth table-testing. `.claude/rules/coding-standards.md` governs (WET → SOLID → YAGNI, TDD).
- Private behind Guard (`guard.pof4.com`): one gate, `apps/web/src/proxy.ts` (**temporarily open** —
  `GUARD_OPEN = true` there, so friends can test without a login — only `/settings` and the voice
  preview still ask for the passkey; flip it back). Exempt = `api/health` + static, nothing else. No
  user table. Dev runs at `https://dev.radio.pof4.com:3000` because the cookie is bound to `pof4.com` —
  no localhost bypass.

## Where things live

Three places, each owning what it alone needs:

- **`apps/web/src/lib/`** — app-level process concerns, shared by the station and the control room:
  `env` (zod over `process.env`, read lazily), `db` (one `pg.Pool`, `pool()`), `claude` (one client, no
  SDK retries), `bucket` + `sigv4`, `guard`, `voices` (the roster's shape: schema, models, `ttsBody` —
  pure, client-safe), `identity` (call letters, city, on-air name — pure), `settings` (the two loaders,
  `loadVoices` / `loadIdentity`, server only: a client component that imports a module touching the
  pool drags `pg` into the browser bundle and the build fails).
- **`apps/web/src/app/api/sessions/`** — the server, one folder: the routes and, beside them, the
  files they read: `params` (the knobs), `shapes` (the zod each Claude call is held to), `playlist`,
  `select`, `spotify` (search on the app token), `cards`, `program`, `rules`, `weather`, `headlines`,
  `doc` (the segment on the wire). Tests sit next to the pure parts.
- **`apps/web/src/app/(app)/`** — the browser: the home (`page.tsx` + `home-desk.tsx`), the session
  page (`sessions/[id]/`: `session-view`, `player`, `rundown`, `use-deck`, `plan`, `transport`,
  `types`), the Spotify callback, and `lib/` for what those share (`spotify-account` — PKCE and the
  tokens, `use-spotify-device`, `voice-cache`, `voice-store`, `dj-picker`, `ui`).
- **`apps/web/src/app/(settings)/`** — the control room, desktop-wide: the identity and the voice
  roster, every row in the `settings` table. `/api/tts/preview` is its "hear it".

`docs/sessions.html` is the API dance and `docs/api.html` the data model — the source of truth for
how the pieces talk; keep them current.

## How it works (the shape)

**Spotify gives us control, not audio.** The browser tab *is* the playback device (Web Playback SDK,
Premium account required); each visitor plays through their *own* account. Two token flows, kept
apart: **playback** is the user's token, browser only (PKCE needs no secret, so the whole flow lives
in `(app)/lib/spotify-account.ts`: consent → `/spotify/callback` (a page, not an API route) → tokens
in localStorage, refreshed in place with one shared in-flight refresh, because PKCE rotates the
refresh token and racing refreshes log you out; the server never sees a user token). **Search** is
the app's client-credentials token, server only, inside the playlist rung.

**The session is the show.** `POST /api/sessions` is creation only and instant: the ask and the
voice become a `session` row plus `session_segment` 1 at open. `GET /api/sessions/:id` is the
snapshot: the whole tree, status per segment *derived from presence* (open → playlisted →
programmed → voiced), never audio, never the telemetry receipts. Then three **rungs** per segment,
each idempotent and under the session's row lock (`for update nowait`; a second producer gets 409):

- `POST …/segments/:num/playlist` — Claude **proposes** records by name (wide: six for four), Spotify
  search **hydrates** each into candidates, Claude **composes** the playlist by id (it cannot invent a
  track), `selectTracks` validates and joins. Fewer than `min` kept → 502 with the dropped reasons.
- `POST …/segments/:num/program` — the **cards** (the `card` table first, keyed by Spotify id and shared
  by every session; the missing ones made now, in parallel; a refusal retried once, then no card and
  that slot can only be a segue), then **one** Claude call writes the whole segment: a kind
  (break / talkup / sweeper / segue), the words, the break's lead line, two timing numbers
  (`recordUnderSec`, `voiceInSec`), and why — with the ask, the clock (the browser's `clockMs`), the
  identity, the weather (NWS) and the headlines (Google News) in the brief; a failed pull is logged and
  the show goes on. `checkProgram` enforces the clock rules after, every step-down kept as the slot's
  fallback. Every `session_slot` row lands in one transaction. The legal ID is the server's, on
  segment 1's break.
- `POST …/segments/:num/slots/:seq/audio` — one clip: the slot's text (legal ID, words, lead line)
  through ElevenLabs in the session's voice, `PUT` to the bucket at
  `sessions/<session>/<num>/<seq>.mp3`, then the row stamped — bucket first, row second. A segue is
  stamped voiced with no clip. `{ again: true }` is another take under a new key. `GET` streams the
  bytes, immutable. No timestamps, no alignment: the mix is the player's.

**The prompts are inline** at each call site (`playlist.ts`, `cards.ts`, `program.ts`) — structured
outputs via `messages.parse` + `zodOutputFormat`, one zod shape per call in `shapes.ts`; counts are
enforced with `numbered(key, n, item)` (song1…songN) because the grammar does not bound arrays.

**The loop lives in the browser.** The session page fetches the snapshot, derives the frontier (the
last segment and its first unvoiced slot), calls the one rung it asks for, folds the response in,
repeats. Resume is free: a reload lands in the same place. One **deck** (`use-deck.ts`) holds one cue:
loading it makes its clip if needed, reads its length, lays the **plan** (`plan.ts`, pure — the
writer's two numbers plus house constants: bed gain and fades, the beat before the vocal, the duck),
and runs three lanes from one clock — the mic (the voice `<audio>`) and the bed (a looping buffer) in
one Web Audio graph with the bed's gain scheduled on the audio clock, and the record on the Spotify
device, started at its mark and ducked under the voice (the device's volume is the one knob). The
transport is start/stop; rows and ⏮ ⏭ pick the slot; the record ending advances to the next
(`transport.ts`, pure). **Next up:** open segment 2 while segment 1 is on air — `nextRung` in
`session-view.tsx` stops at "voiced" today.

## Working here

- Line endings are LF everywhere: `.gitattributes` (`* text=auto eol=lf`) overrides any local
  `core.autocrlf`; `.editorconfig` and Biome write the same. Phantom "modified" files after a fresh
  clone → `git add --renormalize .` once.
- Node via fnm (`.node-version`), pnpm workspaces. `pnpm check` (= lint + format:check + typecheck +
  test) then `pnpm --filter web build` is the pre-push gate; CI runs the same.
- Tests: pure logic only (`*.test.ts` next to the code: the rules, the shapes, the selection, the
  plan, the transport, the weather and headline readers, the roster, the SigV4 signer against the AWS
  vectors). Anything needing Postgres, Spotify, Claude, ElevenLabs or the bucket is verified live
  (`apps/web/scripts/bucket-smoke.mts` proves the signer against the real bucket). Red test first.
- Env for local dev comes from 1Password via `op run --env-file=.env.op` (see that file for the vault
  items; the five `BUCKET_*` come from `pof4-radio-clips-bucket`).
- Spotify app: registered at developer.spotify.com; the redirect URIs (dev + prod) must be listed there
  exactly. The Recommendations / Audio Features endpoints are unavailable to new apps — the producer
  picks, Spotify resolves.
- `db/` at the root is the database: `schema/*.sql` (one file per table) and three scripts run with plain
  `node` — `schema.mts` (`pnpm db:plan` / `db:apply`), `sql.mts` (`pnpm db:sql "select …"`, read-only),
  `clear.mts` (`pnpm db:clear` wipes sessions; cards stay). No workspace packages: `apps/web` is the one
  app and imports nothing from outside itself. The `station` and
  `segment` tables are the first build's, unused; dropping them is a schema edit + `db:apply`.
- `specs/001–003` and `docs/handoff.*`, `docs/the-program.html`, `docs/superpowers/` describe the
  first build (deleted 2026-09-03) — history, not guidance.
