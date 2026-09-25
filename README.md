# radio

An AI DJ over your records, pulled from Qobuz. See `CLAUDE.md` for the shape and the rules.

```
apps/web         Next.js — the desk (/), the session page (/sessions/:id: the loop and the deck, all in the
                 browser), the sessions API (/api/sessions/*: create, snapshot, four rungs), the control room
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
- A Qobuz subscription that streams (Studio or Sublime). There is no developer API: the token is your own,
  read from play.qobuz.com's localStorage (`localuser.token`) into the 1Password item `pof4-radio-qobuz`;
  `op run --env-file=.env.op -- node apps/web/scripts/qobuz-smoke.mts` proves it and prints the web
  player's current app id + secret for the same item. When Qobuz rotates auth, paste a fresh token.

## Status

A prompt becomes a session: the playlist rung composes 4 records from Qobuz's catalog, the program
rung writes the break and every talk-up, sweeper and segue in one call (with the weather and the
headlines in the brief), the audio rung voices each slot as the deck reaches it, the record rung pulls
each record once — MP3 320 into the bucket, kept forever, shared by every session. The deck plays one
cue at a time on three lanes — mic, bed, record — in one Web Audio graph. Next: open segment 2 while
segment 1 is on air. `docs/sessions.html` is the API dance, `docs/api.html` the data model. `pnpm
db:clear` wipes the sessions (the cards and the records stay).

## Deploy

Song playback uses native audio and byte-range requests directly to the private Railway bucket.
`GET /api/sessions/:id/slots/:seq/track?playback=1` resolves the held slot in one database query
and returns a signed URL with its expiry (`private, no-store`); the plain track URL redirects.
The player renews URLs before a record could outlive them, including after a long pause, and
buffers the next held song in a second reusable audio element. DJ clips remain fully decoded
for Web Audio scheduling. Browser metadata supplies the exact song duration.

Bucket CORS belongs to `../pof4-infra/.railway/radio-bucket-cors.ts`: run
`pnpm radio:bucket:check` or `pnpm radio:bucket:apply` from that repository. Apply it before
deploying this playback path. Railway's bucket IaC DSL does not expose CORS, so the focused
command uses the S3 API and preserves other rules. Production and local HTTPS origins are declared there.

Every push to `main` redeploys `radio-web` (pof4 Railway project; builds from the repo root with
`pnpm --filter web`). Infra changes go in `../pof4-infra`. Secrets are pushed once, straight
from 1Password — IaC declares them `preserve()` and never touches them:

```sh
railway variables -s radio-web \
  --set "QOBUZ_TOKEN=$(op read op://Developer/pof4-radio-qobuz/credential)" \
  --set "QOBUZ_APP_ID=$(op read op://Developer/pof4-radio-qobuz/app_id)" \
  --set "QOBUZ_SECRET=$(op read op://Developer/pof4-radio-qobuz/secret)" \
  --set "CLAUDE_KEY=$(op read op://Developer/pof4-radio-claude-pof4/credential)" \
  --set "ELEVENLABS_KEY=$(op read op://Developer/pof4-radio-elevenlabs-proart/credential)"
```

## Scheduled preparation

The news worker saves raw HN/Dallas headlines without model calls. Jev selects stories during a break; Claude incorporates them into the program. Weather is collected independently.
See [prepared content](docs/prepared-content.md) for schedules, storage, commands, and the session contract.
Railway resources live in the sibling pof4-infra repository.
