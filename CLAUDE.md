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
- **Always minimize dependencies.** Before adding a package, ask whether `fetch`, Web Crypto, the
  platform, or thirty lines of our own would do — that is how `packages/spotify` is plain `fetch` + PKCE
  by hand and there is no Spotify SDK, auth library, or state-management library in the tree. Same rule
  for services: if the browser can do it (tokens, playback, audio), the server doesn't.
- `packages/*` own pure logic and never read `process.env`; `apps/*` own process/env concerns. There is
  one app now, but the split stays: it's what keeps the DJ (`packages/dj`) and the queries unit-testable
  without Next in the way, not a sharing mechanism.
- Private behind Guard (`guard.pof4.com`): one gate, `apps/web/src/proxy.ts` (**temporarily open** —
  `GUARD_OPEN = true` there, so friends can test without a login — only `/settings` still asks for the passkey; flip it back); exempt = `api/health` +
  static, nothing else. No user table. Dev runs at `https://dev.radio.pof4.com:3000` because the cookie is
  bound to `pof4.com` — no localhost bypass.

## How it works (the shape)

**Spotify gives us control, not audio.** The browser tab *is* the playback device (Web Playback SDK,
Premium account required); each visitor plays through their *own* account. Two token flows, kept apart:

- **playback** → the user's token, **browser only**. PKCE needs no secret, so the whole flow lives in
  `components/station/spotify-account.ts`: consent → `/spotify/callback` (a page, not an API route) →
  tokens in localStorage, refreshed in place (one shared in-flight refresh — PKCE rotates the refresh
  token, racing refreshes log you out). No account table, no token route; the server never sees a user
  token. Who is connected (id, name, product — never a token) also goes in a cookie so the page paints the
  name and the Premium gate on first load. Playback is `PUT /me/player/play?device_id=…` from the browser.
- **search** → the app's client-credentials token (needs the secret), used only inside `/api/station/next`.

**The loop lives in the browser** (`apps/web/src/components/station/`): a pure reducer (`reducer.ts`,
tested) and one effects hook (`use-station.ts`) that carries out what the state says. The show is an
ordered list of *metatracks* — a segment is `{talk, tracks[3–4]}`, its talk an opening on the first
and a bridge from the previous one after that — walked by one cursor `{seg, item}` (item 0 = the
talk). One transport (`player.tsx`) moves the cursor through talk and tracks alike; the show is a
tappable cue sheet (`show.tsx`) and any row rewinds to it; `use-media-session.ts` mirrors the player face onto the
lock screen (Media Session API — re-asserted on every talk↔track handoff, since the SDK writes its own). Segment text and talk audio are separate
pipelines: the DJ is asked for the next segment the moment the cursor lands on the *tail's* talk (it
lands in 20–60 s while the block plays); talk audio is fetched by *position* — the cursor's segment
and the one after it, cached per session by `voiceId:segmentId` — so a resumed show's past blocks are
voiced when tapped and a rewind is instant. Run/Stop are absolute; Stop keeps the cursor and the
DJ's memory; a page load is a fresh show (new station) unless a past station is picked from the
"Resume a show" list (loaded with the page; `GET /api/station/:id` fetches the pick) — its blocks load into the show,
and tapping one or pressing Run continues that conversation.

**The server is two functions.** `POST /api/station/next` continues the station's one Claude conversation
(`station.messages`, row-locked while planning → a second tab gets 409): tools are frozen in code, the
prompts are data (below), the last message carries a 1-hour cache breakpoint, each finished turn is trimmed to its
`finish_segment` call, history is capped at 20 segments. `GET /api/tts?text&voiceId` pipes ElevenLabs'
streaming endpoint to the browser: the browser names the voice, the server reads that voice's model and
settings from the roster per request and assembles the call (`lib/elevenlabs.ts`, `ttsBody` in
`packages/dj/src/voice.ts`); only `ELEVENLABS_KEY` lives on the server. The roster is the `settings.voices`
row — JSON, `[{id, name, gender, modelId, stability, similarityBoost, style, speed, speakerBoost}]`, array
order is picker order and the first is the default; `eleven_v3` (stability is a 0/0.5/1 mode; reads
`[audio tags]` in the talk; ignores `speed` and `style` — measured) or `eleven_multilingual_v2` (continuous; `speed` works). Edited on `/settings` → Voices, with
`POST /api/tts/preview` (guarded like `/settings`) voicing the unsaved form; the station page reads
the roster on the server (`app/(app)/page.tsx` — ids, names, grouping, never the tuning) so the picker is
full on first paint, and remembers the pick in localStorage.
Talk audio cached in an open tab keeps the voice it was made with. `segment` rows are a history log.

**The prompts are settings.** Four slots — `prompt.system`, `prompt.opening`, `prompt.bridge`,
`prompt.shift` — with `{request}` / `{previous_talk}` / `{previous_tracks}` / `{dj}` placeholders
(`{dj}` is the picked DJ's name, sent by the browser with each planning request and baked into each brief —
"On the mic: …" — never into the system prompt, so switching DJ mid-show is a handoff on air, not a cache miss)
(`PROMPT_SLOTS`, `fillVars` in `packages/dj/src/prompt.ts`). **The text lives only in the `settings` table** —
four rows, one per slot, no copy or fallback in code; edit it on `/settings` or straight in the table.
`loadPromptTemplate()` reads the rows per request and throws if a slot is missing. A fresh database needs
the four rows filled by hand (and a `voices` row — add the first voice on `/settings`; with no row the
roster is empty and the station has nothing to pick). Editing the system prompt costs one cache
miss. No provenance yet: a station doesn't record which prompt text planned it.

**Two shells, route groups.** `app/(app)` is the station, phone-wide, the page as it was; `app/(settings)`
is the control room, desktop-wide. The root layout holds only fonts and the ground colour.

**The program is a sandbox, all in one route group.** `app/(program)/program/` is a pre-generated hour played
by its own state machine (`reducer.ts`, `use-program.ts`: three lanes — the Spotify device, the voice, a
looped bed — and an `Element[]` of songs, talk-ups and breaks). `program/make/` is the maker: a request
becomes that hour in five stages, each a stateless `POST /program/make/<stage>` that reads the previous
stage's file and writes its own under `apps/web/public/program/make/` (gitignored) — `discover`
(request → picks → records, one Opus call + Spotify search), `enrich` (one Opus call per record → a card:
intro length, post, ending, energy; cached as `cards/<id>.json`), `log` (order + treatments, one call,
then `checkLog()` enforces the clock rules in `clock-rules.ts`), `script` (every word, one call; a break's
legal ID and lead line are separate fields), `voice` (ElevenLabs with alignment → `clips/slot-<seq>.mp3`;
`assemble.ts` derives every timing from clip length, the card and known character offsets, never by
searching, and records a fallback on each element that took the next rung). `/program/make` runs the
stages (all, one, or "from here") and links every file; `/program` plays `program.json`. Prompts live in
`make/prompts.ts`, not in settings. **Dev only**: the routes and the page answer 404 in production —
they write into the app's own tree. The bed (`public/program/bed.mp3`) is copied in by hand; produced
sweepers come from `scripts/sweepers-prep.mjs`.

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
