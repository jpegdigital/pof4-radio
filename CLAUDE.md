# Radio

An AI radio station over Spotify: a Claude DJ plans segments (commentary + a few tracks), ElevenLabs
voices the commentary, and the browser plays it all — voice clips from our bucket woven between Spotify
tracks played through the Web Playback SDK. Sibling of `../dreamweaver` and built the same way; when in
doubt, do what dreamweaver does (its `CLAUDE.md` is the fuller philosophy).

## Philosophy — minimize cost, maximize simplicity

- One service group (`radio-web`, `radio-worker`, `clips` bucket) in the **`pof4`** Railway project, sharing
  the one Postgres (database `radio`). Infra is not in this repo: `../pof4-infra/.railway/railway.ts` is the
  only place Railway resources are declared — edit there, `pnpm plan` → `pnpm apply` **from that directory**.
  Secrets stay `preserve()`d, set via `railway variables`.
- One database, on purpose: `pnpm dev` talks to the same Railway Postgres as prod over its public proxy.
- Fewest moving parts: Server Actions / route handlers, plain `pg` + SQL (no ORM), pg-boss on Postgres
  (no Redis), declarative schema diffed and applied from the dev machine (`pnpm db:plan` / `db:apply`, no
  migration files, `pgboss` schema excluded).
- `packages/*` own pure logic and never read `process.env`; `apps/*` own process/env concerns.
- Private behind Guard (`guard.pof4.com`): one gate, `apps/web/src/proxy.ts`; exempt = `api/health` +
  static, nothing else. No user table. Dev runs at `https://dev.radio.pof4.com:3000` because the cookie is
  bound to `pof4.com` — no localhost bypass.

## How it works (the shape)

**Spotify gives us control, not audio.** The browser tab *is* the playback device (Web Playback SDK,
Premium account required); the web app drives it with the station's user token. Two token flows, kept apart:

- **web** → the user's authorization-code token (playback). One connected account, one row:
  `spotify_account`. `/api/spotify/login` → consent → `/api/spotify/callback` stores it;
  `/api/spotify/token` hands the player a fresh access token (refreshing server-side). Playback is
  `PUT /me/player/play?device_id=…` from the browser with that token.
- **worker** → the app's client-credentials token (search/lookup only). It never sees the user token.

Planned loop (not built yet): the player reports buffer-low → web sends a `segment` job → worker asks
Claude (with a `search_spotify` tool so every pick is a real track id) for
`{intro, tracks[2-4], outro}` → ElevenLabs renders the commentary → mp3 into `clips` → row in Postgres →
NOTIFY → SSE → the player plays the clip (ducking Spotify volume) then the tracks. Always one segment ahead.

## Working here

- Node via fnm (`.node-version`), pnpm workspaces. `pnpm check` (= lint + format:check + typecheck + test)
  then `pnpm --filter web build` is the pre-push gate; CI runs the same.
- Tests: pure logic only (`*.test.ts` next to the code). Anything needing Postgres, Spotify or a model
  is verified in prod.
- Env for local dev comes from 1Password via `op run --env-file=.env.op` (see that file for the vault items).
- Spotify app: registered at developer.spotify.com; the redirect URIs (dev + prod) must be listed there
  exactly. The Recommendations / Audio Features endpoints are unavailable to new apps — the DJ picks,
  Spotify resolves.
