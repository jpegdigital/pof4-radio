# radio

An AI DJ over Spotify. See `CLAUDE.md` for the shape and the rules.

```
apps/web        Next.js — Guard gate, Spotify sign-in, the player (Web Playback SDK)
apps/worker     pg-boss worker — will generate segments (Claude → Spotify → ElevenLabs → bucket)
packages/db     Postgres: declarative schema (schema/*.sql via pg-delta) + typed queries
packages/spotify Spotify Web API: client-credentials + authorization-code flows, search, play
```

## Run locally

```sh
fnm use && corepack enable && pnpm install
pnpm db:plan && pnpm db:apply        # first time, and after any schema/*.sql change
pnpm dev                             # web at https://dev.radio.pof4.com:3000, worker alongside
```

One-time per machine:

- `op` (1Password CLI) signed in; the vault items named in `.env.op` exist.
- DNS `dev.radio.pof4.com A 127.0.0.1` (recorded in pof4-infra's railway.ts header) — the Guard cookie is
  bound to `.pof4.com`, so dev must be served under it. `next dev --experimental-https` mints the cert with mkcert.
- The Spotify app lists `https://dev.radio.pof4.com:3000/api/spotify/callback` and
  `https://radio.pof4.com/api/spotify/callback` as redirect URIs.

## Prototype status

Proves the plumbing: Postgres (`spotify_account`), Spotify Web API (a fixed search with the app token),
and playback (connect a Premium account, start the player in the tab, press Play on a track).
The worker boots pg-boss, logs a fixed search, and waits on an empty `segment` queue.
