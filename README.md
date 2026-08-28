# radio

An AI DJ over Spotify. See `CLAUDE.md` for the shape and the rules.

```
apps/web         Next.js — Guard gate, Spotify sign-in, the station (state machine + player in the browser),
                 /api/station/next (the DJ) and /api/tts (the voice)
packages/db      Postgres: declarative schema (schema/*.sql via pg-delta) + typed queries
packages/dj      The DJ: prompt, tools, the Claude loop, history trimming/caching (pure, tested)
packages/spotify Spotify Web API: client-credentials + authorization-code flows, search, play
```

## Run locally

```sh
fnm use && corepack enable && pnpm install
pnpm db:plan && pnpm db:apply        # first time, and after any schema/*.sql change
pnpm dev                             # https://dev.radio.pof4.com:3000
```

One-time per machine:

- `op` (1Password CLI) signed in; the vault items named in `.env.op` exist.
- DNS `dev.radio.pof4.com A 127.0.0.1` (recorded in pof4-infra's railway.ts header) — the Guard cookie is
  bound to `.pof4.com`, so dev must be served under it. `next dev --experimental-https` mints the cert with mkcert.
- The Spotify app lists `https://dev.radio.pof4.com:3000/api/spotify/callback` and
  `https://radio.pof4.com/api/spotify/callback` as redirect URIs.

## Status

The loop works end to end: prompt → Run → the DJ opens the show → 3–4 tracks → a bridge into the
next block, forever, one segment ahead. Stop/Run, transport (skip talk, prev/next, pause), voice
settings in the page. See `specs/001-client-driven-station/` for the spec, plan and quickstart
(the live validation scenarios). `pnpm db:clear` wipes stations and segments.

## Deploy

Every push to `main` redeploys `radio-web` (pof4 Railway project; builds from the repo root with
`pnpm --filter web`). Infra changes go in `../pof4-infra`. Secrets are pushed once, straight
from 1Password — IaC declares them `preserve()` and never touches them:

```sh
railway variables -s radio-web \
  --set "SPOTIFY_CLIENT_ID=$(op read op://Developer/railway-radio-spotify/username)" \
  --set "SPOTIFY_CLIENT_SECRET=$(op read op://Developer/railway-radio-spotify/credential)" \
  --set "CLAUDE_KEY=$(op read op://Developer/pof4-radio-claude-pof4/credential)" \
  --set "ELEVENLABS_KEY=$(op read op://Developer/pof4-radio-elevenlabs-proart/credential)"
```
