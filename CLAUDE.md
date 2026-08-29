# Radio

An AI radio station over Spotify: a Claude DJ plans segments (a spoken bridge + 3–4 tracks), ElevenLabs
voices the talk, and the browser plays it all — streamed voice woven between Spotify tracks played
through the Web Playback SDK. The browser is the state machine; the server is stateless functions. Sibling of `../dreamweaver` and built the same way; when in
doubt, do what dreamweaver does (its `CLAUDE.md` is the fuller philosophy).

## Philosophy — minimize cost, maximize simplicity

- One service (`radio-web`) in the **`pof4`** Railway project, sharing the one Postgres (database
  `radio`). No worker, no queue, no bucket: nothing runs when nobody is listening. Infra is not in this repo: `../pof4-infra/.railway/railway.ts` is the
  only place Railway resources are declared — edit there, `pnpm plan` → `pnpm apply` **from that directory**.
  Secrets stay `preserve()`d, set via `railway variables`.
- One database, on purpose: `pnpm dev` talks to the same Railway Postgres as prod over its public proxy.
- Fewest moving parts: route handlers, plain `pg` + SQL (no ORM), declarative schema diffed and applied
  from the dev machine (`pnpm db:plan` / `db:apply`, no migration files).
- `packages/*` own pure logic and never read `process.env`; `apps/*` own process/env concerns. There is
  one app now, but the split stays: it's what keeps the DJ (`packages/dj`) and the queries unit-testable
  without Next in the way, not a sharing mechanism.
- Private behind Guard (`guard.pof4.com`): one gate, `apps/web/src/proxy.ts` (**temporarily open** —
  `GUARD_OPEN = true` there, so friends can test without a login — only `/settings` still asks for the passkey; flip it back); exempt = `api/health` +
  static, nothing else. No user table. Dev runs at `https://dev.radio.pof4.com:3000` because the cookie is
  bound to `pof4.com` — no localhost bypass.

## How it works (the shape)

**Spotify gives us control, not audio.** The browser tab *is* the playback device (Web Playback SDK,
Premium account required); the web app drives it with the station's user token. Two token flows, kept apart:

- **playback** → the user's authorization-code token. One connected account, one row:
  `spotify_account`. `/api/spotify/login` → consent → `/api/spotify/callback` stores it;
  `/api/spotify/token` hands the player a fresh access token (refreshing server-side). Playback is
  `PUT /me/player/play?device_id=…` from the browser with that token.
- **search** → the app's client-credentials token, used only inside `/api/station/next`.


**The server is two functions.** `POST /api/station/next` continues the station's one Claude conversation
(`station.messages`, row-locked while planning → a second tab gets 409): tools are frozen in code, the
prompts are data (below), the last message carries a 1-hour cache breakpoint, each finished turn is trimmed to its
`finish_segment` call, history is capped at 20 segments. `GET /api/tts` pipes ElevenLabs' streaming
endpoint (`eleven_v3`) to the browser; voice id, model and settings come from the browser per request —
a fixed roster of DJs, each a voice with its tuned settings (`DJS` in `voice-store.ts`; the pick is
remembered in localStorage) — and only `ELEVENLABS_KEY` lives on the server. `segment` rows are a history log.

**The prompts are settings.** Four slots — `prompt.system`, `prompt.opening`, `prompt.bridge`,
`prompt.shift` — with `{request}` / `{previous_talk}` / `{previous_tracks}` / `{dj}` placeholders
(`{dj}` is the picked DJ's name, sent by the browser with each planning request and baked into each brief —
"On the mic: …" — never into the system prompt, so switching DJ mid-show is a handoff on air, not a cache miss)
(`PROMPT_SLOTS`, `DEFAULT_PROMPTS`, `fillVars` in `packages/dj/src/prompt.ts`). The `settings` table holds
only edited slots (a key with no row reads its code default; "Reset" deletes the row); `/settings`
edits them, `loadPromptTemplate()` merges them per request. Editing the system prompt costs one cache
miss. No provenance yet: a station doesn't record which prompt text planned it.

**Two shells, route groups.** `app/(app)` is the station, phone-wide, the page as it was; `app/(settings)`
is the control room, desktop-wide. The root layout holds only fonts and the ground colour.

## Working here

- Line endings are LF everywhere, in the repo and the working tree, on every machine: `.gitattributes`
  (`* text=auto eol=lf`) overrides any local `core.autocrlf`; `.editorconfig` and Biome (`lineEnding: lf`)
  write the same. If a fresh clone shows phantom "modified" files, `git add --renormalize .` once.
- Node via fnm (`.node-version`), pnpm workspaces. `pnpm check` (= lint + format:check + typecheck + test)
  then `pnpm --filter web build` is the pre-push gate; CI runs the same.
- Tests: pure logic only (`*.test.ts` next to the code: the reducer, the DJ's prompt/trimming/checks).
  Anything needing Postgres, Spotify, Claude or ElevenLabs is verified live (`specs/*/quickstart.md`).
- Env for local dev comes from 1Password via `op run --env-file=.env.op` (see that file for the vault items).
- Spotify app: registered at developer.spotify.com; the redirect URIs (dev + prod) must be listed there
  exactly. The Recommendations / Audio Features endpoints are unavailable to new apps — the DJ picks,
  Spotify resolves.
