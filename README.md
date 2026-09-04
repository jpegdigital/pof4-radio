# radio

An AI DJ over Spotify. See `CLAUDE.md` for the shape and the rules.

```
apps/web         Next.js — the desk (/), the session page (/sessions/:id: the loop and the deck, all in the
                 browser), the sessions API (/api/sessions/*: create, snapshot, three rungs), the control room
                 (/settings). Lib lives at the level that uses it: app/(app)/lib, app/api/sessions, src/lib.
db               The declarative Postgres schema (schema/*.sql, diffed and applied with pg-delta) and its three
                 scripts: schema.mts (plan / apply), sql.mts (one read-only query), clear.mts (wipe sessions)
```

## Run locally

```sh
fnm use && corepack enable && pnpm install
pnpm db:plan && pnpm db:apply        # first time, and after any db/schema/*.sql change
pnpm dev                             # https://dev.radio.pof4.com:3000
```

One-time per machine:

- `op` (1Password CLI) signed in; the vault items named in `.env.op` exist.
- DNS `dev.radio.pof4.com A 127.0.0.1` (recorded in pof4-infra's railway.ts header) — the Guard cookie is
  bound to `.pof4.com`, so dev must be served under it. `next dev --experimental-https` mints the cert with mkcert.
- The Spotify app lists `https://dev.radio.pof4.com:3000/spotify/callback` and
  `https://radio.pof4.com/spotify/callback` as redirect URIs, and (while in Development mode) every
  listener's Spotify account under User Management — each person plays through their own Premium account.

## Status

A prompt becomes a session: the playlist rung composes 4 records, the program rung writes the
break and every talk-up, sweeper and segue in one call (with the weather and the headlines in the
brief), the audio rung voices each slot as the deck reaches it. The deck plays one cue at a time on
three lanes — mic, bed, record. Next: open segment 2 while segment 1 is on air. `docs/sessions.html`
is the API dance, `docs/api.html` the data model. `pnpm db:clear` wipes the tables.

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
